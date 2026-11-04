package ai.whisperio.android.security

import com.google.crypto.tink.InsecureSecretKeyAccess
import com.google.crypto.tink.StreamingAead
import com.google.crypto.tink.streamingaead.AesGcmHkdfStreamingKey
import com.google.crypto.tink.streamingaead.AesGcmHkdfStreamingParameters
import com.google.crypto.tink.subtle.AesGcmHkdfStreaming
import com.google.crypto.tink.util.SecretBytes
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.channels.SeekableByteChannel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Encrypts kept audio clips for the opt-in "Encrypt history and recordings" setting (design doc 3.2) with Tink's
 * AES-GCM-HKDF streaming AEAD (64 KiB segments, so a clip is processed in constant memory and can be decrypted
 * with random access for playback). The key is a purpose subkey of the data key ([DataCipher.subkey]); the
 * associated data is the recording id, so a clip cannot be swapped between rows. An encrypted clip is the plain
 * name plus [SUFFIX] (`<id>.m4a.wea`). Never logs; exceptions carry no key material or file contents.
 */
class AudioCipher(private val data: DataCipher) {

    /**
     * Writes [out] = encrypt([plain]). The ciphertext goes to `out.tmp`, is read back and compared with [plain]
     * (never save a clip that cannot be decrypted), and only then renamed over [out]. On any failure the temp
     * file is removed and the exception is rethrown; [plain] is never touched (the caller deletes it).
     */
    suspend fun encryptFile(plain: File, out: File, recordingId: String) = withContext(Dispatchers.IO) {
        val aead = aead(create = true) ?: throw IOException("no audio key")
        val aad = aad(recordingId)
        val tmp = tmpFor(out)
        try {
            FileInputStream(plain).use { input ->
                aead.newEncryptingStream(FileOutputStream(tmp), aad).use { sink -> input.copyTo(sink, BUFFER) }
            }
            verify(aead, tmp, plain, aad)
            commit(tmp, out)
        } catch (t: Throwable) {
            tmp.delete()
            throw t
        }
    }

    /** Writes [out] = decrypt([enc]) the same way (tmp + rename; a clip that fails authentication leaves nothing). */
    suspend fun decryptToFile(enc: File, out: File, recordingId: String) = withContext(Dispatchers.IO) {
        val aead = aead(create = false) ?: throw IOException("no audio key")
        val tmp = tmpFor(out)
        try {
            FileInputStream(enc).use { raw ->
                aead.newDecryptingStream(raw, aad(recordingId)).use { input ->
                    FileOutputStream(tmp).use { sink -> input.copyTo(sink, BUFFER) }
                }
            }
            commit(tmp, out)
        } catch (t: Throwable) {
            tmp.delete()
            throw t
        }
    }

    /**
     * Random-access plaintext view of [enc] for the player; the caller closes it. Null when the key is missing or
     * the file header cannot be read / authenticated (wrong id, not a clip).
     */
    suspend fun openSeekable(enc: File, recordingId: String): SeekableByteChannel? = withContext(Dispatchers.IO) {
        val aead = aead(create = false) ?: return@withContext null
        var raw: FileInputStream? = null
        try {
            raw = FileInputStream(enc)
            val ch = aead.newSeekableDecryptingChannel(raw.channel, aad(recordingId))
            // Tink reads and authenticates the header lazily; read the first byte now so a garbage, truncated,
            // moved (wrong AAD) or wrong-key file is refused here instead of failing inside MediaPlayer.
            ch.read(java.nio.ByteBuffer.allocate(1))
            ch.position(0)
            ch
        } catch (e: kotlinx.coroutines.CancellationException) {
            raw?.close()
            throw e
        } catch (e: Exception) {
            raw?.close()
            null
        }
    }

    private suspend fun aead(create: Boolean): StreamingAead? {
        val ikm = data.subkey(INFO, create) ?: return null
        return try {
            val params = AesGcmHkdfStreamingParameters.builder()
                .setKeySizeBytes(KEY_BYTES)
                .setDerivedAesGcmKeySizeBytes(KEY_BYTES)
                .setHkdfHashType(AesGcmHkdfStreamingParameters.HashType.SHA256)
                .setCiphertextSegmentSizeBytes(SEGMENT_BYTES)
                .build()
            AesGcmHkdfStreaming.create(AesGcmHkdfStreamingKey.create(params, SecretBytes.copyFrom(ikm, InsecureSecretKeyAccess.get())))
        } finally {
            ikm.fill(0)
        }
    }

    /** Streams [enc] back through the decrypter and compares it byte for byte with [plain]. */
    private fun verify(aead: StreamingAead, enc: File, plain: File, aad: ByteArray) {
        FileInputStream(enc).use { raw ->
            aead.newDecryptingStream(raw, aad).use { dec ->
                FileInputStream(plain).use { orig ->
                    val a = ByteArray(BUFFER)
                    val b = ByteArray(BUFFER)
                    while (true) {
                        val n = readFully(orig, a)
                        val m = readFully(dec, b)
                        if (n != m || !a.contentEquals(b, n)) throw IOException("encrypted clip failed verification")
                        if (n < BUFFER) return
                    }
                }
            }
        }
    }

    private fun ByteArray.contentEquals(other: ByteArray, n: Int): Boolean {
        for (i in 0 until n) if (this[i] != other[i]) return false
        return true
    }

    private fun readFully(input: InputStream, buf: ByteArray): Int {
        var off = 0
        while (off < buf.size) {
            val r = input.read(buf, off, buf.size - off)
            if (r < 0) break
            off += r
        }
        return off
    }

    private fun commit(tmp: File, out: File) {
        if (tmp.renameTo(out)) return
        // renameTo does not replace on every platform; the target is being replaced anyway.
        if (out.exists() && out.delete() && tmp.renameTo(out)) return
        throw IOException("could not move ${tmp.name} into place")
    }

    private fun tmpFor(out: File) = File(out.path + ".tmp")

    private fun aad(recordingId: String) = recordingId.toByteArray(Charsets.UTF_8)

    companion object {
        /** `<id>.m4a` -> `<id>.m4a.wea`. */
        const val SUFFIX = ".wea"
        private const val INFO = "whisperio/audio/v1"
        private const val KEY_BYTES = 32
        private const val SEGMENT_BYTES = 64 * 1024
        private const val BUFFER = 64 * 1024

        fun isEncrypted(path: String): Boolean = path.endsWith(".m4a$SUFFIX")

        fun encryptedFor(plain: File): File = File(plain.path + SUFFIX)

        /** `<id>.m4a.wea` -> `<id>.m4a` (same directory). */
        fun plainFor(enc: File): File = File(enc.path.removeSuffix(SUFFIX))
    }
}
