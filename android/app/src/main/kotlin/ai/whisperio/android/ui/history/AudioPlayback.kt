package ai.whisperio.android.ui.history

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaDataSource
import android.media.MediaPlayer
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import ai.whisperio.android.security.AudioCipher
import java.io.File
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * CONTRACT-1.1 F4: plays one kept clip with the platform [MediaPlayer]. Transient audio focus (speech), pauses when
 * focus is lost or the output becomes noisy (headphones unplugged), never starts on its own. [release] frees the
 * player and focus; the next [play] prepares it again, so one instance survives ON_STOP.
 *
 * An encrypted clip ([AudioCipher.isEncrypted]) is played through [openEncrypted] (a decrypting [MediaDataSource], no
 * plaintext file): the source is opened off the main thread in [scope], then playback starts. A null result (key
 * gone, file unreadable) leaves the player idle, like an unplayable plain file.
 */
class AudioPlayer(
    private val context: Context,
    private val path: String,
    knownDurationMs: Int,
    private val scope: CoroutineScope? = null,
    private val openEncrypted: (suspend (String) -> MediaDataSource?)? = null,
) {
    var playing by mutableStateOf(false)
        private set
    var positionMs by mutableIntStateOf(0)
        private set
    var durationMs by mutableIntStateOf(knownDurationMs)
        private set

    private var player: MediaPlayer? = null
    private var source: MediaDataSource? = null
    private var opening: Job? = null
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
        val existing = player
        if (existing != null) return startPlayback(existing)
        if (AudioCipher.isEncrypted(path)) return playEncrypted()
        val mp = prepare(null) ?: return
        startPlayback(mp)
    }

    private fun playEncrypted() {
        val open = openEncrypted ?: return
        val sc = scope ?: return
        if (opening?.isActive == true) return
        opening = sc.launch {
            // withContext can return a source and then throw CancellationException (release() cancelled us), which
            // would drop the value on the floor; hold it here and close it unless prepare() took ownership.
            var ds: MediaDataSource? = null
            try {
                withContext(Dispatchers.IO) { ds = open(path) }
                val src = ds ?: return@launch
                ensureActive()
                val mp = try { prepare(src) } finally { ds = null } // prepare() closes src itself on failure
                startPlayback(mp ?: return@launch)
            } finally {
                closeQuietly(ds)
            }
        }
    }

    private fun startPlayback(mp: MediaPlayer) {
        if (playing) return
        if (!requestFocus()) return
        try {
            // A seek made before the first play hit no player yet; apply it now.
            if (positionMs > 0) mp.seekTo(positionMs)
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
        opening?.cancel()
        opening = null
        playing = false
        unregisterNoisy()
        abandonFocus()
        player?.let { try { it.release() } catch (_: IllegalStateException) { /* ignore */ } }
        player = null
        try { source?.close() } catch (_: IOException) { /* ignore */ }
        source = null
        positionMs = 0
    }

    private fun prepare(ds: MediaDataSource?): MediaPlayer? {
        val mp = MediaPlayer()
        return try {
            mp.setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            if (ds != null) mp.setDataSource(ds) else mp.setDataSource(path)
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
            source = ds
            mp
        } catch (_: IOException) {
            mp.release(); closeQuietly(ds); null
        } catch (_: RuntimeException) {
            mp.release(); closeQuietly(ds); null
        }
    }

    private fun closeQuietly(ds: MediaDataSource?) {
        try { ds?.close() } catch (_: IOException) { /* ignore */ }
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
fun rememberAudioPlayer(
    path: String,
    knownDurationMs: Int,
    stop: Boolean,
    audioCipher: AudioCipher? = null,
    recordingId: String = "",
): AudioPlayer {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    val player = remember(path, audioCipher, recordingId) {
        val opener: (suspend (String) -> MediaDataSource?)? =
            if (audioCipher == null) null else { p -> audioCipher.openSeekable(File(p), recordingId)?.let { DecryptingMediaDataSource(it) } }
        AudioPlayer(ctx.applicationContext, path, knownDurationMs, scope, opener)
    }
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
