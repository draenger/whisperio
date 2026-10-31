package ai.whisperio.android

import ai.whisperio.android.security.AudioCipher
import ai.whisperio.android.security.DataCipher
import java.io.File
import java.nio.ByteBuffer
import kotlin.random.Random
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** A3: Tink streaming AEAD for kept clips (JVM only; Tink runs without Android). */
class AudioCipherTest {
    @get:Rule val tmp = TemporaryFolder()
    private val keys = AudioMemKeys()
    private val data = DataCipher(TestCipher(), keys)
    private val audio = AudioCipher(data)

    // ~300 KB = five 64 KiB segments.
    private fun plainFile(name: String = "r1.m4a", size: Int = 300_000) =
        File(tmp.root, name).also { it.writeBytes(Random(7).nextBytes(size)) }

    private fun encrypted(plain: File, id: String = "r1"): File {
        val enc = File(tmp.root, plain.name + ".wea")
        runBlocking { audio.encryptFile(plain, enc, id) }
        return enc
    }

    private fun assertFails(block: suspend () -> Unit) {
        try {
            runBlocking { block() }
            fail("expected a failure")
        } catch (e: AssertionError) {
            throw e
        } catch (e: Exception) {
            // expected
        }
    }

    private fun noLeftovers(out: File) {
        assertFalse(out.exists())
        assertFalse(File(out.path + ".tmp").exists())
    }

    @Test fun namingConvention() {
        assertTrue(AudioCipher.isEncrypted("/x/r1.m4a.wea"))
        assertFalse(AudioCipher.isEncrypted("/x/r1.m4a"))
        assertFalse(AudioCipher.isEncrypted("/x/r1.m4a.wea.tmp"))
        assertEquals("/x/r1.m4a.wea", AudioCipher.encryptedFor(File("/x/r1.m4a")).path.replace('\', '/'))
        assertEquals("/x/r1.m4a", AudioCipher.plainFor(File("/x/r1.m4a.wea")).path.replace('\', '/'))
    }

    @Test fun roundTripOfAMultiSegmentFile() = runBlocking {
        val plain = plainFile()
        val enc = encrypted(plain)

        assertTrue(enc.exists())
        assertFalse(File(enc.path + ".tmp").exists())
        assertTrue(enc.length() > plain.length())
        val needle = String(plain.readBytes().copyOf(64), Charsets.ISO_8859_1)
        assertFalse("ciphertext must not contain the plaintext", String(enc.readBytes(), Charsets.ISO_8859_1).contains(needle))

        val back = File(tmp.root, "back.m4a")
        audio.decryptToFile(enc, back, "r1")
        assertArrayEquals(plain.readBytes(), back.readBytes())
        assertFalse(File(back.path + ".tmp").exists())
        assertTrue("encryptFile never deletes the plaintext", plain.exists())
    }

    @Test fun emptyFileRoundTrips() = runBlocking {
        val plain = plainFile(size = 0)
        val enc = encrypted(plain)
        val back = File(tmp.root, "back.m4a")
        audio.decryptToFile(enc, back, "r1")
        assertEquals(0L, back.length())
    }

    @Test fun seekableChannelReadsMatchThePlaintextAtRandomOffsets() = runBlocking {
        val plain = plainFile()
        val bytes = plain.readBytes()
        val ch = audio.openSeekable(encrypted(plain), "r1")
        assertNotNull(ch)
        ch!!.use { c ->
            assertEquals(bytes.size.toLong(), c.size())
            fun readAt(off: Int, len: Int): ByteArray {
                val buf = ByteBuffer.allocate(len)
                c.position(off.toLong())
                while (buf.hasRemaining()) if (c.read(buf) < 0) break
                return buf.array()
            }
            val rnd = Random(99)
            repeat(10) {
                val off = rnd.nextInt(bytes.size)
                val len = minOf(rnd.nextInt(1, 5000), bytes.size - off)
                assertArrayEquals("offset $off", bytes.copyOfRange(off, off + len), readAt(off, len))
            }
            // across a segment boundary, and at the very end
            assertArrayEquals(bytes.copyOfRange(65_536 - 1000, 65_536 + 1000), readAt(65_536 - 1000, 2000))
            c.position(bytes.size.toLong())
            assertEquals(-1, c.read(ByteBuffer.allocate(8)))
        }
    }

    @Test fun aClipCannotBeMovedToAnotherRecording() = runBlocking {
        val enc = encrypted(plainFile(), id = "r1")
        val out = File(tmp.root, "stolen.m4a")
        assertFails { audio.decryptToFile(enc, out, "r2") }
        noLeftovers(out)
        val ch = audio.openSeekable(enc, "r2")
        if (ch != null) {
            // Tink authenticates segments lazily: opening may succeed, reading must not return plaintext.
            ch.use { c -> assertFails { c.position(0); c.read(ByteBuffer.allocate(100)) } }
        }
    }

    @Test fun aFlippedCiphertextByteFails() = runBlocking {
        val enc = encrypted(plainFile())
        val b = enc.readBytes()
        b[b.size / 2] = (b[b.size / 2].toInt() xor 1).toByte() // inside a middle segment
        enc.writeBytes(b)
        val out = File(tmp.root, "out.m4a")
        assertFails { audio.decryptToFile(enc, out, "r1") }
        noLeftovers(out)
    }

    @Test fun aTruncatedClipFails() = runBlocking {
        val enc = encrypted(plainFile())
        enc.writeBytes(enc.readBytes().copyOf(enc.length().toInt() - 70_000))
        val out = File(tmp.root, "out.m4a")
        assertFails { audio.decryptToFile(enc, out, "r1") }
        noLeftovers(out)
    }

    @Test fun afterShredNothingCanBeOpened() = runBlocking {
        val enc = encrypted(plainFile())
        data.shred()
        assertNull(audio.openSeekable(enc, "r1"))
        val out = File(tmp.root, "out.m4a")
        assertFails { audio.decryptToFile(enc, out, "r1") }
        noLeftovers(out)
    }

    @Test fun garbageFileHasNoSeekableView() = runBlocking {
        val junk = File(tmp.root, "junk.m4a.wea").also { it.writeBytes(ByteArray(500) { 3 }) }
        encrypted(plainFile("seed.m4a")) // make sure a key exists
        assertNull(audio.openSeekable(junk, "r1"))
    }

    @Test fun aFailedEncryptLeavesNoTmpAndNoOutput() = runBlocking {
        val plain = plainFile()
        val out = File(tmp.root, "r1.m4a.wea")

        // Keystore cannot produce a key.
        val broken = AudioCipher(DataCipher(AudioBrokenWrapper(), AudioMemKeys()))
        assertFails { broken.encryptFile(plain, out, "r1") }
        noLeftovers(out)

        // Source missing.
        assertFails { audio.encryptFile(File(tmp.root, "missing.m4a"), out, "r1") }
        noLeftovers(out)
        assertTrue(plain.exists())
    }
}
