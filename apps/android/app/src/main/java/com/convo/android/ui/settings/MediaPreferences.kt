package com.convo.android.ui.settings

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
import com.convo.android.ui.theme.*
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.content.ContentValues
import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

/**
 * Native side of the shared media policy (apps/web/src/core/mediaPolicy.ts). The rules live in the
 * device-local settings of the shared core; this file maps Android network state onto them and
 * owns the optional plaintext export to the shared gallery.
 */
object MediaPolicy {
    val kinds = listOf("photos" to "Photos", "audio" to "Audio", "videos" to "Videos", "documents" to "Documents")
    val networks = listOf("cellular" to "When using mobile data", "wifi" to "When connected on Wi-Fi", "roaming" to "When roaming")
    private val defaults = mapOf("wifi" to listOf("photos", "audio"), "cellular" to listOf("photos", "audio"), "roaming" to emptyList())

    /** Image types shown inline as photos (GIFs show their first frame). */
    val imageTypes = setOf("image/jpeg", "image/png", "image/gif", "image/webp")
    /** Same bound as the web client (mediaPolicy.ts AUTO_PREFETCH_MAX_BYTES): larger videos/documents wait for a tap. */
    const val PREFETCH_MAX_BYTES = 16L * 1024 * 1024

    fun kindOf(pointer: JSONObject): String {
        val mime = pointer.optString("contentType").lowercase()
        return when {
            mime in imageTypes -> "photos"
            pointer.optBoolean("voiceNote") || mime.startsWith("audio/") -> "audio"
            mime.startsWith("video/") -> "videos"
            else -> "documents"
        }
    }

    /** Unmetered → Wi-Fi rules; cellular without NOT_ROAMING → roaming; other metered → mobile data. */
    fun network(context: Context): String {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return "cellular"
        val capabilities = manager.getNetworkCapabilities(manager.activeNetwork) ?: return "cellular"
        return when {
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) -> "wifi"
            capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) && !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_ROAMING) -> "roaming"
            else -> "cellular"
        }
    }

    fun rules(settings: JSONObject?): Map<String, List<String>> {
        val stored = settings?.optJSONObject("autoDownload") ?: return defaults
        return networks.associate { (network, _) -> network to (stored.optJSONArray(network)?.let { a -> (0 until a.length()).map { a.optString(it) } } ?: defaults.getValue(network)) }
    }

    /** Own media always loads; others follow the current network's rule. */
    fun automatic(app: MainActivity, pointer: JSONObject, own: Boolean): Boolean {
        if (own) return true
        val kind = kindOf(pointer)
        if ((kind == "videos" || kind == "documents") && pointer.optLong("size") > PREFETCH_MAX_BYTES) return false
        return kind in rules(app.snapshot.optJSONObject("settings")).getValue(network(app))
    }

    fun patch(rules: Map<String, List<String>>): JSONObject =
        obj("patch" to obj("autoDownload" to JSONObject().apply { rules.forEach { (network, list) -> put(network, JSONArray(list)) } }))

    /** Gallery export needs scoped MediaStore writes (Android 10+), which need no storage permission. */
    val gallerySupported get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
}

/**
 * Exports received photos/videos to Pictures/Convo or Movies/Convo once per attachment, only when the
 * user enabled Save to gallery. Copies are plaintext and readable by apps with media access.
 */
class GallerySaver(private val context: Context) {
    private val prefs = context.getSharedPreferences("convo-gallery", Context.MODE_PRIVATE)
    private val maxRemembered = 5000

    fun saveOnce(attachmentId: String, name: String, mime: String, bytes: ByteArray): Boolean {
        if (!MediaPolicy.gallerySupported || attachmentId.isBlank()) return false
        val saved = prefs.getStringSet("saved", emptySet()).orEmpty()
        if (attachmentId in saved) return false
        val video = mime.startsWith("video/")
        if (!video && !mime.startsWith("image/")) return false
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120))
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, (if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_PICTURES) + "/Convo")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val collection = if (video) MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY) else MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val resolver = context.contentResolver
        val uri = resolver.insert(collection, values) ?: return false
        return try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: error("no stream")
            resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
            // Bounded memory of exported IDs; a very old item may be exported again after eviction.
            prefs.edit().putStringSet("saved", (saved.toList().takeLast(maxRemembered - 1) + attachmentId).toSet()).apply()
            true
        } catch (_: Exception) { resolver.delete(uri, null, null); false }
    }
}

@Composable fun StorageEditor(app: MainActivity, settings: JSONObject) {
    var rules by remember(settings.optJSONObject("autoDownload")?.toString()) { mutableStateOf(MediaPolicy.rules(settings)) }
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text("Media auto-download", style = MaterialTheme.typography.titleMedium)
        Text("Chosen media is downloaded and decrypted into Convo's private storage when it appears in a chat. Large videos and documents always wait for a tap.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        MediaPolicy.networks.forEach { (network, title) ->
            Column {
                Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
                MediaPolicy.kinds.forEach { (kind, label) ->
                    val checked = kind in rules.getValue(network)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked, { on ->
                            val next = rules + (network to MediaPolicy.kinds.map { it.first }.filter { if (it == kind) on else it in rules.getValue(network) })
                            rules = next; app.call("settings", MediaPolicy.patch(next))
                        })
                        Text(label)
                    }
                }
            }
        }
        PrivacySwitch("Save to gallery",
            if (MediaPolicy.gallerySupported) "Save received photos and videos to Pictures/Convo and Movies/Convo. Other apps with photo access can read these unencrypted copies."
            else "Requires Android 10 or newer.",
            settings.optBoolean("saveToGallery"), MediaPolicy.gallerySupported) { app.call("settings", obj("patch" to obj("saveToGallery" to it))) }
    }
}
