package com.convo.android

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.UnifiedPush
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/**
 * UnifiedPush wake-ups (MSG-02) through a distributor app such as ntfy pointed at the
 * organization's self-hosted ntfy server. A wake carries no content: when Convo is not running it
 * shows a generic "New message" notification (subject to the user's notification setting); opening
 * the app connects and decrypts the waiting messages. When the app is running, the live connection
 * already delivers, so wakes are ignored.
 */
class PushReceiver : PushService() {
    override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
        PushRegistration.save(this, endpoint.url)
        PushRegistration.onEndpoint?.invoke()
    }

    override fun onMessage(message: PushMessage, instance: String) {
        if (PushRegistration.appVisible) return
        // Urgent = the sender marked it (call ring). Calls ring like the in-app ringer does,
        // independent of the message notification setting; still no caller or content.
        if (String(message.content, Charsets.UTF_8).contains("\"urgent\"")) { CallWake.show(this); return }
        if (!PushRegistration.notificationsEnabled(this) || !MessageNotifications.permitted(this)) return
        MessageNotifications.createChannel(this)
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, MessageNotifications.CHANNEL).setSmallIcon(R.drawable.convo_logo)
            .setContentTitle("Convo").setContentText(tr("New message")).setAutoCancel(true).setContentIntent(open)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE).build()
        try { NotificationManagerCompat.from(this).notify(1, notification) } catch (_: SecurityException) { }
    }

    override fun onRegistrationFailed(reason: FailedReason, instance: String) { PushRegistration.save(this, null) }
    override fun onUnregistered(instance: String) { PushRegistration.save(this, null) }
}

/** Device-local push state shared by the receiver and the activity. */
object PushRegistration {
    private const val PREFS = "convo-push"
    /** True while an activity is started (the live socket delivers; wakes are redundant). */
    @Volatile var appVisible = false
    /** Set by the running activity so a new endpoint reaches the server immediately. */
    @Volatile var onEndpoint: (() -> Unit)? = null

    fun save(context: Context, endpoint: String?) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("endpoint", endpoint).putBoolean("synced", false).apply()
    }
    fun endpoint(context: Context): String? = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("endpoint", null)
    fun markSynced(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("synced", true).apply()
    fun synced(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("synced", false)
    /** Mirrors the core's device setting so the receiver can decide without the protocol engine. */
    fun setNotificationsEnabled(context: Context, enabled: Boolean) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("notifications", enabled).apply()
    fun notificationsEnabled(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("notifications", false)

    /** Uses the current or default distributor (e.g. ntfy) when one is installed; silent otherwise. */
    fun register(context: Context) {
        if (UnifiedPush.getDistributors(context).isEmpty()) return
        UnifiedPush.tryUseCurrentOrDefaultDistributor(context) { ok -> if (ok) UnifiedPush.register(context, "default", "Convo", null) }
    }
}

/**
 * Generic ringing notification for a call to a phone whose app was not running: high-priority
 * "calls" channel with the ringtone (insistent), full-screen intent and a 45 s timeout. Opening it
 * starts Convo, which connects, decrypts the ring and shows the real call screen.
 */
object CallWake {
    const val CHANNEL = "calls"
    const val ID = 2
    const val EXTRA_RING = "com.convo.android.RING"

    fun show(context: Context) {
        if (!MessageNotifications.permitted(context)) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val ringtone = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE)
        manager.createNotificationChannel(android.app.NotificationChannel(CHANNEL, tr("Calls"), NotificationManager.IMPORTANCE_HIGH).apply {
            description = tr("Incoming calls")
            lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            setSound(ringtone, android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build())
            enableVibration(true); vibrationPattern = longArrayOf(0, 600, 900)
        })
        val open = PendingIntent.getActivity(context, 1, Intent(context, MainActivity::class.java).putExtra(EXTRA_RING, true)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, CHANNEL).setSmallIcon(R.drawable.convo_logo)
            .setContentTitle("Convo").setContentText(tr("Incoming call")).setSubText(tr("Open Convo to answer"))
            .setCategory(NotificationCompat.CATEGORY_CALL).setPriority(NotificationCompat.PRIORITY_MAX)
            .setContentIntent(open).setFullScreenIntent(open, true).setAutoCancel(true)
            .setTimeoutAfter(CallManager.RING_TIMEOUT_MS).build().apply { flags = flags or android.app.Notification.FLAG_INSISTENT }
        try { NotificationManagerCompat.from(context).notify(ID, notification) } catch (_: SecurityException) { }
    }

    fun cancel(context: Context) = NotificationManagerCompat.from(context).cancel(ID)
}
