package com.convo.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Optional "stay connected" foreground service (docs/mobile.md §5, restricted-deployment fallback).
 *
 * It holds no protocol state: it only keeps the app process (and the encrypted protocol engine in
 * the activity's WebView) from being frozen while Convo is in the background, so messages and
 * calls keep arriving. A persistent, low-priority notification makes this visible; turning the
 * setting off stops the service. Push delivery (UnifiedPush/FCM) remains the preferred path.
 */
class ConnectionService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val manager = getSystemService(NotificationManager::class.java)
        manager?.createNotificationChannel(NotificationChannel(CHANNEL, tr("Background connection"), NotificationManager.IMPORTANCE_MIN).apply {
            description = tr("Keeps Convo connected so messages and calls arrive while the app is in the background")
            setShowBadge(false)
        })
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.convo_logo)
            .setContentTitle(tr("Convo is connected")).setContentText(tr("Messages and calls arrive in the background."))
            .setOngoing(true).setSilent(true).setPriority(NotificationCompat.PRIORITY_MIN).setContentIntent(open).build()
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_REMOTE_MESSAGING else 0
        ServiceCompat.startForeground(this, ID, notification, type)
        return START_NOT_STICKY // only meaningful while the activity's protocol engine exists
    }

    companion object {
        private const val CHANNEL = "connection"
        private const val ID = 7001

        /** Starts or stops the service to match the device setting. */
        fun sync(context: Context, enabled: Boolean) {
            val intent = Intent(context, ConnectionService::class.java)
            if (enabled) try { ContextCompat.startForegroundService(context, intent) } catch (_: Exception) { }
            else context.stopService(intent)
        }
    }
}
