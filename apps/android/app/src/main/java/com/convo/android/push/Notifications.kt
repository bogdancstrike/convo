package com.convo.android.push

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.calls.*
import com.convo.android.i18n.*
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
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject

/**
 * Message notifications while the app process runs (foreground or recently backgrounded). The
 * shared core decides whether a message alerts (mute, "mentions only", blocking); this adds the
 * device opt-in, Android permission, the chat on screen and the preview level. Generic preview is
 * the default; locked chats and the app lock always hide content. Background delivery without a
 * running process (UnifiedPush/FCM) is a separate release gate (docs/mobile.md §5).
 */
object MessageNotifications {
    const val CHANNEL = "messages"
    const val EXTRA_CONVERSATION = "com.convo.android.CONVERSATION"

    fun createChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        manager.createNotificationChannel(NotificationChannel(CHANNEL, tr("Messages"), NotificationManager.IMPORTANCE_HIGH).apply {
            description = tr("New messages in your chats")
            lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
        })
    }

    fun permitted(context: Context) = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun show(app: MainActivity, alert: JSONObject) {
        val settings = app.snapshot.optJSONObject("settings") ?: return
        if (!settings.optBoolean("notifications") || !permitted(app)) return
        val id = alert.optString("conversationId")
        if (app.isInForeground && app.active == id && app.route == "thread") return
        val conversation = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == id }
        val preview = if (app.locks.locked(id) || app.locks.appLock) "generic" else settings.optString("notificationPreview", "generic")
        val title = if (preview == "generic") "Convo" else alert.optString("title").ifBlank { conversation?.optString("title") ?: "Convo" }
        val body = when {
            preview == "full" && alert.optString("body").isNotBlank() -> alert.optString("body")
            preview == "full" && alert.optBoolean("attachment") -> tr("📎 File")
            alert.optBoolean("mention") -> tr("You were mentioned")
            else -> tr("New message")
        }
        val open = PendingIntent.getActivity(app, id.hashCode(), Intent(app, MainActivity::class.java).putExtra(EXTRA_CONVERSATION, id)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(app, CHANNEL).setSmallIcon(R.drawable.convo_logo).setContentTitle(title).setContentText(body)
            .setAutoCancel(true).setContentIntent(open).setCategory(NotificationCompat.CATEGORY_MESSAGE)
            // Public version on the lock screen is always generic.
            .setPublicVersion(NotificationCompat.Builder(app, CHANNEL).setSmallIcon(R.drawable.convo_logo).setContentTitle("Convo").setContentText(tr("New message")).build())
            .build()
        // One notification per chat (generic previews share one) so a busy chat does not flood.
        try { NotificationManagerCompat.from(app).notify(if (preview == "generic") 1 else id.hashCode(), notification) } catch (_: SecurityException) { }
    }
}

@Composable fun NotificationsEditor(app: MainActivity, settings: JSONObject) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        PrivacySwitch("Show notifications", "Alerts for new messages while Convo is running on this phone. Muted chats stay silent.", settings.optBoolean("notifications") && MessageNotifications.permitted(app)) { on ->
            if (on && !MessageNotifications.permitted(app)) app.requestNotificationPermission { granted -> if (granted) app.call("settings", obj("patch" to obj("notifications" to true))) else app.error = "Notifications are blocked for Convo in Android settings." }
            else app.call("settings", obj("patch" to obj("notifications" to on)))
        }
        var stay by remember { mutableStateOf(app.stayConnected) }
        BackgroundDelivery(app, stay)
        PrivacySwitch("Stay connected in the background", "Keeps a small ongoing notification so messages and calls arrive while Convo is in the background. Uses more battery.", stay) { on ->
            stay = on; app.stayConnected = on
        }
        Text("Preview", style = MaterialTheme.typography.titleSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("generic" to "Hidden", "sender" to "Sender", "full" to "Sender and text").forEach { (value, label) ->
                FilterChip(settings.optString("notificationPreview", "generic") == value, { app.call("settings", obj("patch" to obj("notificationPreview" to value))) }, label = { Text(label) })
            }
        }
        Text("Hidden shows only “New message”. Locked chats and app lock always hide content; the lock screen always shows a generic notification.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
    }
}

/**
 * Whether messages and calls reach this phone while Convo is closed, and how to fix it. Wake-ups
 * come through a UnifiedPush app (ntfy) using one of the organization's push servers, or from the
 * optional ongoing background connection.
 */
@Composable fun BackgroundDelivery(app: MainActivity, stayConnected: Boolean) {
    var servers by remember { mutableStateOf<List<String>?>(null) }
    LaunchedEffect(Unit) { app.call("pushServers", quiet = true) { v -> servers = (v as? org.json.JSONArray)?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty() } }
    val version = app.pushVersion
    val installed = remember(version) { PushRegistration.distributorInstalled(app) }
    val endpoint = remember(version) { PushRegistration.endpoint(app) }
    val rejected = remember(version) { PushRegistration.rejected(app) }
    val server = servers?.firstOrNull()
    val host = endpoint?.let { runCatching { android.net.Uri.parse(it).host }.getOrNull() }
    val (ok, title, body) = when {
        stayConnected -> Triple(true, tr("Background delivery: always connected"), tr("Convo keeps a connection open, so messages and calls arrive while it is in the background."))
        servers?.isEmpty() == true -> Triple(false, tr("Push is not available here"), tr("Your organization has not set up push. Turn on “Stay connected in the background” to receive messages while Convo is closed."))
        !installed -> Triple(false, tr("Messages arrive only while Convo is open"), tr("Install the free ntfy app, open it, and set its default server to {server}. Convo then wakes up for new messages and calls without draining the battery.").replace("{server}", server ?: "…"))
        rejected -> Triple(false, tr("Your push app uses the wrong server"), tr("ntfy is using {host}. In ntfy → Settings → Default server, enter {server}, then reopen Convo.").replace("{host}", host ?: "?").replace("{server}", server ?: "…"))
        endpoint == null -> Triple(false, tr("Setting up background delivery…"), tr("Open the ntfy app once and make sure its default server is {server}.").replace("{server}", server ?: "…"))
        else -> Triple(true, tr("Background delivery is on"), tr("New messages and calls wake Convo through {host}. The wake-up carries no content.").replace("{host}", host ?: "push"))
    }
    Card(colors = CardDefaults.cardColors(containerColor = if (ok) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.errorContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RawText(title, style = MaterialTheme.typography.titleSmall)
            RawText(body, style = MaterialTheme.typography.bodySmall)
            if (!ok && !stayConnected && servers?.isEmpty() == false) Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!installed) OutlinedButton({
                    val market = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("market://details?id=io.heckel.ntfy"))
                    runCatching { app.startActivity(market) }.onFailure { runCatching { app.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse("https://ntfy.sh/docs/subscribe/phone/"))) } }
                }) { Text("Get ntfy") }
                if (server != null) OutlinedButton({
                    (app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("ntfy server", server))
                    app.notice = tr("Server address copied")
                }) { Text("Copy server address") }
                if (installed) OutlinedButton({ PushRegistration.setRejected(app, false); PushRegistration.save(app, null); app.syncPush(); app.pushVersion++ }) { Text("Retry") }
            }
        }
    }
}
