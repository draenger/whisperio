package ai.whisperio.android.ui.history

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import java.io.IOException
import kotlinx.coroutines.delay

/**
 * CONTRACT-1.1 F4: plays one kept clip with the platform [MediaPlayer]. Transient audio focus (speech), pauses when
 * focus is lost or the output becomes noisy (headphones unplugged), never starts on its own. [release] frees the
 * player and focus; the next [play] prepares it again, so one instance survives ON_STOP.
 */
class AudioPlayer(private val context: Context, private val path: String, knownDurationMs: Int) {
    var playing by mutableStateOf(false)
        private set
    var positionMs by mutableIntStateOf(0)
        private set
    var durationMs by mutableIntStateOf(knownDurationMs)
        private set

    private var player: MediaPlayer? = null
    private var focusRequest: AudioFocusRequest? = null
    private var noisyRegistered = false
    private val audioManager get() = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
            change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
        ) pause()
    }

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) pause()
        }
    }

    fun toggle() { if (playing) pause() else play() }

    fun play() {
        if (playing) return
        val mp = player ?: prepare() ?: return
        if (!requestFocus()) return
        try {
            mp.start()
        } catch (_: IllegalStateException) {
            release()
            return
        }
        playing = true
        registerNoisy()
    }

    fun pause() {
        val mp = player
        if (playing && mp != null) {
            try { mp.pause() } catch (_: IllegalStateException) { /* already released */ }
            positionMs = safePosition(mp)
        }
        playing = false
        unregisterNoisy()
        abandonFocus()
    }

    fun seekTo(ms: Int) {
        val target = ms.coerceIn(0, durationMs.coerceAtLeast(0))
        positionMs = target
        try { player?.seekTo(target) } catch (_: IllegalStateException) { /* not prepared */ }
    }

    /** Called by the UI clock while playing. */
    fun refresh() {
        val mp = player ?: return
        if (playing) positionMs = safePosition(mp)
    }

    fun release() {
        playing = false
        unregisterNoisy()
        abandonFocus()
        player?.let { try { it.release() } catch (_: IllegalStateException) { /* ignore */ } }
        player = null
        positionMs = 0
    }

    private fun prepare(): MediaPlayer? {
        val mp = MediaPlayer()
        return try {
            mp.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            mp.setDataSource(path)
            mp.prepare()
            mp.setOnCompletionListener {
                playing = false
                positionMs = 0
                unregisterNoisy()
                abandonFocus()
                try { it.seekTo(0) } catch (_: IllegalStateException) { /* released meanwhile */ }
            }
            if (mp.duration > 0) durationMs = mp.duration
            player = mp
            mp
        } catch (_: IOException) {
            mp.release(); null
        } catch (_: RuntimeException) {
            mp.release(); null
        }
    }

    private fun requestFocus(): Boolean {
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            .setOnAudioFocusChangeListener(focusListener)
            .build()
        val granted = audioManager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        if (granted) focusRequest = request
        return granted
    }

    private fun abandonFocus() {
        focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
        focusRequest = null
    }

    private fun registerNoisy() {
        if (noisyRegistered) return
        ContextCompat.registerReceiver(
            context, noisyReceiver, IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        noisyRegistered = true
    }

    private fun unregisterNoisy() {
        if (!noisyRegistered) return
        try { context.unregisterReceiver(noisyReceiver) } catch (_: IllegalArgumentException) { /* not registered */ }
        noisyRegistered = false
    }

    private fun safePosition(mp: MediaPlayer): Int = try { mp.currentPosition } catch (_: IllegalStateException) { 0 }
}

/**
 * An [AudioPlayer] for [path] that is paused and released when the screen stops or leaves the composition and whenever
 * [stop] turns true (a recording started).
 */
@Composable
fun rememberAudioPlayer(path: String, knownDurationMs: Int, stop: Boolean): AudioPlayer {
    val ctx = LocalContext.current
    val player = remember(path) { AudioPlayer(ctx.applicationContext, path, knownDurationMs) }
    DisposableEffect(player) { onDispose { player.release() } }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { player.release() }
    LaunchedEffect(stop) { if (stop) player.release() }
    LaunchedEffect(player.playing) {
        while (player.playing) {
            player.refresh()
            delay(250)
        }
    }
    return player
}
