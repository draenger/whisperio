package ai.whisperio.android.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import java.io.File
import kotlin.math.log10

/**
 * Thin recorder port. Level polling, silence guard, caps and auto-stop live in DictationController so they are
 * testable with a fake and a virtual clock.
 */
interface AudioRecorder {
    /** Starts writing AAC to [file]. Throws on failure (mic busy, no permission). */
    fun start(file: File)

    /** Peak amplitude (0..32767) since the previous call. */
    fun maxAmplitude(): Int

    /** Finalises the file. Never throws; returns false when the file is unusable. */
    fun stop(): Boolean

    /** Abandons the recording and releases the mic. Never throws. */
    fun release()
}

/** MediaRecorder: VOICE_RECOGNITION, MPEG-4/AAC, 16 kHz mono 32 kbps (CONTRACT 6). */
class MediaRecorderAudioRecorder(private val context: Context) : AudioRecorder {
    private var recorder: MediaRecorder? = null

    override fun start(file: File) {
        file.parentFile?.mkdirs()
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        try {
            r.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioChannels(1)
            r.setAudioSamplingRate(16_000)
            r.setAudioEncodingBitRate(32_000)
            r.setOutputFile(file.absolutePath)
            r.prepare()
            r.start()
            recorder = r
        } catch (t: Throwable) {
            runCatching { r.release() }
            throw t
        }
    }

    override fun maxAmplitude(): Int = try {
        recorder?.maxAmplitude ?: 0
    } catch (_: Throwable) {
        0
    }

    override fun stop(): Boolean {
        val r = recorder ?: return false
        recorder = null
        return try {
            r.stop()
            true
        } catch (_: RuntimeException) {
            // stop() throws when nothing was captured (too short); the file is unusable.
            false
        } finally {
            runCatching { r.release() }
        }
    }

    override fun release() {
        val r = recorder ?: return
        recorder = null
        runCatching { r.stop() }
        runCatching { r.release() }
    }
}

/** Transient-exclusive audio focus; losing it stops the dictation (iOS default behaviour, CONTRACT 6). */
interface AudioFocusGate {
    fun request(onLost: () -> Unit): Boolean
    fun abandon()
}

class SystemAudioFocusGate(context: Context) : AudioFocusGate {
    private val manager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var request: AudioFocusRequest? = null

    override fun request(onLost: () -> Unit): Boolean {
        abandon()
        val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setOnAudioFocusChangeListener { change ->
                if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) onLost()
            }
            .build()
        request = req
        return manager.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    override fun abandon() {
        request?.let { manager.abandonAudioFocusRequest(it) }
        request = null
    }
}

object Levels {
    /** Level floor reported for silence. */
    const val FLOOR_DB = -90f

    /** `20*log10(amp/32767)` so the iOS thresholds apply (CONTRACT 6). */
    fun dbfs(amplitude: Int): Float =
        if (amplitude <= 0) FLOOR_DB else (20.0 * log10(amplitude / 32767.0)).toFloat().coerceIn(FLOOR_DB, 0f)

    /** 0..1 meter value, same mapping as iOS (-55 dBFS .. 0). */
    fun normalized(db: Float): Float = ((db + 55f) / 55f).coerceIn(0f, 1f)
}
