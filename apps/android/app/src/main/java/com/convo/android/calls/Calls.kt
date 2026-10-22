package com.convo.android.calls

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
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
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.Manifest
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.RoomOptions
import io.livekit.android.e2ee.BaseKeyProvider
import io.livekit.android.e2ee.E2EEOptions
import io.livekit.android.e2ee.E2EEState
import io.livekit.android.events.RoomEvent
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Native calls (ADR-0006). Signalling, authorization and history come from the shared core over
 * the bridge; media uses the official LiveKit Android SDK against the self-hosted SFU with
 * mandatory frame encryption using the key from the E2EE ring. No unencrypted fallback.
 */
class CallManager(private val app: MainActivity) {
    data class Active(val callId: String?, val conversationId: String, val video: Boolean, val direction: String,
        val phase: String, val reason: String? = null, val connectedAt: Long? = null)

    var call by mutableStateOf<Active?>(null); private set
    /** Bumped on every room event so Compose re-reads participants and tracks. */
    var version by mutableIntStateOf(0); private set
    var room: Room? = null; private set
    var micOn by mutableStateOf(true); private set
    var cameraOn by mutableStateOf(false); private set
    private val e2ee = mutableMapOf<String, E2EEState>()
    private var keyProvider: BaseKeyProvider? = null
    /** Current group-call media key (generation 0 = the ring's key). */
    private var keyGeneration = 0
    private var currentKey: String? = null
    private var events: Job? = null
    private var ringtone: Ringtone? = null

    val encrypted: Boolean get() {
        val remote = room?.remoteParticipants?.values.orEmpty()
        val states = remote.flatMap { p -> p.trackPublications.values.mapNotNull { it.track?.let { _ -> e2ee[it.sid] } } }
        return remote.isNotEmpty() && states.isNotEmpty() && states.all { it == E2EEState.OK || it == E2EEState.KEY_RATCHETED }
    }

