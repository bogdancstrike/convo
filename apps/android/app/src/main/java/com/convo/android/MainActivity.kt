package com.convo.android

import com.convo.android.R
import com.convo.android.BuildConfig
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
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.util.Base64
import android.view.WindowManager
import androidx.fragment.app.FragmentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import net.openid.appauth.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

class MainActivity : FragmentActivity() {
    val locks by lazy { LockManager(this) }
    val calls by lazy { CallManager(this) }
    /** Bumped when the shared core reports call-history changes. */
    var callLogVersion by mutableIntStateOf(0); private set
    private var callPermissionCallback: ((Boolean) -> Unit)? = null
    private val callPermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        callPermissionCallback?.invoke(result.values.all { it }); callPermissionCallback = null
    }
    fun requestCallPermissions(video: Boolean, callback: (Boolean) -> Unit) {
        callPermissionCallback = callback
        callPermissions.launch(if (video) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA) else arrayOf(Manifest.permission.RECORD_AUDIO))
    }
    private lateinit var bridge: ProtocolBridge
    private lateinit var auth: AuthorizationService
    private val io = Executors.newSingleThreadExecutor()
    var snapshot by mutableStateOf(JSONObject()); private set
    var phase by mutableStateOf("loading"); private set
    var linkCode by mutableStateOf(""); private set
    var error by mutableStateOf<String?>(null)
    var notice by mutableStateOf<String?>(null)
    var active by mutableStateOf<String?>(null)
    var selectedTab by mutableStateOf("Chats")
    var route by mutableStateOf("list")
    var threadSearch by mutableStateOf(false)
    var phoneMatches by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var discovering by mutableStateOf(false); private set
    var discoveryDone by mutableStateOf(false); private set
    private var localNames = emptyMap<String, String>()
    private var fileCallback: ((String, String, String) -> Unit)? = null
    // DocumentPicker may outlive this activity/process. Keep one pending export in private,
    // backup-excluded storage until its result returns; never create a silent empty download.
    private val pendingExport get() = java.io.File(noBackupFilesDir, "convo-pending-export")
    private val server get() = getPreferences(MODE_PRIVATE).getString("server", DEFAULT_SERVER)!!.trimEnd('/')

    private val authLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (data == null) { phase = "welcome"; return@registerForActivityResult }
        val response = AuthorizationResponse.fromIntent(data)
        if (response == null) { error = "Sign-in was cancelled or could not finish."; phase = "welcome"; return@registerForActivityResult }
        phase = "loading"
        auth.performTokenRequest(response.createTokenExchangeRequest()) { token, _ -> runOnUiThread {
            if (token?.accessToken == null) { error = "Sign-in could not finish. Check your server connection."; phase = "welcome" }
            else call("signIn", obj("token" to token.accessToken))
        } }
    }
    private var scanCallback: ((String?) -> Unit)? = null
    private val qrScanner = registerForActivityResult(com.journeyapps.barcodescanner.ScanContract()) { result -> scanCallback?.invoke(result.contents); scanCallback = null }
    /** Scans a device-linking QR code with the embedded ZXing scanner (it asks for camera access). */
    fun scanLinkQr(callback: (String?) -> Unit) {
        scanCallback = callback
        qrScanner.launch(com.journeyapps.barcodescanner.ScanOptions().setDesiredBarcodeFormats(com.journeyapps.barcodescanner.ScanOptions.QR_CODE)
            .setPrompt(tr("Scan the QR code shown on the new device")).setBeepEnabled(false).setOrientationLocked(false))
    }
    private var micCallback: ((Boolean) -> Unit)? = null
    /** Android's screen-capture consent; a grant starts sharing in the current call. */
    private val screenCapture = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val data = result.data
        if (result.resultCode == RESULT_OK && data != null) calls.startScreenShare(data)
    }
    fun requestScreenCapture() {
        val manager = getSystemService(android.media.projection.MediaProjectionManager::class.java) ?: return
        screenCapture.launch(manager.createScreenCaptureIntent())
    }
    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> micCallback?.invoke(granted); micCallback = null }
    fun requestMicrophone(callback: (Boolean) -> Unit) { micCallback = callback; micPermission.launch(Manifest.permission.RECORD_AUDIO) }
    private val contactsPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) discoverContacts() else error = "Contacts permission was not granted. Search by name or phone number instead."
    }
    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) io.execute {
            try {
                val mime = contentResolver.getType(uri) ?: "application/octet-stream"
                var name = "file"
                contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use {
                    if (it.moveToFirst()) { name = it.getString(0) ?: name; if (!it.isNull(1) && it.getLong(1) > attachmentLimit()) throw IllegalArgumentException() }
                }
                val bytes = contentResolver.openInputStream(uri)!!.use { stream ->
                    val out = java.io.ByteArrayOutputStream(); val chunk = ByteArray(65536)
                    while (true) { val count = stream.read(chunk); if (count < 0) break; if (out.size() + count > attachmentLimit()) throw IllegalArgumentException(); out.write(chunk, 0, count) }; out.toByteArray()
                }
                val encoded = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
                runOnUiThread { fileCallback?.invoke(encoded, name, mime); fileCallback = null }
            } catch (_: Exception) { runOnUiThread { error = "Could not open that file. Maximum size is ${attachmentLimit() / 1048576} MB." } }
        }
    }
    private val savePicker = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val uri = result.data?.data
        io.execute {
            try {
                if (result.resultCode == RESULT_OK && uri != null) {
                    val expected = getPreferences(MODE_PRIVATE).getLong("pendingExportSize", -1)
                    check(expected >= 0 && pendingExport.isFile && pendingExport.length() == expected)
                    val output = checkNotNull(contentResolver.openOutputStream(uri, "wt"))
                    output.use { dest -> pendingExport.inputStream().use { it.copyTo(dest) }; dest.flush() }
                    runOnUiThread { notice = "File saved" }
                }
            } catch (_: Exception) { runOnUiThread { error = "Could not save that file. Download it again to retry." } }
            finally { pendingExport.delete(); getPreferences(MODE_PRIVATE).edit().remove("pendingExportSize").commit() }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Opened from a ringing call notification: show over the lock screen like a call app.
        if (intent?.getBooleanExtra(CallWake.EXTRA_RING, false) == true && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) { setShowWhenLocked(true); setTurnScreenOn(true) }
        // Pin the server for this install (existing installs keep theirs: the IndexedDB origin holds their keys).
        if (!getPreferences(MODE_PRIVATE).contains("server")) getPreferences(MODE_PRIVATE).edit().putString("server", DEFAULT_SERVER).apply()
        cacheDir.listFiles()?.filter { it.name.startsWith("convo-preview-") }?.forEach { it.delete() }
        if (!BuildConfig.DEBUG || android.os.Build.HARDWARE != "ranchu") window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        MessageNotifications.createChannel(this)
        auth = AuthorizationService(this, AppAuthConfiguration.Builder().setConnectionBuilder(DevelopmentTls(this)).build())
        PushRegistration.activity = java.lang.ref.WeakReference(this)
        bridge = ProtocolBridge(this, server) { type, value ->
            if (BuildConfig.DEBUG && type == "diagnostic") android.util.Log.d("ConvoCore", value.toString())
            when (type) {
                "phase" -> { phase = value.optString("name"); linkCode = value.optString("code"); if (phase == "ready") { refreshCredentialStatus(); syncPush(); offerNotifications(); pendingCallLink?.let { pendingCallLink = null; calls.joinLink(it) } }; if (phase == "welcome") io.execute { mediaCache.clear() }; ConnectionService.sync(this, stayConnected && phase == "ready") }
                "call" -> calls.onEvent(value)
                "alert" -> { if (BuildConfig.DEBUG) android.util.Log.d("ConvoPush", "alert (foreground=$isInForeground)"); MessageNotifications.show(this, value) }
                "callLog" -> callLogVersion++
                "typing" -> value.optString("conversationId").takeIf { it.isNotBlank() }?.let { typingUntil[it] = value.optLong("until") }
                "snapshot" -> { snapshot = value; PushRegistration.setNotificationsEnabled(this, value.optJSONObject("settings")?.optBoolean("notifications") == true); Strings.locale = value.optJSONObject("settings")?.optString("locale")?.takeIf { it == "ro" } ?: "en"; active = value.optString("active").takeIf { it.isNotBlank() && it != "null" } }
            }
        }
        handleCallLink(intent)
        setContent { ConvoTheme(snapshot.optJSONObject("settings")?.optString("theme") ?: "system") {
            Box {
                AndroidView(factory = { bridge.webView }, modifier = Modifier.size(1.dp))
                // Content is not composed at all while locked, so nothing flashes on resume.
                if (locks.appLock && !locks.appUnlocked && phase == "ready") AppLockScreen(this@MainActivity) else ConvoApp(this@MainActivity)
                // Calls stay above navigation (and the lock screen, so an incoming call can be answered).
                if (calls.call != null) CallScreen(this@MainActivity)
            }
        } }
    }
    fun call(method: String, args: JSONObject = JSONObject(), success: String? = null, quiet: Boolean = false, then: (Any?) -> Unit = {}) {
        bridge.command(method, args) { result ->
            if (result.optBoolean("ok")) { if (success != null) notice = success; then(if (result.has("value")) result.opt("value") else JSONObject.NULL) } else {
                if (!quiet) error = when (result.optString("error")) {
                    "recovery-required" -> "Save a recovery code in Settings → History and recovery before logging out of your last device."
                    "FORBIDDEN_ROLE" -> "Only a group owner or admin can do that."
                    "edit-not-allowed" -> "This message can no longer be edited."
                    "ACCOUNT_HAS_DEVICES" -> "Link this phone from a device you trust."
                    "DEVICE_REVOKED" -> "This device was signed out."
                    else -> "Could not complete that action. Your stored messages are still here. Check your connection and try again."
                }
                if (phase == "loading") phase = "welcome"
                then(null)
            }
        }
    }
    fun signIn() {
        val config = AuthorizationServiceConfiguration(Uri.parse("$server/auth/realms/enclave/protocol/openid-connect/auth"), Uri.parse("$server/auth/realms/enclave/protocol/openid-connect/token"))
        val request = AuthorizationRequest.Builder(config, "convo-android", ResponseTypeValues.CODE, Uri.parse("com.convo.android:/oauth2redirect"))
            .setScope("openid profile phone").setPrompt("login").build()
        authLauncher.launch(auth.getAuthorizationRequestIntent(request))
    }
    fun setServer(value: String) {
        val uri = Uri.parse(value.trim())
        if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null || uri.query != null || (!uri.path.isNullOrBlank() && uri.path != "/")) { error = "Enter an HTTPS server address, such as https://convo.doncik.ro"; return }
        if (snapshot.has("accountId")) { error = "Log out before changing the server."; return }
        getPreferences(MODE_PRIVATE).edit().putString("server", value.trim().trimEnd('/')).apply(); recreate()
    }
    fun serverAddress() = server
    /** Batch selection in the open chat ("authorId/id" keys); null when not selecting. */
    var selection by mutableStateOf<Set<String>?>(null)
    fun toggleSelected(key: String) { val s = selection ?: return; selection = if (key in s) s - key else if (s.size < 100) s + key else s }
    /** Whether this account may pin in the open chat (groups/channels: owners and admins). */
    var canPinActive by mutableStateOf(false); private set
    /** Where Back from a thread returns (e.g. the community it was opened from); null = chat list. */
    var threadReturn: Pair<String, String>? = null
    /** Conversation whose snooze dialog is open. */
    var snoozeFor by mutableStateOf<String?>(null)
    /** Opens a chat from another screen; Back returns to that screen and tab. */
    fun openChatFrom(id: String) { val from = route to selectedTab; openChat(id); threadReturn = from }
    fun openChat(id: String) {
        threadReturn = null
        canPinActive = false; call("canPin", obj("id" to id), quiet = true) { canPinActive = it == true }
        if (locks.locked(id) && locks.unlockedChat != id) { locks.authenticate("Open locked chat", "Confirm it’s you") { locks.unlockedChat = id; openChat(id) }; return }
        threadSearch = false; active = id; route = "thread"; selectedTab = "Chats"; call("open", obj("id" to id))
    }
    /**
     * Keycloak's passkey actions (kc_action) in a Custom Tab with Convo's sign-in theme: register a
     * passkey, or remove one after Keycloak's own confirmation. They return to the static result
     * page (the `state` prefix tells it which). A throwaway PKCE challenge satisfies the client
     * policy; the code is unused. Convo itself never holds rights to change credentials.
     */
    fun openPasskeySetup() = openKeycloakAction("webauthn-register-passwordless", "add")
    fun openPasskeyRemoval(credentialId: String) = openKeycloakAction("delete_credential:$credentialId", "remove")
    private fun openKeycloakAction(action: String, kind: String) {
        val random = java.security.SecureRandom()
        fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val verifier = ByteArray(32).also(random::nextBytes)
        val uri = Uri.parse("$server/auth/realms/enclave/protocol/openid-connect/auth").buildUpon()
            .appendQueryParameter("client_id", "enclave-web").appendQueryParameter("redirect_uri", "$server/auth/convo/passkey-done")
            .appendQueryParameter("response_type", "code").appendQueryParameter("scope", "openid")
            .appendQueryParameter("kc_action", action)
            .appendQueryParameter("state", "$kind." + b64(ByteArray(16).also(random::nextBytes)))
            .appendQueryParameter("code_challenge", b64(java.security.MessageDigest.getInstance("SHA-256").digest(verifier)))
            .appendQueryParameter("code_challenge_method", "S256").build()
        try { androidx.browser.customtabs.CustomTabsIntent.Builder().build().launchUrl(this, uri) }
        catch (_: Exception) { error = "No browser is available to manage passkeys." }
    }
    override fun onStop() {
        super.onStop(); isInForeground = false; PushRegistration.appVisible = false; locks.onBackground()
        if (!stayConnected && PushRegistration.endpoint(this) != null && !PushRegistration.rejected(this)) handoffHandler.postDelayed(backgroundHandoff, BACKGROUND_HANDOFF_MS)
    }
    /**
     * WhatsApp-like default: on the first start after sign-in, ask once for Android's notification
     * permission and, if granted, turn message notifications on (previews stay hidden by default).
     * Declining leaves them off; Settings → Notifications can change it later.
     */
    private fun offerNotifications() {
        val prefs = getPreferences(MODE_PRIVATE)
        if (prefs.getBoolean("notificationsOffered", false)) return
        prefs.edit().putBoolean("notificationsOffered", true).apply()
        if (snapshot.optJSONObject("settings")?.optBoolean("notifications") == true) return
        requestNotificationPermission { granted -> if (granted) call("settings", obj("patch" to obj("notifications" to true)), quiet = true) }
    }

    /** Peers typing in direct chats: conversation id → time the indicator lapses (0 = stopped). */
    val typingUntil = androidx.compose.runtime.mutableStateMapOf<String, Long>()
    private var typingSentAt = 0L

    /**
     * Composer changes: like the web composer, at most one "started" every 5 s while text is being
     * entered. The core sends nothing unless typing indicators are on, the chat is a direct chat
     * that is not a pending request, and the socket is online.
     */
    fun typing(conversationId: String, text: String) {
        if (text.isEmpty() || System.currentTimeMillis() - typingSentAt < 5000) return
        typingSentAt = System.currentTimeMillis()
        call("typing", obj("conversationId" to conversationId, "action" to "started"), quiet = true)
    }

    /** After sending: clears the peer's indicator right away instead of waiting for it to lapse. */
    fun typingStopped(conversationId: String) {
        typingSentAt = 0L
        call("typing", obj("conversationId" to conversationId, "action" to "stopped"), quiet = true)
    }

    private companion object {
        /** Grace before handing delivery to push: quick app switches keep the live connection. */
        const val BACKGROUND_HANDOFF_MS = 15_000L
    }
    private val handoffHandler = android.os.Handler(android.os.Looper.getMainLooper())
    private var handedOff = false
    /**
     * Android freezes a backgrounded app within about a minute; its socket then looks alive to the
     * server, which keeps "delivering" there instead of sending push wakes. With a working push
     * registration the app therefore hands delivery over to push shortly after leaving the screen
     * (never during a call); returning to the app reconnects and drains the mailbox.
     */
    /** Whether the protocol engine is signed in and running (safe to read from any thread). */
    val protocolReady: Boolean get() = phase == "ready"

    /**
     * A push wake while this process is still alive (backgrounded after a handoff): reconnect so the
     * core decrypts the waiting mail and posts notifications with the user's preview level (sender,
     * text) and real call rings, then hand delivery back to push. When the protocol engine is not
     * ready ([protocolReady]) the receiver falls back to the generic notification.
     */
    fun wakeForPush() {
        if (BuildConfig.DEBUG) android.util.Log.d("ConvoPush", "wake: phase=$phase foreground=$isInForeground handedOff=$handedOff")
        if (phase != "ready" || isInForeground) return
        if (handedOff) { handedOff = false; call("foreground", quiet = true) }
        handoffHandler.removeCallbacks(backgroundHandoff)
        handoffHandler.postDelayed(backgroundHandoff, BACKGROUND_HANDOFF_MS)
    }
    private val backgroundHandoff = Runnable {
        if (!isInForeground && phase == "ready" && calls.call == null) { call("background", quiet = true); handedOff = true }
    }
    override fun onResume() { super.onResume(); if (phase == "ready") { refreshCredentialStatus(refresh = true); syncPush() } }
    var isInForeground = false; private set
    /** Device-local opt-in for [ConnectionService]. */
    /** Bumped when the push registration state changes (Settings re-reads it). */
    var pushVersion by mutableStateOf(0)
    var stayConnected: Boolean
        get() = getPreferences(MODE_PRIVATE).getBoolean("stayConnected", false)
        set(value) { getPreferences(MODE_PRIVATE).edit().putBoolean("stayConnected", value).apply(); ConnectionService.sync(this, value && phase == "ready") }
    override fun onStart() {
        super.onStart(); isInForeground = true; PushRegistration.appVisible = true; CallWake.cancel(this)
        handoffHandler.removeCallbacks(backgroundHandoff)
        if (handedOff) { handedOff = false; call("foreground", quiet = true) }
    }
    /** Registers with a UnifiedPush distributor and sends a new endpoint to the server once. */
    fun syncPush() {
        PushRegistration.onEndpoint = { runOnUiThread { if (phase == "ready") sendPushEndpoint() } }
        PushRegistration.register(this)
        sendPushEndpoint()
    }

    private var sentPushEndpoint: String? = null
    private fun sendPushEndpoint() {
        val endpoint = PushRegistration.endpoint(this)
        // Once per process (and on every new endpoint): the server may have dropped a stale one.
        if (endpoint != null && (!PushRegistration.synced(this) || sentPushEndpoint != endpoint)) bridge.command("setPushEndpoint", obj("endpoint" to endpoint)) { result ->
            // Only a policy refusal means "wrong push server" (the distributor uses a server this
            // organization does not accept); network errors leave it unsynced to retry on resume.
            val ok = result.optBoolean("ok")
            PushRegistration.setRejected(this, !ok && result.optString("error") == "POLICY_VIOLATION")
            if (ok) { sentPushEndpoint = endpoint; PushRegistration.markSynced(this) }
            pushVersion++
        }
    }
    /** Notification tap: open that chat (lock rules apply in openChat). */
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); intent.getStringExtra(MessageNotifications.EXTRA_CONVERSATION)?.let { if (phase == "ready") openChat(it) }; handleCallLink(intent) }

    /** A call link waiting for sign-in/startup to finish. */
    private var pendingCallLink: String? = null

    /**
     * `https://<this server>/#/call/<token>` opens the group's call (members only; the server
     * decides). Links for other servers are ignored rather than sent anywhere.
     */
    private fun handleCallLink(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.host != Uri.parse(server).host) return
        val token = Regex("^/call/([A-Za-z0-9_-]{43})$").find(data.fragment ?: "")?.groupValues?.get(1) ?: return
        if (phase == "ready") calls.joinLink(token) else pendingCallLink = token
    }

    /** Share sheet with a new member call link for a group (any member may create one). */
    fun shareCallLink(conversationId: String) {
        call("createCallLink", obj("id" to conversationId)) { value ->
            val token = (value as? JSONObject)?.optString("token")?.takeIf { it.isNotBlank() } ?: return@call
            val url = "$server/#/call/$token"
            startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, url), tr("Share call link")))
        }
    }
    private var notificationCallback: ((Boolean) -> Unit)? = null
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> notificationCallback?.invoke(granted); notificationCallback = null }
    fun requestNotificationPermission(callback: (Boolean) -> Unit) {
        if (android.os.Build.VERSION.SDK_INT < 33) { callback(true); return }
        notificationCallback = callback; notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    /** Updates lock eligibility. An unavailable IdP answer keeps the last confirmed value. */
    fun refreshCredentialStatus(refresh: Boolean = false, done: (String) -> Unit = {}) = call("credentials", obj("refresh" to refresh), quiet = true) { value ->
        val status = value as? JSONObject
        val state = when { status == null || status.optString("state") != "available" -> "unavailable"; status.optBoolean("passkey") -> "true"; else -> "false" }
        if (state != "unavailable") {
            locks.passkey = state == "true"
            passkeys = status!!.optJSONArray("passkeys")?.let { a -> (0 until a.length()).mapNotNull { a.optJSONObject(it) } }.orEmpty()
        }
        credentialState = state
        done(state)
    }
    /** The account's passkeys as last reported by the IdP (name, date added, credential ID). */
    var passkeys by mutableStateOf<List<JSONObject>>(emptyList()); private set
    var credentialState by mutableStateOf("loading"); private set
    fun back() {
        when {
            route == "thread" && threadSearch -> threadSearch = false
            route.startsWith("contact-media:") -> route = route.replace("contact-media:", "contact:")
            route.startsWith("contact:") -> route = "info"
            route.startsWith("community-onboarding:") -> route = "community:" + route.substringAfter(':')
            route == "new-community" || route.startsWith("community:") -> route = "list"
            route in listOf("media", "starred", "appearance", "members") -> route = "info"
            route == "info" -> route = "thread"
            route == "thread" && selection != null -> selection = null
            route == "thread" -> { active = null; locks.unlockedChat = null; selection = null; call("close"); val back = threadReturn; threadReturn = null; if (back != null) { selectedTab = back.second; route = back.first } else route = "list" }
            selectedTab == "Settings" && route != "list" -> route = "list"
            else -> { route = "list"; selectedTab = "Chats" }
        }
    }
    /** Opens the system file picker; [mime] may list several MIME types separated by commas (images and videos, for example). */
    fun pickFile(callback: (String, String, String) -> Unit, mime: String = "*/*") { fileCallback = callback; picker.launch(mime.split(",").map { it.trim() }.toTypedArray()) }
    fun export(name: String, mime: String, bytes: ByteArray) {
        io.execute {
            try {
                pendingExport.outputStream().use { it.write(bytes); it.fd.sync() }
                check(getPreferences(MODE_PRIVATE).edit().putLong("pendingExportSize", bytes.size.toLong()).commit())
                runOnUiThread { savePicker.launch(Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE); type = mime; putExtra(Intent.EXTRA_TITLE, name)
                }) }
            } catch (_: Exception) { pendingExport.delete(); runOnUiThread { error = "Could not prepare that file for saving." } }
        }
    }
    fun attachmentLimit(): Long = snapshot.optJSONObject("limits")?.optLong("attachmentMaxBytes")?.takeIf { it > 0 } ?: 104857600L
    fun decode(value: String): ByteArray = Base64.decode(value, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    fun decodeImage(bytes: ByteArray, result: (androidx.compose.ui.graphics.ImageBitmap?) -> Unit) {
        io.execute { val bitmap = try { mediaBitmap(bytes) } catch (_: Exception) { null }; runOnUiThread { result(bitmap) } }
    }
    fun decodeImage(data: String, result: (androidx.compose.ui.graphics.ImageBitmap?) -> Unit) {
        io.execute { val bitmap = try { mediaBitmap(decode(data)) } catch (_: Exception) { null }; runOnUiThread { result(bitmap) } }
    }
    private val gallery by lazy { GallerySaver(this) }
    val mediaCache by lazy { MediaCache(this) }
    fun encode(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)

    /**
     * One attachment's plaintext: from the app-private [MediaCache] when it was fetched before,
     * otherwise downloaded and decrypted by the core, cached, and exported to the gallery when that
     * setting applies. [then] receives null on failure.
     */
    fun fetchMedia(message: JSONObject, conversation: String, index: Int, pointer: JSONObject, then: (ByteArray?) -> Unit = {}) {
        val id = pointer.optString("attachmentId")
        io.execute {
            val cached = mediaCache.get(id)
            if (cached != null) { runOnUiThread { then(cached) }; return@execute }
            runOnUiThread {
                call("download", message.targetArgs(conversation).put("index", index), quiet = true) { result ->
                    val data = (result as? JSONObject)?.optString("data")?.takeIf { it.isNotEmpty() }
                    if (data == null) { then(null); return@call }
                    io.execute {
                        val bytes = decode(data)
                        mediaCache.put(id, bytes)
                        saveReceivedMedia(message, pointer, bytes)
                        runOnUiThread { then(bytes) }
                    }
                }
            }
        }
    }

    /** Exports a received photo/video once, only when Save to gallery is on (never own media or locked chats). */
    fun saveReceivedMedia(message: JSONObject, pointer: JSONObject, bytes: ByteArray) {
        if (message.optString("authorId") == snapshot.optString("accountId") || locks.locked(message.optString("conversationId"))) return
        if (snapshot.optJSONObject("settings")?.optBoolean("saveToGallery") != true) return
        try { gallery.saveOnce(pointer.optString("attachmentId"), pointer.optString("fileName").ifBlank { "convo-media" }, pointer.optString("contentType"), bytes) } catch (_: Exception) { }
    }
    fun requestContacts() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED) discoverContacts()
        else contactsPermission.launch(Manifest.permission.READ_CONTACTS)
    }
    private fun discoverContacts() {
        if (discovering) return
        discovering = true; discoveryDone = false; phoneMatches = emptyList()
        io.execute {
            try {
                val contacts = readPhoneContacts(this); localNames = contacts.associate { it.number to it.name }
                val batches = contacts.map { it.number }.distinct().chunked(100)
                fun next(index: Int) {
                    if (index >= batches.size) { discovering = false; discoveryDone = true; return }
                    call("discover", obj("numbers" to JSONArray(batches[index]))) { data ->
                        val found = (data as? JSONArray)?.objects() ?: emptyList()
                        phoneMatches = (phoneMatches + found.map { account -> account.apply {
                            val number = "+" + optString("phone").filter(Char::isDigit)
                            put("localName", localNames[number] ?: optString("displayName"))
                        } }).distinctBy { it.optString("accountId") }
                        next(index + 1)
                    }
                }
                runOnUiThread { next(0) }
            } catch (_: Exception) { runOnUiThread { discovering = false; error = "Could not read contacts. Manual search is still available." } }
        }
    }
    override fun onDestroy() { if (PushRegistration.activity?.get() === this) PushRegistration.activity = null; ConnectionService.sync(this, false); calls.release(); bridge.destroy(); auth.dispose(); io.shutdown(); super.onDestroy() }
}
fun obj(vararg pairs: Pair<String, Any?>) = JSONObject().apply { pairs.forEach { put(it.first, it.second ?: JSONObject.NULL) } }
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }

/** Default Convo deployment for new installs (changeable on the sign-in screen). */
const val DEFAULT_SERVER = "https://convo.doncik.ro"
