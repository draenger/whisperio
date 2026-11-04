package ai.whisperio.android.ui.history

import android.media.MediaDataSource
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.SeekableByteChannel

/**
 * Feeds [MediaPlayer][android.media.MediaPlayer] the plaintext of an encrypted clip straight from a decrypting
 * [channel] (AudioCipher.openSeekable), so no plaintext copy ever touches the disk. Owns [channel]: [close] closes it.
 * MediaPlayer may call [readAt] from its own thread, hence the lock around position + read.
 */
class DecryptingMediaDataSource(private val channel: SeekableByteChannel) : MediaDataSource() {
    private val lock = Any()

    @Throws(IOException::class)
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (size == 0) return 0
        synchronized(lock) {
            if (position >= channel.size()) return -1
            channel.position(position)
            val buf = ByteBuffer.wrap(buffer, offset, size)
            var total = 0
            while (buf.hasRemaining()) {
                val n = channel.read(buf)
                if (n < 0) break
                total += n
                if (n == 0) break
            }
            return if (total == 0) -1 else total
        }
    }

    @Throws(IOException::class)
    override fun getSize(): Long = synchronized(lock) { channel.size() }

    @Throws(IOException::class)
    override fun close() {
        synchronized(lock) { channel.close() }
    }
}
