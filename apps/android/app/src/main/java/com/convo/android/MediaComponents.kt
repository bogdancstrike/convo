package com.convo.android

import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Bound decoded dimensions before allocating pixels from untrusted media. */
fun mediaBitmap(bytes: ByteArray, maxEdge: Int = 1600): ImageBitmap? = try {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth !in 1..32768 || bounds.outHeight !in 1..32768 || bounds.outWidth.toLong() * bounds.outHeight > 100_000_000) null
    else {
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / sample > maxEdge) sample *= 2
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })?.asImageBitmap()
    }
} catch (_: Exception) { null }

@Composable fun AttachmentTile(app: MainActivity, message: JSONObject, conversation: String, index: Int, pointer: JSONObject, open: () -> Unit) {
    val mime = pointer.optString("contentType")
    val name = pointer.optString("fileName").ifBlank { "Attachment" }
    val image = mime in listOf("image/jpeg", "image/png", "image/webp")
    val video = mime.startsWith("video/")
    var bitmap by remember(pointer.optString("attachmentId")) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember { mutableStateOf(false) }
    var requested by remember(pointer.optString("attachmentId")) { mutableStateOf(false) }
    val own = message.optString("authorId") == app.snapshot.optString("accountId")
    val load = requested || MediaPolicy.automatic(app, pointer, own)
    LaunchedEffect(pointer.optString("attachmentId"), load) {
        if (video && pointer.optString("thumbnail").isNotBlank()) {
            bitmap = withContext(Dispatchers.IO) { mediaBitmap(app.decode(pointer.optString("thumbnail")), 800) }
        } else if (image && load && bitmap == null) app.call("download", message.targetArgs(conversation).put("index", index)) { result ->
            val data = (result as? JSONObject)?.optString("data")
            if (data == null) failed = true
            else { app.decodeImage(data) { bitmap = it; failed = it == null }; app.saveReceivedMedia(message, pointer, data) }
        }
    }
    if (image || video) {
        val manual = image && !load && bitmap == null
        Box(Modifier.width(264.dp).heightIn(min = 140.dp, max = 300.dp).background(LocalConvoColors.current.canvas, RoundedCornerShape(8.dp)).clickable(onClickLabel = if (manual) "Download $name" else if (video) "Play $name" else "View $name", onClick = { if (manual) requested = true else open() }), contentAlignment = Alignment.Center) {
            bitmap?.let { Image(it, name, Modifier.fillMaxWidth().heightIn(min = 140.dp, max = 300.dp), contentScale = ContentScale.Fit) }
            if (video) Surface(shape = RoundedCornerShape(50), color = LocalConvoColors.current.panelRaised.copy(alpha = .9f)) { Icon(Icons.Outlined.PlayArrow, "Play $name", Modifier.padding(12.dp).size(32.dp)) }
            else if (manual) Surface(shape = RoundedCornerShape(50), color = LocalConvoColors.current.panelRaised.copy(alpha = .9f)) {
                Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Download, null); Text(formatSize(pointer.optLong("size")), Modifier.padding(start = 6.dp)) }
            }
            else if (bitmap == null) {
                if (failed) Text("Tap to retry", Modifier.padding(20.dp)) else CircularProgressIndicator(Modifier.size(28.dp))
            }
        }
    } else Row(Modifier.widthIn(max = 280.dp).background(LocalConvoColors.current.canvas, RoundedCornerShape(8.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (mime.startsWith("audio/")) Icons.Outlined.PlayCircleOutline else Icons.Outlined.InsertDriveFile, null)
        Column(Modifier.weight(1f).padding(horizontal = 8.dp)) { Text(name, maxLines = 2, style = MaterialTheme.typography.bodyMedium); Text(formatSize(pointer.optLong("size")), style = MaterialTheme.typography.labelSmall) }
        IconButton(open) { Icon(if (mime.startsWith("audio/")) Icons.Outlined.PlayArrow else Icons.Outlined.Download, if (mime.startsWith("audio/")) "Play $name" else "View or download $name") }
    }
}
fun formatSize(size: Long): String = when { size >= 1024 * 1024 -> "%.1f MB".format(size / 1048576.0); size >= 1024 -> "%.1f KB".format(size / 1024.0); else -> "$size B" }

@Composable fun ExternalLinkConfirmation(url: String, close: () -> Unit, open: () -> Unit) {
    AlertDialog(onDismissRequest = close, icon = { Icon(Icons.Outlined.Link, null, tint = MaterialTheme.colorScheme.primary) },
        title = { Text("Open an external link?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("This link opens a website outside Convo.")
            Surface(shape = RoundedCornerShape(12.dp), color = LocalConvoColors.current.canvas, border = BorderStroke(1.dp, LocalConvoColors.current.border)) {
                Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("You’re going to", style = MaterialTheme.typography.labelSmall)
                    Text(Uri.parse(url).host ?: "", style = MaterialTheme.typography.titleMedium)
                    Text(url, style = MaterialTheme.typography.bodySmall)
                }
            }
            Text("Check the address before continuing. Only open links you trust.", style = MaterialTheme.typography.bodySmall)
            Text("You can turn this confirmation off in Settings → Privacy.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } }, confirmButton = { Button(open) { Text("Open link") } }, dismissButton = { TextButton(close) { Text("Cancel") } })
}