    private fun permitted(video: Boolean) = ContextCompat.checkSelfPermission(app, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
        (!video || ContextCompat.checkSelfPermission(app, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)

    private fun withPermissions(video: Boolean, then: () -> Unit) {
        if (permitted(video)) then() else app.requestCallPermissions(video) { granted -> if (granted) then() else app.error = "Convo needs microphone${if (video) " and camera" else ""} access for calls." }
    }

    fun start(conversationId: String, video: Boolean) {
        if (call != null) return
        withPermissions(video) {
            call = Active(null, conversationId, video, "out", "outgoing")
            app.call("startCall", obj("conversationId" to conversationId, "video" to video), quiet = true) { value ->
                val result = value as? JSONObject
                val join = result?.optJSONObject("join")
                if (join == null) { finish("failed"); return@call }
                call = call?.copy(callId = join.optString("callId"))
                ring(outgoing = true)
                connect(join, result.optString("key"), video)
                app.lifecycleScope.launch {
                    delay(RING_TIMEOUT_MS)
                    val active = call
                    if (active?.callId == join.optString("callId") && active.phase == "outgoing") { end(answered = false); finish("noAnswer") }
                }
            }
        }
    }

    fun onEvent(event: JSONObject) {
        val active = call
        if (event.optString("type") == "incoming") {
            val invite = event.optJSONObject("invite") ?: return
            if (active != null && active.phase != "ended") { app.call("declineCall", obj("callId" to invite.optString("callId"), "busy" to true), quiet = true); return }
            call = Active(invite.optString("callId"), invite.optString("conversationId"), invite.optBoolean("video"), "in", "incoming")
            ring(outgoing = false)
            app.lifecycleScope.launch {
                delay(maxOf(1000L, invite.optLong("at") + RING_TIMEOUT_MS - System.currentTimeMillis()))
                if (call?.callId == invite.optString("callId") && call?.phase == "incoming") { app.call("missCall", obj("callId" to invite.optString("callId")), quiet = true); finish("noAnswer") }
            }
            return
        }
        if (active == null || active.callId != event.optString("callId") || active.phase == "ended") return
        if (event.optString("type") == "rekey") { applyKey(event.optString("key"), event.optInt("generation")); return }
        val group = active.conversationId.startsWith("g:")
        val action = event.optString("action")
        when {
            event.optBoolean("fromSelf") && active.phase == "incoming" -> finish("answeredElsewhere")
            action == "decline" && !group -> finish("declined")
            action == "busy" && !group -> finish("busy")
            action == "cancel" || (action == "end" && !group) -> finish("ended")
        }
    }

    fun accept() {
        val active = call ?: return
        if (active.phase != "incoming") return
        withPermissions(active.video) {
            stopRing(); call = active.copy(phase = "connecting")
            app.call("answerCall", obj("callId" to active.callId), quiet = true) { value ->
                val result = value as? JSONObject
                val join = result?.optJSONObject("join")
                if (join == null) finish("failed") else connect(join, result.optString("key"), active.video, result.optInt("generation"))
            }
        }
    }

    fun decline() {
        val active = call ?: return
        app.call("declineCall", obj("callId" to active.callId), quiet = true)
        finish("declined")
    }

    fun hangUp() {
        val active = call ?: return
        if (active.phase == "incoming") { decline(); return }
        end(answered = active.phase == "connected")
        finish("ended")
    }

    fun toggleMic() { val r = room ?: return; app.lifecycleScope.launch { micOn = !micOn; r.localParticipant.setMicrophoneEnabled(micOn) } }
    fun toggleCamera() { val r = room ?: return; app.lifecycleScope.launch { cameraOn = !cameraOn; r.localParticipant.setCameraEnabled(cameraOn) } }

    private fun end(answered: Boolean) {
        val active = call ?: return
        if (active.callId != null) app.call("endCall", obj("callId" to active.callId, "conversationId" to active.conversationId, "answered" to answered), quiet = true)
    }

    /**
     * Installs a newer media key (ADR-0006 rekey): same ordering rule as the web client (higher
     * generation wins, ties → smaller key). Older keys stay in the ring for in-flight frames.
     */
    private fun applyKey(key: String, generation: Int) {
        val current = currentKey
        if (current != null && !(generation > keyGeneration || (generation == keyGeneration && key < current))) return
        currentKey = key; keyGeneration = generation
        val index = generation % KEY_RING
        keyProvider?.setSharedKey(key, index)
        // The SDK has no public API to move senders to a new index; FrameCryptor.setKeyIndex is
        // public but the cryptors are private to E2EEManager. Receivers read the index from frames.
        try {
            val manager = room?.e2eeManager ?: return
            val field = manager.javaClass.getDeclaredField("frameCryptors").apply { isAccessible = true }
            (field.get(manager) as? Map<*, *>)?.values?.forEach { (it as? livekit.org.webrtc.FrameCryptor)?.keyIndex = index }
            android.util.Log.i("Convo", "Call rekey: generation $generation active")
        } catch (e: Exception) { android.util.Log.w("Convo", "Call rekey: sender key index not switched (${e.javaClass.simpleName}); previous key stays in use") }
    }

    /** After someone leaves a group call, the smallest remaining identity rotates the key. */
    private fun rotateIfLeader() {
        val active = call ?: return
        val r = room ?: return
        if (active.callId == null || !active.conversationId.startsWith("g:")) return
        val identities = listOf(r.localParticipant.identity?.value) + r.remoteParticipants.values.map { it.identity?.value }
        if (identities.filterNotNull().minOrNull() != r.localParticipant.identity?.value) return
        app.call("rotateCallKey", obj("conversationId" to active.conversationId, "callId" to active.callId, "after" to keyGeneration), quiet = true) { value ->
            (value as? JSONObject)?.let { applyKey(it.optString("key"), it.optInt("generation")) }
        }
    }

    private fun connect(join: JSONObject, key: String, video: Boolean, generation: Int = 0) {
        // Loads WebRTC's native library; the frame-cryptor key provider needs it.
        LiveKit.init(app.applicationContext)
        val keyProvider = BaseKeyProvider()
        this.keyProvider = keyProvider
        currentKey = null; keyGeneration = 0
        keyProvider.setSharedKey(key, generation % KEY_RING)
        currentKey = key; keyGeneration = generation
        val created = LiveKit.create(app.applicationContext, RoomOptions(adaptiveStream = true, dynacast = true, e2eeOptions = E2EEOptions(keyProvider)),
            LiveKitOverrides(okHttpClient = DevelopmentTls(app).okHttp()))
        room = created
        events = app.lifecycleScope.launch {
            created.events.events.collect { event: RoomEvent ->
                if (event is RoomEvent.TrackE2EEStateEvent) event.publication.sid.let { e2ee[it] = event.state }
                if (event is RoomEvent.ParticipantDisconnected) rotateIfLeader()
                // The server removes devices of accounts that are no longer group members.
                if (event is RoomEvent.Disconnected && event.reason == io.livekit.android.events.DisconnectReason.PARTICIPANT_REMOVED) { finish("removed"); return@collect }
                // Our own hang-up cancels this collector first, so any other disconnect is a lost connection.
                if (event is RoomEvent.Disconnected && event.reason != io.livekit.android.events.DisconnectReason.CLIENT_INITIATED) { end(answered = true); finish("lost"); return@collect }
                version++
                onRoomChanged()
            }
        }
        app.lifecycleScope.launch {
            try {
                val url = app.serverAddress().replace("https://", "wss://") + join.optString("path", "/rtc").removeSuffix("/").removeSuffix("/rtc")
                created.connect(url, join.optString("token"))
                micOn = true; created.localParticipant.setMicrophoneEnabled(true)
                cameraOn = video; if (video) created.localParticipant.setCameraEnabled(true)
                version++; onRoomChanged()
            } catch (_: Exception) { end(answered = false); finish("failed") }
        }
    }

    private fun onRoomChanged() {
        val active = call ?: return
        val others = room?.remoteParticipants?.size ?: 0
        if (others > 0 && active.phase != "connected" && active.phase != "ended") { stopRing(); call = active.copy(phase = "connected", connectedAt = System.currentTimeMillis()) }
        if (others == 0 && active.phase == "connected" && !active.conversationId.startsWith("g:")) {
            // A hang-up arrives as an encrypted "end" message (finishing as "ended"). If the other side
            // vanished without one, their connection dropped: say so instead of "Call ended".
            val callId = active.callId
            app.lifecycleScope.launch {
                delay(2500)
                val still = call
                if (still != null && still.callId == callId && still.phase == "connected" && (room?.remoteParticipants?.size ?: 0) == 0) { end(answered = true); finish("lost") }
            }
        }
    }

    private fun finish(reason: String) {
        stopRing()
        events?.cancel(); events = null
        room?.let { it.disconnect(); it.release() }; room = null; e2ee.clear()
        call = call?.copy(phase = "ended", reason = reason)
        app.lifecycleScope.launch { delay(1800); if (call?.phase == "ended") call = null }
    }

    private fun ring(outgoing: Boolean) {
        stopRing()
        if (outgoing) return // the caller hears nothing until the callee answers (status text instead)
        try {
            ringtone = RingtoneManager.getRingtone(app, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.apply {
                audioAttributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build()
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) isLooping = true
                play()
            }
            app.getSystemService(Vibrator::class.java)?.vibrate(VibrationEffect.createWaveform(longArrayOf(0, 600, 900), 0))
        } catch (_: Exception) { }
    }

    private fun stopRing() {
        ringtone?.stop(); ringtone = null
        app.getSystemService(Vibrator::class.java)?.cancel()
    }

    fun release() { finish("ended"); call = null }

    companion object { const val RING_TIMEOUT_MS = 45_000L; private const val KEY_RING = 16 }
}

@Composable fun CallScreen(app: MainActivity) {
    val manager = app.calls
    val call = manager.call ?: return
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(call.phase) { while (true) { now = System.currentTimeMillis(); delay(1000) } }
    val conversation = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == call.conversationId }
    val title = conversation?.optString("title") ?: "Unknown"
    @Suppress("UNUSED_VARIABLE") val tick = manager.version
    val remotes = manager.room?.remoteParticipants?.values?.toList().orEmpty()
    val status = when (call.phase) {
        "incoming" -> if (call.video) "Incoming video call…" else "Incoming voice call…"
        "outgoing" -> "Calling…"
        "connecting" -> "Connecting…"
        "connected" -> formatDuration(now - (call.connectedAt ?: now))
        else -> when (call.reason) { "declined" -> "Call declined"; "busy" -> "Busy on another call"; "noAnswer" -> "No answer"; "failed" -> "Call failed. Check your connection."; "answeredElsewhere" -> "Answered on another device"; "removed" -> "You are no longer in this group"; "lost" -> "The call couldn’t stay connected. One of you may be on a network that can’t reach the call server."; else -> "Call ended" }
    }
    Surface(Modifier.fillMaxSize(), color = Color(0xFF0B141A), contentColor = Color(0xFFF2F5F7)) {
        Box(Modifier.fillMaxSize()) {
            val videoTiles = if (call.video && call.phase == "connected") remotes.mapNotNull { p -> videoOf(p)?.let { p to it } } else emptyList()
            if (videoTiles.isNotEmpty()) Column(Modifier.fillMaxSize()) { videoTiles.forEach { (_, track) -> VideoRenderer(manager, track, Modifier.weight(1f).fillMaxWidth()) } }
            else Column(Modifier.fillMaxWidth().padding(top = 120.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                PersonAvatar(app, call.conversationId, title, 112, group = call.conversationId.startsWith("g:"))
                Text(title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 16.dp))
                Text(status, color = Color(0xFFC7D0D6), modifier = Modifier.padding(top = 6.dp))
                if (call.phase == "connected" && call.conversationId.startsWith("g:")) Text("${remotes.size + 1} in call", color = Color(0xFFC7D0D6))
            }
            if (videoTiles.isNotEmpty()) Text(status, Modifier.align(Alignment.TopCenter).padding(top = 48.dp).background(Color(0x80000000), RoundedCornerShape(50)).padding(horizontal = 12.dp, vertical = 4.dp))
            manager.room?.localParticipant?.let { local -> if (call.video && manager.cameraOn) videoOf(local)?.let { VideoRenderer(manager, it, Modifier.align(Alignment.BottomEnd).padding(end = 16.dp, bottom = 140.dp).size(110.dp, 150.dp)) } }
            Column(Modifier.align(Alignment.BottomCenter).padding(bottom = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                if (call.phase == "connected") Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 16.dp)) {
                    Icon(Icons.Outlined.Lock, null, Modifier.size(14.dp)); Text(if (manager.encrypted) " End-to-end encrypted" else " Securing call…", style = MaterialTheme.typography.bodySmall)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(28.dp)) {
                    if (call.phase == "incoming") {
                        CallButton(Icons.Outlined.CallEnd, "Decline", Color(0xFFC62828)) { manager.decline() }
                        CallButton(if (call.video) Icons.Outlined.Videocam else Icons.Outlined.Call, "Accept", Color(0xFF11713F)) { manager.accept() }
                    } else if (call.phase != "ended") {
                        CallButton(if (manager.micOn) Icons.Outlined.Mic else Icons.Outlined.MicOff, if (manager.micOn) "Mute" else "Unmute", Color(0x29FFFFFF), enabled = manager.room != null) { manager.toggleMic() }
                        if (call.video) CallButton(if (manager.cameraOn) Icons.Outlined.Videocam else Icons.Outlined.VideocamOff, if (manager.cameraOn) "Turn camera off" else "Turn camera on", Color(0x29FFFFFF), enabled = manager.room != null) { manager.toggleCamera() }
                        CallButton(Icons.Outlined.CallEnd, "End call", Color(0xFFC62828)) { manager.hangUp() }
                    }
                }
            }
        }
    }
}

