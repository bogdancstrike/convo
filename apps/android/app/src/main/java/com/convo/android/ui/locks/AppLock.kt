package com.convo.android.ui.locks

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.calls.*
import com.convo.android.i18n.*
import com.convo.android.push.*
import com.convo.android.ui.communities.*
import com.convo.android.ui.contacts.*
import com.convo.android.ui.info.*
import com.convo.android.ui.linking.*
import com.convo.android.ui.media.*
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.content.Context
import android.os.Build
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_WEAK
import androidx.biometric.BiometricManager.Authenticators.DEVICE_CREDENTIAL
import androidx.biometric.BiometricPrompt
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * App lock and per-chat locks (device-local). Android owns the fingerprint/face/PIN check via
 * BiometricPrompt with device-credential fallback; Convo never sees biometric data or the PIN.
 *
 * Locks can only be turned on after the identity provider confirms a passkey for the account
 * (`GET /v1/account/credentials`). Once on, they keep protecting this phone offline, and a later
 * "unavailable" or removed passkey never silently turns them off.
 *
 * Grants: unlocking the app lasts until the app goes to the background; unlocking a locked chat
 * lasts until the user leaves that chat (info/media screens of the same chat keep it).
 */
class LockManager(private val activity: FragmentActivity) {
    private val prefs = activity.getSharedPreferences("convo-locks", Context.MODE_PRIVATE)
    var appLock by mutableStateOf(prefs.getBoolean("appLock", false)); private set
    var lockedChats by mutableStateOf(prefs.getStringSet("chats", emptySet()).orEmpty().toSet()); private set
    var appUnlocked by mutableStateOf(false); private set
    var unlockedChat by mutableStateOf<String?>(null)
    /** `true`/`false` once the IdP answered; `null` while unknown or unavailable. */
    var passkey by mutableStateOf<Boolean?>(null)

    private val authenticators = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) BIOMETRIC_STRONG or DEVICE_CREDENTIAL else BIOMETRIC_WEAK or DEVICE_CREDENTIAL

    /** Null when the phone can authenticate; otherwise a user-facing reason. */
    fun unavailableReason(): String? = when (BiometricManager.from(activity).canAuthenticate(authenticators)) {
        BiometricManager.BIOMETRIC_SUCCESS -> null
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "Set up a screen lock (PIN, pattern, password or fingerprint) in Android settings first."
        else -> "This phone cannot confirm your identity with a screen lock right now."
    }

    fun locked(conversationId: String?) = conversationId != null && conversationId in lockedChats

    /** Shows the system prompt. Cancel or failure leaves everything locked. */
    fun authenticate(title: String, subtitle: String, onSuccess: () -> Unit) {
        unavailableReason()?.let { reason -> (activity as? MainActivity)?.error = reason; return }
        val prompt = BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) { onSuccess() }
        })
        prompt.authenticate(BiometricPrompt.PromptInfo.Builder().setTitle(title).setSubtitle(subtitle).setAllowedAuthenticators(authenticators).build())
    }

    fun unlockApp() = authenticate("Unlock Convo", "Confirm it’s you to open your chats") { appUnlocked = true }

    /** Turning a lock on requires a confirmed passkey and a successful device check. */
    fun changeAppLock(enabled: Boolean) {
        if (enabled && passkey != true) return
        authenticate(if (enabled) "Turn on app lock" else "Turn off app lock", "Confirm with your fingerprint or screen lock") {
            appLock = enabled; appUnlocked = true; prefs.edit().putBoolean("appLock", enabled).apply()
        }
    }

    fun setChatLocked(conversationId: String, lock: Boolean, done: () -> Unit = {}) {
        if (lock && passkey != true) return
        authenticate(if (lock) "Lock this chat" else "Unlock this chat", "Confirm with your fingerprint or screen lock") {
            lockedChats = if (lock) lockedChats + conversationId else lockedChats - conversationId
            prefs.edit().putStringSet("chats", lockedChats).apply()
            if (lock && unlockedChat == conversationId) unlockedChat = null
            done()
        }
    }

    /** Called from onStop: hide content before the app is shown again. */
    fun onBackground() { appUnlocked = false; unlockedChat = null }
}

@Composable fun AppLockScreen(app: MainActivity) {
    LaunchedEffect(Unit) { app.locks.unlockApp() }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
            Image(painterResource(R.drawable.convo_logo), null, Modifier.size(72.dp))
            Spacer(Modifier.height(24.dp))
            Text("Convo is locked", style = MaterialTheme.typography.headlineSmall)
            Text("Use your fingerprint or screen lock to open your chats.", Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button({ app.locks.unlockApp() }, Modifier.padding(top = 24.dp)) { Icon(Icons.Outlined.Lock, null); Text("Unlock", Modifier.padding(start = 8.dp)) }
        }
    }
}

/** Shown instead of a locked chat's content until the user authenticates. */
@Composable fun LockedChatGate(app: MainActivity, conversationId: String) {
    Column(Modifier.fillMaxSize().padding(32.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(Icons.Outlined.Lock, null, Modifier.size(48.dp))
        Text("This chat is locked", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.titleMedium)
        Button({ app.locks.authenticate("Open locked chat", "Confirm it’s you") { app.locks.unlockedChat = conversationId } }, Modifier.padding(top = 16.dp)) { Text("Unlock") }
    }
}

/** Passkey status from the IdP plus the lock switches it gates. */
@Composable fun LockSettings(app: MainActivity) {
    LaunchedEffect(Unit) { app.refreshCredentialStatus(refresh = true) }
    val state = app.credentialState
    val locks = app.locks
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Passkeys", style = MaterialTheme.typography.titleMedium)
        Text("Sign in without a password using your fingerprint, face or screen lock. Passkeys live with your organization’s sign-in service; Convo never sees them. A passkey is required to turn on app and chat locks.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(when (state) { "loading" -> "Checking…"; "true" -> "Passkey set up"; "false" -> "No passkey yet"; else -> "Status unavailable right now" })
        if (state == "true") app.passkeys.forEach { p ->
            val created = p.optLong("createdAt", 0L)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Key, null, Modifier.size(20.dp))
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    RawText(p.optString("label").ifBlank { tr("Passkey") })
                    if (created > 0) RawText(tr("Added {date}").replace("{date}", java.text.DateFormat.getDateInstance(java.text.DateFormat.MEDIUM).format(java.util.Date(created))),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton({ app.openPasskeyRemoval(p.optString("id")) }) { Text("Remove") }
            }
        }
        if (state == "false") {
            Text("Turn on passwordless sign-in to create a passkey with your organization’s sign-in service. Return here when it’s done.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button({ app.openPasskeySetup() }) { Text("Turn on passwordless sign-in") }
        }
        if (state == "true") OutlinedButton({ app.openPasskeySetup() }) { Text("Add another passkey") }
        PrivacySwitch("App lock", when {
            locks.appLock -> "Convo asks for your fingerprint or screen lock each time you open it."
            locks.passkey == true -> "Require your fingerprint or screen lock to open Convo."
            else -> "Set up a passkey first, then come back here."
        }, locks.appLock, enabled = locks.appLock || locks.passkey == true) { locks.changeAppLock(it) }
        Text(if (locks.lockedChats.isEmpty()) "Lock individual chats from a chat’s menu." else "${locks.lockedChats.size} locked chat(s). Locked chats are hidden from the chat list, search, media and gallery saving.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
