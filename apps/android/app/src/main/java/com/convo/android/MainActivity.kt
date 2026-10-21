package com.convo.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
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
    private val server get() = getPreferences(MODE_PRIVATE).getString("server", "https://convo.doncea.ro:8443")!!.trimEnd('/')

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
    private var micCallback: ((Boolean) -> Unit)? = null
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
        // Keep the old IndexedDB origin for existing installs; changing it would hide their keys.
        if (!getPreferences(MODE_PRIVATE).contains("server")) {
            val legacy = java.io.File(applicationInfo.dataDir, "app_webview").exists()
            getPreferences(MODE_PRIVATE).edit().putString("server", if (legacy) "https://192.168.1.144:8443" else "https://convo.doncea.ro:8443").apply()
        }
        cacheDir.listFiles()?.filter { it.name.startsWith("convo-preview-") }?.forEach { it.delete() }
        if (!BuildConfig.DEBUG || android.os.Build.HARDWARE != "ranchu") window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        MessageNotifications.createChannel(this)
        auth = AuthorizationService(this, AppAuthConfiguration.Builder().setConnectionBuilder(DevelopmentTls(this)).build())
        bridge = ProtocolBridge(this, server) { type, value ->
            if (BuildConfig.DEBUG && type == "diagnostic") android.util.Log.d("ConvoCore", value.toString())
            when (type) {
                "phase" -> { phase = value.optString("name"); linkCode = value.optString("code"); if (phase == "ready") refreshCredentialStatus(); ConnectionService.sync(this, stayConnected && phase == "ready") }
                "call" -> calls.onEvent(value)
                "alert" -> MessageNotifications.show(this, value)
                "callLog" -> callLogVersion++
                "snapshot" -> { snapshot = value; Strings.locale = value.optJSONObject("settings")?.optString("locale")?.takeIf { it == "ro" } ?: "en"; active = value.optString("active").takeIf { it.isNotBlank() && it != "null" } }
            }
        }
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
        if (uri.scheme != "https" || uri.host.isNullOrBlank() || uri.userInfo != null || uri.query != null || (!uri.path.isNullOrBlank() && uri.path != "/")) { error = "Enter an HTTPS server address, such as https://192.168.1.144:8443"; return }
        if (snapshot.has("accountId")) { error = "Log out before changing the server."; return }
        getPreferences(MODE_PRIVATE).edit().putString("server", value.trim().trimEnd('/')).apply(); recreate()
    }
    fun serverAddress() = server
    /** Batch selection in the open chat ("authorId/id" keys); null when not selecting. */
    var selection by mutableStateOf<Set<String>?>(null)
    fun toggleSelected(key: String) { val s = selection ?: return; selection = if (key in s) s - key else if (s.size < 100) s + key else s }
    /** Whether this account may pin in the open chat (groups/channels: owners and admins). */
    var canPinActive by mutableStateOf(false); private set
    fun openChat(id: String) {
        canPinActive = false; call("canPin", obj("id" to id), quiet = true) { canPinActive = it == true }
        if (locks.locked(id) && locks.unlockedChat != id) { locks.authenticate("Open locked chat", "Confirm it’s you") { locks.unlockedChat = id; openChat(id) }; return }
        threadSearch = false; active = id; route = "thread"; selectedTab = "Chats"; call("open", obj("id" to id))
    }
    /** Keycloak Account Console (passkeys, authenticator apps) in a Custom Tab; never inside Convo. */
    fun openAccountSecurity() {
        val uri = Uri.parse("$server/auth/realms/enclave/account/account-security/signing-in")
        try { androidx.browser.customtabs.CustomTabsIntent.Builder().build().launchUrl(this, uri) }
        catch (_: Exception) { error = "No browser is available to open your account settings." }
    }
    /**
     * Keycloak's passkey-registration action (kc_action) in a Custom Tab; it returns to the static
     * "passkey ready" page. A throwaway PKCE challenge satisfies the client policy; the code is unused.
     */
    fun openPasskeySetup() {
        val random = java.security.SecureRandom()
        fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        val verifier = ByteArray(32).also(random::nextBytes)
        val uri = Uri.parse("$server/auth/realms/enclave/protocol/openid-connect/auth").buildUpon()
            .appendQueryParameter("client_id", "enclave-web").appendQueryParameter("redirect_uri", "$server/auth/convo/passkey-done")
            .appendQueryParameter("response_type", "code").appendQueryParameter("scope", "openid")
            .appendQueryParameter("kc_action", "webauthn-register-passwordless")
            .appendQueryParameter("state", b64(ByteArray(16).also(random::nextBytes)))
            .appendQueryParameter("code_challenge", b64(java.security.MessageDigest.getInstance("SHA-256").digest(verifier)))
            .appendQueryParameter("code_challenge_method", "S256").build()
        try { androidx.browser.customtabs.CustomTabsIntent.Builder().build().launchUrl(this, uri) }
        catch (_: Exception) { error = "No browser is available to set up a passkey." }
    }
    override fun onStop() { super.onStop(); isInForeground = false; locks.onBackground() }
    override fun onResume() { super.onResume(); if (phase == "ready") refreshCredentialStatus() }
    var isInForeground = false; private set
    /** Device-local opt-in for [ConnectionService]. */
    var stayConnected: Boolean
        get() = getPreferences(MODE_PRIVATE).getBoolean("stayConnected", false)
        set(value) { getPreferences(MODE_PRIVATE).edit().putBoolean("stayConnected", value).apply(); ConnectionService.sync(this, value && phase == "ready") }
    override fun onStart() { super.onStart(); isInForeground = true }
    /** Notification tap: open that chat (lock rules apply in openChat). */
    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); intent.getStringExtra(MessageNotifications.EXTRA_CONVERSATION)?.let { if (phase == "ready") openChat(it) } }
    private var notificationCallback: ((Boolean) -> Unit)? = null
    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted -> notificationCallback?.invoke(granted); notificationCallback = null }
    fun requestNotificationPermission(callback: (Boolean) -> Unit) {
        if (android.os.Build.VERSION.SDK_INT < 33) { callback(true); return }
        notificationCallback = callback; notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    /** Updates lock eligibility. An unavailable IdP answer keeps the last confirmed value. */
    fun refreshCredentialStatus(done: (String) -> Unit = {}) = call("credentials", quiet = true) { value ->
        val status = value as? JSONObject
        val state = when { status == null || status.optString("state") != "available" -> "unavailable"; status.optBoolean("passkey") -> "true"; else -> "false" }
        if (state != "unavailable") locks.passkey = state == "true"
        done(state)
    }
    fun back() {
        when {
            route == "thread" && threadSearch -> threadSearch = false
            route.startsWith("contact-media:") -> route = route.replace("contact-media:", "contact:")
            route.startsWith("contact:") -> route = "info"
            route in listOf("media", "starred", "appearance", "members") -> route = "info"
            route == "info" -> route = "thread"
            route == "thread" && selection != null -> selection = null
            route == "thread" -> { active = null; route = "list"; locks.unlockedChat = null; selection = null; call("close") }
            selectedTab == "Settings" && route != "list" -> route = "list"
            else -> { route = "list"; selectedTab = "Chats" }
        }
    }
    fun pickFile(callback: (String, String, String) -> Unit, mime: String = "*/*") { fileCallback = callback; picker.launch(arrayOf(mime)) }
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
    fun decodeImage(data: String, result: (androidx.compose.ui.graphics.ImageBitmap?) -> Unit) {
        io.execute { val bitmap = try { mediaBitmap(decode(data)) } catch (_: Exception) { null }; runOnUiThread { result(bitmap) } }
    }
    private val gallery by lazy { GallerySaver(this) }
    /** Exports a received photo/video once, only when Save to gallery is on (never own media). */
    fun saveReceivedMedia(message: JSONObject, pointer: JSONObject, data: String) {
        if (message.optString("authorId") == snapshot.optString("accountId") || locks.locked(message.optString("conversationId"))) return
        if (snapshot.optJSONObject("settings")?.optBoolean("saveToGallery") != true) return
        io.execute { try { gallery.saveOnce(pointer.optString("attachmentId"), pointer.optString("fileName").ifBlank { "convo-media" }, pointer.optString("contentType"), decode(data)) } catch (_: Exception) { } }
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
    override fun onDestroy() { ConnectionService.sync(this, false); calls.release(); bridge.destroy(); auth.dispose(); io.shutdown(); super.onDestroy() }
}
fun obj(vararg pairs: Pair<String, Any?>) = JSONObject().apply { pairs.forEach { put(it.first, it.second ?: JSONObject.NULL) } }
fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
