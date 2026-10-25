package com.convo.android.calls

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.convo.android.MainActivity
import com.convo.android.R
import com.convo.android.i18n.tr

/**
 * Keeps a call alive while Convo is in the background or the phone is locked (WhatsApp-style): an
 * ongoing "Ongoing call" notification and a foreground service of type microphone (plus camera for
 * video calls), without which Android silences the microphone of background apps. Tapping the
 * notification returns to the call. Started when a call connects, stopped when it ends.
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: tr("Ongoing call")
        val video = intent?.getBooleanExtra(EXTRA_VIDEO, false) == true
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, tr("Ongoing calls"), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.convo_logo)
            .setContentTitle(title).setContentText(tr(if (video) "Ongoing video call · Tap to return" else "Ongoing voice call · Tap to return"))
            .setOngoing(true).setCategory(NotificationCompat.CATEGORY_CALL).setContentIntent(open).setUsesChronometer(true).build()
        val types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or (if (video) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA else 0)
        try { ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, types) }
        catch (_: Exception) { ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE) }
        return START_NOT_STICKY
    }

    companion object {
        private const val CHANNEL = "ongoing-call"
        private const val NOTIFICATION_ID = 7103
        private const val EXTRA_TITLE = "title"
        private const val EXTRA_VIDEO = "video"

        fun start(context: Context, title: String, video: Boolean) {
            runCatching { context.startForegroundService(Intent(context, CallService::class.java).putExtra(EXTRA_TITLE, title).putExtra(EXTRA_VIDEO, video)) }
        }

        fun stop(context: Context) { context.stopService(Intent(context, CallService::class.java)) }
    }
}
