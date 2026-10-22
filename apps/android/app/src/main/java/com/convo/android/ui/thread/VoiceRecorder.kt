package com.convo.android.ui.thread

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.calls.*
import com.convo.android.i18n.*
import com.convo.android.push.*
import com.convo.android.ui.communities.*
import com.convo.android.ui.chats.*
import com.convo.android.ui.components.*
import com.convo.android.ui.contacts.*
import com.convo.android.ui.info.*
import com.convo.android.ui.linking.*
import com.convo.android.ui.locks.*
import com.convo.android.ui.media.*
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import android.util.Base64
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import java.io.File

/**
 * Voice-note capture matching the web recorder: Opus in OGG where supported (Android 10+, plays in
 * every browser), AAC/MP4 otherwise; pause/resume; 15-minute cap. Audio stays in no-backup private
 * storage until it is handed to the encrypting core, then the temporary file is deleted.
 */
class VoiceRecorder(private val context: Context) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L
    private var accumulated = 0L
    var paused = false; private set
    val ogg = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

    val elapsedMs get() = accumulated + if (recorder != null && !paused) SystemClock.elapsedRealtime() - startedAt else 0

    fun start(): Boolean {
        cancel()
        val target = File(context.noBackupFilesDir, "convo-voice-${System.nanoTime()}.${if (ogg) "ogg" else "m4a"}")
        val created = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        return try {
            created.setAudioSource(MediaRecorder.AudioSource.MIC)
            if (ogg) { created.setOutputFormat(MediaRecorder.OutputFormat.OGG); created.setAudioEncoder(MediaRecorder.AudioEncoder.OPUS) }
            else { created.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4); created.setAudioEncoder(MediaRecorder.AudioEncoder.AAC) }
            created.setAudioChannels(1); created.setAudioSamplingRate(48_000); created.setAudioEncodingBitRate(32_000)
            created.setMaxDuration(MAX_DURATION_MS.toInt())
            created.setOutputFile(target.absolutePath)
            created.prepare(); created.start()
            recorder = created; file = target; startedAt = SystemClock.elapsedRealtime(); accumulated = 0; paused = false
            true
        } catch (_: Exception) { created.release(); target.delete(); false }
    }

    fun pause() { if (recorder != null && !paused) { recorder?.pause(); accumulated += SystemClock.elapsedRealtime() - startedAt; paused = true } }
    fun resume() { if (recorder != null && paused) { recorder?.resume(); startedAt = SystemClock.elapsedRealtime(); paused = false } }

    /** Stops and returns base64url audio, file name, MIME type and duration; null if too short or failed. */
    fun finish(): VoiceNote? {
        val active = recorder ?: return null
        val duration = elapsedMs
        val output = file
        recorder = null; file = null
        return try {
            active.stop(); active.release()
            val bytes = output?.readBytes() ?: return null
            if (duration < 500 || bytes.isEmpty()) null
            else VoiceNote(Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING),
                "voice-note-${System.currentTimeMillis()}.${if (ogg) "ogg" else "m4a"}", if (ogg) "audio/ogg" else "audio/mp4", duration)
        } catch (_: Exception) { active.release(); null } finally { output?.delete() }
    }

    fun cancel() { recorder?.let { try { it.stop() } catch (_: Exception) { } ; it.release() }; recorder = null; file?.delete(); file = null; paused = false }

    data class VoiceNote(val data: String, val name: String, val mime: String, val durationMs: Long)
    companion object { const val MAX_DURATION_MS = 15 * 60 * 1000L }
}

fun formatDuration(ms: Long): String { val s = ms / 1000; return "%d:%02d".format(s / 60, s % 60) }

/**
 * Composer trailing control: microphone while the text field is empty, then a recording bar with
 * cancel, live timer, pause/resume and send — the same flow as the web composer.
 */
@Composable fun VoiceComposer(app: MainActivity, conversationId: String, onRecording: (Boolean) -> Unit) {
    val recorder = remember { VoiceRecorder(app) }
    var recording by remember { mutableStateOf(false) }
    var paused by remember { mutableStateOf(false) }
    var elapsed by remember { mutableLongStateOf(0L) }
    DisposableEffect(conversationId) { onDispose { recorder.cancel(); onRecording(false) } }
    LaunchedEffect(recording, paused) {
        while (recording) {
            elapsed = recorder.elapsedMs
            if (elapsed >= VoiceRecorder.MAX_DURATION_MS) { send(app, recorder, conversationId); recording = false; onRecording(false) }
            kotlinx.coroutines.delay(200)
        }
    }
    fun begin() {
        if (recorder.start()) { recording = true; paused = false; elapsed = 0; onRecording(true) }
        else app.error = "Could not start recording. Check that no other app is using the microphone."
    }
    if (!recording) {
        com.convo.android.ui.components.RoundActionButton(Icons.Outlined.Mic, "Record voice message") {
            if (ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) begin()
            else app.requestMicrophone { granted -> if (granted) begin() else app.error = "Microphone permission was not granted. You can still send text and files." }
        }
        return
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
        IconButton({ recorder.cancel(); recording = false; onRecording(false) }) { Icon(Icons.Outlined.Delete, "Cancel recording", tint = MaterialTheme.colorScheme.error) }
        Box(Modifier.size(10.dp).background(if (paused) MaterialTheme.colorScheme.outline else MaterialTheme.colorScheme.error, CircleShape))
        Text(formatDuration(elapsed), Modifier.padding(horizontal = 8.dp))
        IconButton({ if (paused) recorder.resume() else recorder.pause(); paused = recorder.paused }) {
            Icon(if (paused) Icons.Outlined.Mic else Icons.Outlined.Pause, if (paused) "Resume recording" else "Pause recording")
        }
        com.convo.android.ui.components.RoundActionButton(Icons.AutoMirrored.Outlined.Send, "Send voice message") { send(app, recorder, conversationId); recording = false; onRecording(false) }
    }
}

private fun send(app: MainActivity, recorder: VoiceRecorder, conversationId: String) {
    val note = recorder.finish() ?: run { app.notice = "Voice message too short"; return }
    app.call("attach", obj("conversationId" to conversationId, "data" to note.data, "name" to note.name, "mime" to note.mime, "voice" to true, "duration" to note.durationMs))
}
