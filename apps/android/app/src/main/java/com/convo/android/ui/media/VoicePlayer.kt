package com.convo.android.ui.media

import com.convo.android.MainActivity
import com.convo.android.i18n.*
import com.convo.android.ui.components.*
import com.convo.android.ui.theme.*
import com.convo.android.ui.thread.formatDuration
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.media.MediaPlayer
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.io.File

/** One voice note plays at a time (starting another pauses the current one), like WhatsApp. */
private object VoicePlayback {
    var current: MediaPlayer? = null
    var currentId by mutableStateOf<String?>(null)
}

/**
 * Inline voice-note / audio player in the bubble (WhatsApp): play/pause, seek bar, time and speed
 * (1×, 1.5×, 2×). Plays the decrypted bytes from a private temp file that is deleted afterwards;
 * nothing opens full screen.
 */
@Composable fun VoicePlayer(app: MainActivity, message: JSONObject, conversation: String, index: Int, pointer: JSONObject) {
    val colors = LocalConvoColors.current
    val id = pointer.optString("attachmentId")
    var player by remember(id) { mutableStateOf<MediaPlayer?>(null) }
    var file by remember(id) { mutableStateOf<File?>(null) }
    var loading by remember(id) { mutableStateOf(false) }
    var position by remember(id) { mutableIntStateOf(0) }
    var duration by remember(id) { mutableIntStateOf(pointer.optLong("durationMs").toInt()) }
    var speed by remember(id) { mutableFloatStateOf(1f) }
    val playing = VoicePlayback.currentId == id && player?.isPlaying == true
    DisposableEffect(id) { onDispose { player?.let { if (VoicePlayback.current === it) { VoicePlayback.current = null; VoicePlayback.currentId = null }; it.release() }; file?.delete() } }
    LaunchedEffect(playing) { while (playing) { position = player?.currentPosition ?: 0; delay(200) } }
    fun start(p: MediaPlayer) {
        VoicePlayback.current?.takeIf { it !== p }?.pause()
        VoicePlayback.current = p; VoicePlayback.currentId = id
        runCatching { p.playbackParams = p.playbackParams.setSpeed(speed) }
        p.start()
    }
    fun toggle() {
        val p = player
        if (p != null) { if (p.isPlaying) { p.pause(); VoicePlayback.currentId = null } else start(p); return }
        loading = true
        app.fetchMedia(message, conversation, index, pointer) { bytes ->
            app.runOnUiThread {
                loading = false
                if (bytes == null) { app.error = tr("Could not load the voice message."); return@runOnUiThread }
                val temp = File(app.cacheDir, "convo-preview-${java.util.UUID.randomUUID()}").apply { writeBytes(bytes) }
                file = temp
                val created = runCatching { MediaPlayer().apply { setDataSource(temp.path); prepare() } }.getOrNull()
                if (created == null) { app.error = tr("This audio format can’t be played on this phone."); return@runOnUiThread }
                created.setOnCompletionListener { position = 0; VoicePlayback.currentId = null; it.seekTo(0) }
                duration = created.duration.takeIf { it > 0 } ?: duration
                player = created; start(created)
            }
        }
    }
    Row(Modifier.widthIn(min = 240.dp, max = 300.dp).background(colors.canvas, RoundedCornerShape(8.dp)).padding(horizontal = 4.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(::toggle, enabled = !loading) {
            if (loading) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
            else Icon(if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, if (playing) "Pause" else "Play voice message", Modifier.size(30.dp))
        }
        Column(Modifier.weight(1f)) {
            Slider(value = if (duration > 0) position.toFloat() / duration else 0f, onValueChange = { f -> position = (f * duration).toInt(); player?.seekTo(position) },
                enabled = player != null, modifier = Modifier.height(28.dp))
            Row {
                Icon(if (pointer.optBoolean("voiceNote")) Icons.Outlined.Mic else Icons.Outlined.Headphones, null, Modifier.size(14.dp), tint = colors.textSecondary)
                RawText(" " + formatDuration((if (player != null && (playing || position > 0)) position else duration).toLong()), fontSize = 12.sp, color = colors.textSecondary)
            }
        }
        // Speed chip (1× → 1.5× → 2×), applied live while playing.
        TextButton({ speed = when (speed) { 1f -> 1.5f; 1.5f -> 2f; else -> 1f }; player?.takeIf { it.isPlaying }?.let { p -> runCatching { p.playbackParams = p.playbackParams.setSpeed(speed) } } }, contentPadding = PaddingValues(4.dp)) {
            RawText(if (speed == 1f) "1×" else if (speed == 1.5f) "1.5×" else "2×", fontSize = 13.sp, color = colors.accentText)
        }
    }
}