private fun videoOf(participant: Participant): VideoTrack? =
    participant.trackPublications.values.firstOrNull { it.source == Track.Source.CAMERA && !it.muted }?.track as? VideoTrack

@Composable private fun VideoRenderer(manager: CallManager, track: VideoTrack, modifier: Modifier) {
    val room = manager.room ?: return
    var renderer by remember { mutableStateOf<TextureViewRenderer?>(null) }
    AndroidView(factory = { context -> TextureViewRenderer(context).also { room.initVideoRenderer(it); renderer = it } }, modifier = modifier)
    DisposableEffect(track, renderer) {
        val sink = renderer
        sink?.let { track.addRenderer(it) }
        onDispose { sink?.let { track.removeRenderer(it) } }
    }
}

@Composable private fun CallButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, color: Color, enabled: Boolean = true, onClick: () -> Unit) {
    FilledIconButton(onClick, Modifier.size(64.dp), enabled = enabled, shape = CircleShape, colors = IconButtonDefaults.filledIconButtonColors(containerColor = color, contentColor = Color.White)) {
        Icon(icon, label, Modifier.size(28.dp))
    }
}

/** Calls tab: device-local history from the shared core, with call-back buttons. */
@Composable fun CallsTab(app: MainActivity) {
    var entries by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    val refresh = app.callLogVersion
    LaunchedEffect(refresh) { app.call("callLog", quiet = true) { value -> entries = (value as? JSONArray)?.objects().orEmpty() } }
    val conversations = app.snapshot.optJSONArray("conversations")?.objects().orEmpty().associateBy { it.optString("id") }
    if (entries.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Outlined.Call, null, Modifier.size(56.dp)); Text("No calls yet", style = MaterialTheme.typography.headlineSmall)
            Text("Start an end-to-end encrypted voice or video call from any chat.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    LazyColumn {
        item { TextButton({ app.call("clearCallLog") }, Modifier.padding(start = 8.dp)) { Text("Clear call history") } }
        items(entries.filter { !app.locks.locked(it.optString("conversationId")) }, key = { it.optString("callId") }) { e ->
            val c = conversations[e.optString("conversationId")]
            val status = e.optString("status")
            val missed = e.optString("direction") == "in" && status in setOf("missed", "cancelled")
            Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                PersonAvatar(app, e.optString("conversationId"), c?.optString("title") ?: "?", group = c?.optString("kind") == "group")
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(c?.optString("title") ?: "Unknown", color = if (missed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
                    Text("${if (e.optString("direction") == "in") "↙" else "↗"} ${status.replaceFirstChar { it.uppercase() }} · ${SimpleDateFormat("dd.MM HH:mm", Locale.getDefault()).format(Date(e.optLong("startedAt")))}",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (c != null && !c.optBoolean("left") && !c.optBoolean("adminOnly")) IconButton({ app.calls.start(c.optString("id"), e.optBoolean("video")) }, enabled = app.calls.call == null) {
                    Icon(if (e.optBoolean("video")) Icons.Outlined.Videocam else Icons.Outlined.Call, if (e.optBoolean("video")) "Video call" else "Voice call")
                }
            }
        }
    }
}
