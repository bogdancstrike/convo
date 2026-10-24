package com.convo.android.ui.media

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
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.blur
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

@Composable fun AttachmentTile(app: MainActivity, message: JSONObject, conversation: String, index: Int, pointer: JSONObject, compact: Boolean = false, open: () -> Unit) {
    val mime = pointer.optString("contentType")
    val name = if (pointer.optBoolean("voiceNote")) "Voice message" else pointer.optString("fileName").ifBlank { "Attachment" }
    val image = mime in MediaPolicy.imageTypes
    val video = mime.startsWith("video/")
    var bitmap by remember(pointer.optString("attachmentId")) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember { mutableStateOf(false) }
    var requested by remember(pointer.optString("attachmentId")) { mutableStateOf(false) }
    val own = message.optString("authorId") == app.snapshot.optString("accountId")
    val load = requested || MediaPolicy.automatic(app, pointer, own)
    // Encrypted tiny preview from the sender, shown blurred until the full photo is available.
    val preview = remember(pointer.optString("attachmentId")) { pointer.optString("thumbnail").takeIf { image && it.isNotBlank() }?.let { mediaBitmap(app.decode(it), 64) } }
    LaunchedEffect(pointer.optString("attachmentId"), load) {
        if (video && pointer.optString("thumbnail").isNotBlank()) {
            bitmap = withContext(Dispatchers.IO) { mediaBitmap(app.decode(pointer.optString("thumbnail")), 800) }
        } else if (image && load && bitmap == null) app.fetchMedia(message, conversation, index, pointer) { bytes ->
            if (bytes == null) failed = true else app.decodeImage(bytes) { bitmap = it; failed = it == null }
        }
        // Audio, videos and documents allowed by the auto-download rules are fetched in the
        // background into the private cache, so opening them is instant (and offline-capable).
        if (!image && load && !own && !app.mediaCache.contains(pointer.optString("attachmentId"))) app.fetchMedia(message, conversation, index, pointer)
    }
    if (image || video) {
        val manual = image && !load && bitmap == null
        // Photos keep their own shape (clamped), cropped to the bubble width, no letterboxing (WhatsApp).
        val ratio = bitmap?.let { (it.width.toFloat() / it.height.coerceAtLeast(1)).coerceIn(0.6f, 1.8f) }
        Box((if (compact) Modifier.size(128.dp) else if (ratio != null) Modifier.width(264.dp).aspectRatio(ratio).clip(RoundedCornerShape(8.dp)) else Modifier.width(264.dp).heightIn(min = 140.dp, max = 300.dp)).background(LocalConvoColors.current.canvas, RoundedCornerShape(8.dp)).clickable(onClickLabel = if (manual) "Download $name" else if (video) "Play $name" else "View $name", onClick = { if (manual) requested = true else open() }), contentAlignment = Alignment.Center) {
            if (bitmap == null) preview?.let { Image(it, null, Modifier.matchParentSize().blur(16.dp), contentScale = ContentScale.Crop) }
            bitmap?.let { Image(it, name, Modifier.fillMaxSize(), contentScale = ContentScale.Crop) }
            if (video) Surface(shape = RoundedCornerShape(50), color = LocalConvoColors.current.panelRaised.copy(alpha = .9f)) { Icon(Icons.Outlined.PlayArrow, "Play $name", Modifier.padding(12.dp).size(32.dp)) }
            else if (manual) Surface(shape = RoundedCornerShape(50), color = LocalConvoColors.current.panelRaised.copy(alpha = .9f)) {
                Row(Modifier.padding(horizontal = if (compact) 10.dp else 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Download, null); if (!compact) Text(formatSize(pointer.optLong("size")), Modifier.padding(start = 6.dp)) }
            }
            else if (bitmap == null) {
                if (failed) Text("Tap to retry", Modifier.padding(20.dp)) else CircularProgressIndicator(Modifier.size(28.dp))
            }
        }
    } else Row(Modifier.widthIn(max = 280.dp).background(LocalConvoColors.current.canvas, RoundedCornerShape(8.dp)).padding(10.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(if (pointer.optBoolean("voiceNote")) Icons.Outlined.Mic else if (mime.startsWith("audio/")) Icons.Outlined.PlayCircleOutline else Icons.Outlined.InsertDriveFile, null)
        Column(Modifier.weight(1f).padding(horizontal = 8.dp)) { RawText(name, maxLines = 2, style = MaterialTheme.typography.bodyMedium); Text(if (pointer.has("durationMs")) formatDuration(pointer.optLong("durationMs")) else formatSize(pointer.optLong("size")), style = MaterialTheme.typography.labelSmall) }
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

/** Two or more photos/videos in one message: a 2-column album of up to four tiles, "+N" on the last. */
@Composable fun AlbumGrid(app: MainActivity, message: JSONObject, conversation: String, visual: List<Pair<Int, JSONObject>>, open: (Int) -> Unit) {
    val shown = visual.take(4); val extra = visual.size - shown.size
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        shown.chunked(2).forEach { row -> Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            row.forEach { (index, pointer) -> Box {
                AttachmentTile(app, message, conversation, index, pointer, compact = true) { open(index) }
                // The "+N" overlay replaces the last tile's own controls; tapping opens the viewer.
                if (shown.indexOfFirst { it.first == index } == 3 && extra > 0) Box(Modifier.size(128.dp).background(androidx.compose.ui.graphics.Color(0xFF2A3942)).clickable { open(index) }, contentAlignment = Alignment.Center) {
                    Text("+$extra", color = androidx.compose.ui.graphics.Color.White, style = MaterialTheme.typography.headlineSmall)
                }
            } }
        } }
    }
}
