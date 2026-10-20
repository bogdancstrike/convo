@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
package com.convo.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable fun ChatWallpaper(style: String, modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    val pattern = MaterialTheme.colorScheme.onBackground.copy(alpha = .045f)
    Box(modifier.background(MaterialTheme.colorScheme.background)) {
        Canvas(Modifier.matchParentSize()) {
            when (style) {
                "dots" -> { var x = 0f; while (x < size.width) { var y = 0f; while (y < size.height) { drawCircle(pattern, 1.5f, Offset(x, y)); y += 24.dp.toPx() }; x += 24.dp.toPx() } }
                "ocean" -> { var radius = 40f; while (radius < size.maxDimension * 2) { drawCircle(pattern, radius, Offset.Zero, style = androidx.compose.ui.graphics.drawscope.Stroke(2f)); radius += 45.dp.toPx() } }
                "botanical" -> { var x = -20f; while (x < size.width) { var y = 0f; while (y < size.height) { drawOval(pattern, topLeft = Offset(x, y), size = androidx.compose.ui.geometry.Size(24.dp.toPx(), 50.dp.toPx())); y += 110.dp.toPx() }; x += 70.dp.toPx() } }
            }
        }; content()
    }
}
fun JSONObject.targetArgs(conversation: String) = obj("conversationId" to conversation, "id" to optString("id"), "authorId" to optString("authorId"))
@Composable fun NativeThread(app: MainActivity, starredOnly: Boolean = false) {
    val id = app.active ?: return
    val conversation = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == id } ?: return
    val all = app.snapshot.optJSONArray("messages")?.objects().orEmpty()
    var query by remember(id) { mutableStateOf("") }; var input by remember(id) { mutableStateOf(conversation.optString("draft")) }; var quote by remember(id) { mutableStateOf<JSONObject?>(null) }
    var group by remember(id) { mutableStateOf<JSONObject?>(null) }
    val currentDraft by rememberUpdatedState(input)
    LaunchedEffect(input) { kotlinx.coroutines.delay(250); app.call("conversation", obj("id" to id, "patch" to obj("draft" to input))) }
    DisposableEffect(id) { onDispose { app.call("conversation", obj("id" to id, "patch" to obj("draft" to currentDraft))) } }
    LaunchedEffect(app.threadSearch) { if (!app.threadSearch) query = "" }
    val own = app.snapshot.optString("accountId"); val kind = conversation.optString("kind")
    LaunchedEffect(id, app.snapshot.optString("connection")) { if (kind == "group") app.call("group", obj("id" to id)) { group = it as? JSONObject } }
    val role = group?.optJSONArray("members")?.objects()?.find { it.optString("accountId") == own }?.optString("role")
    val readOnly = conversation.optBoolean("left") || group?.optBoolean("needsJoin") == true || (conversation.optBoolean("adminOnly") && role !in listOf("owner", "admin"))
    val messages = all.filter { (!starredOnly || it.optBoolean("starred")) && (query.isBlank() || it.optString("body").contains(query, true) || it.optJSONArray("attachments")?.objects()?.any { a -> a.optString("fileName").contains(query, true) } == true) }
    val wallpaper = conversation.optString("wallpaper").takeIf { it.isNotBlank() } ?: app.snapshot.optJSONObject("settings")?.optString("wallpaper") ?: "dots"
    ChatWallpaper(wallpaper, Modifier.fillMaxSize().background(LocalConvoColors.current.wallpaper)) {
        Column(Modifier.fillMaxSize()) {
            if (app.snapshot.optString("connection") != "online") Text("Waiting for connection. Messages will send when you reconnect.", Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.secondaryContainer).padding(12.dp), style = MaterialTheme.typography.bodySmall)
            if (app.threadSearch) OutlinedTextField(query, { query = it }, placeholder = { Text(if (starredOnly) "Search starred messages" else "Search this chat") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), leadingIcon = { Icon(Icons.Outlined.Search, null) })
            val listState = androidx.compose.foundation.lazy.rememberLazyListState()
            LaunchedEffect(messages.size) { if (messages.isNotEmpty()) if (app.snapshot.optJSONObject("settings")?.optBoolean("animations", true) != false) listState.animateScrollToItem(messages.size) else listState.scrollToItem(messages.size) }
            LazyColumn(Modifier.weight(1f), state = listState, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Text("Your personal messages are end-to-end encrypted", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(messages, key = { "${it.optString("authorId")}/${it.optString("id")}" }) { message -> MessageCard(app, message, id, { selected -> quote = obj("authorId" to selected.optString("authorId"), "messageId" to selected.optString("id"), "excerpt" to selected.optString("body").take(256)) }) }
            }
            if (!starredOnly) {
                if (readOnly) Text(if (group?.optBoolean("needsJoin") == true) "History restored. Ask an admin to add this device before sending." else if (conversation.optBoolean("left")) "You are no longer a member of this group" else "Only admins can post in this channel", Modifier.padding(20.dp))
                else Column(Modifier.background(MaterialTheme.colorScheme.surface)) {
                    quote?.let { Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) { Text("Reply: ${it.optString("excerpt")}", Modifier.weight(1f), maxLines = 2); IconButton({ quote = null }) { Icon(Icons.Outlined.Close, "Cancel reply") } } }
                    Row(Modifier.fillMaxWidth().padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        IconButton({ app.pickFile({ data, name, mime -> app.call("attach", obj("conversationId" to id, "data" to data, "name" to name, "mime" to mime, "caption" to input)) { if (it != null) input = "" } }) }) { Icon(Icons.Outlined.AttachFile, "Attach file") }
                        OutlinedTextField(input, { input = it }, placeholder = { Text("Type a message") }, modifier = Modifier.weight(1f), maxLines = 5, shape = RoundedCornerShape(24.dp))
                        IconButton(onClick = { if (input.isNotBlank()) app.call("send", obj("conversationId" to id, "body" to input, "quote" to quote)) { if (it != null) { input = ""; quote = null } } }, enabled = input.isNotBlank()) { Icon(Icons.AutoMirrored.Outlined.Send, "Send message", tint = MaterialTheme.colorScheme.primary) }
                    }
                }
            }
        }
    }
}
@Composable fun MessageCard(app: MainActivity, message: JSONObject, conversation: String, onReply: (JSONObject) -> Unit) {
    val outgoing = message.optString("direction") == "out"
    var menu by remember { mutableStateOf(false) }; var info by remember { mutableStateOf(false) }; var edit by remember { mutableStateOf(false) }; var edited by remember { mutableStateOf(message.optString("body")) }
    var delete by remember { mutableStateOf(false) }; var forwarding by remember { mutableStateOf(false) }; var selectedAttachment by remember { mutableIntStateOf(-1) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (outgoing) Arrangement.End else Arrangement.Start) {
        Card(Modifier.widthIn(max = 320.dp).combinedClickable(onClick = {}, onLongClick = { menu = true }), colors = CardDefaults.cardColors(contentColor = LocalConvoColors.current.textPrimary, containerColor = if (outgoing) MaterialTheme.colorScheme.secondaryContainer else LocalConvoColors.current.bubbleIn), shape = RoundedCornerShape(8.dp)) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (conversation.startsWith("g:") && !outgoing) AccountName(app, message.optString("authorId"))
                message.optJSONObject("quote")?.let { Text(it.optString("excerpt"), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(6.dp)).padding(8.dp)) }
                if (message.optBoolean("deleted")) Text("This message was deleted", style = MaterialTheme.typography.bodySmall)
                else if (message.optBoolean("undecryptable")) Text("Message could not be decrypted", color = MaterialTheme.colorScheme.error)
                else {
                    if (message.optString("body").isNotBlank()) LinkedBody(app, message.optString("body"))
                    message.optJSONArray("attachments")?.objects()?.forEachIndexed { index, a ->
                        AttachmentTile(app, message, conversation, index, a) { selectedAttachment = index }
                    }
                }
                message.optJSONObject("reactions")?.let { reactions -> if (reactions.length() > 0) Text(reactions.keys().asSequence().joinToString("  ") { "${it} ${reactions.optJSONArray(it)?.length() ?: 0}" }) }
                Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    if (message.has("editedAt") && !message.optBoolean("deleted")) Text("edited ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(message.optLong("sentAt"))), style = MaterialTheme.typography.labelSmall)
                    if (message.optBoolean("starred")) Icon(Icons.Outlined.StarOutline, "Starred", Modifier.size(14.dp).padding(start = 3.dp))
                    if (outgoing) { val status = message.optString("status"); Icon(if (status in listOf("read", "delivered")) Icons.Outlined.DoneAll else if (status == "sent") Icons.Outlined.Done else if (status == "failed") Icons.Outlined.ErrorOutline else Icons.Outlined.Schedule, when(status) { "read" -> "Seen"; "delivered" -> "Received"; "sent" -> "Sent"; else -> status }, Modifier.size(18.dp).padding(start = 4.dp), tint = if (status == "read") LocalConvoColors.current.tickRead else MaterialTheme.colorScheme.onSurfaceVariant) }
                    Box { IconButton(onClick = { menu = true }, modifier = Modifier.size(28.dp)) { Icon(Icons.Outlined.KeyboardArrowDown, "Message options", Modifier.size(18.dp)) }
                        DropdownMenu(menu, { menu = false }) {
                            Row { listOf("👍", "❤️", "😂", "😮", "😢", "🙏").forEach { emoji -> TextButton({ app.call("react", message.targetArgs(conversation).put("emoji", emoji)); menu = false }, contentPadding = PaddingValues(2.dp), modifier = Modifier.width(38.dp)) { Text(emoji) } } }
                            DropdownMenuItem(text = { Text("Message info") }, onClick = { menu = false; info = true })
                            DropdownMenuItem(text = { Text("Reply") }, onClick = { menu = false; onReply(message) })
                            DropdownMenuItem(text = { Text("Forward") }, onClick = { menu = false; forwarding = true })
                            DropdownMenuItem(text = { Text(if (message.optBoolean("starred")) "Unstar" else "Star") }, onClick = { menu = false; app.call("star", message.targetArgs(conversation).put("value", !message.optBoolean("starred"))) })
                            DropdownMenuItem(text = { Text("Copy text") }, onClick = { menu = false; (app.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Convo message", message.optString("body"))) })
                            if (outgoing && message.optLong("editableUntil", 0L) > System.currentTimeMillis()) DropdownMenuItem(text = { Text("Edit") }, onClick = { menu = false; edit = true })
                            DropdownMenuItem(text = { Text("Delete", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; delete = true })
                            if (message.optString("status") == "failed") DropdownMenuItem(text = { Text("Retry") }, onClick = { menu = false; app.call("retry", message.targetArgs(conversation)) })
                        }
                    }
                }
            }
        }
    }
    if (selectedAttachment >= 0) AttachmentDialog(app, message, conversation, selectedAttachment) { selectedAttachment = -1 }
    if (info) MessageInfo(app, message, { info = false })
    if (edit) AlertDialog(onDismissRequest = { edit = false }, title = { Text("Edit message") }, text = { OutlinedTextField(edited, { edited = it }) }, confirmButton = { TextButton({ app.call("edit", message.targetArgs(conversation).put("body", edited)); edit = false }) { Text("Save") } }, dismissButton = { TextButton({ edit = false }) { Text("Cancel") } })
    if (delete) AlertDialog(onDismissRequest = { delete = false }, title = { Text("Delete message?") }, text = { Text("Choose whether to remove your local copy or delete your message for everyone.") }, confirmButton = { Column { if (outgoing) TextButton({ app.call("deleteMessage", message.targetArgs(conversation).put("everyone", true)); delete = false }) { Text("Delete for everyone") }; TextButton({ app.call("deleteMessage", message.targetArgs(conversation).put("everyone", false)); delete = false }) { Text("Delete for me") } } }, dismissButton = { TextButton({ delete = false }) { Text("Cancel") } })
    if (forwarding) AlertDialog(onDismissRequest = { forwarding = false }, title = { Text("Forward to") }, text = { LazyColumn { items(app.snapshot.optJSONArray("conversations")?.objects().orEmpty()) { c -> TextButton({ app.call("forward", message.targetArgs(conversation).put("destination", c.optString("id"))); forwarding = false }) { Text(c.optString("title")) } } } }, confirmButton = { TextButton({ forwarding = false }) { Text("Cancel") } })
}
@Composable fun LinkedBody(app: MainActivity, body: String) {
    var external by remember { mutableStateOf<String?>(null) }
    val pattern = remember { Regex("https?://[^\\s<>]+|www\\.[^\\s<>]+", RegexOption.IGNORE_CASE) }
    val links = pattern.findAll(body).map { it.value.trimEnd('.', ',', ';', '!', '?', ')', ']', '}') }.toList()
    SelectionContainer { Text(body) }
    links.forEach { text -> val target = if (text.startsWith("www.")) "https://$text" else text
        val uri = Uri.parse(target)
        if (uri.scheme in listOf("https", "http") && uri.userInfo == null) TextButton(onClick = { if (app.snapshot.optJSONObject("settings")?.optBoolean("confirmExternalLinks", true) != false) external = target else app.startActivity(Intent(Intent.ACTION_VIEW, uri)) }, contentPadding = PaddingValues(0.dp)) { Icon(Icons.Outlined.OpenInNew, null, Modifier.size(16.dp)); Text("Open $text", maxLines = 2) }
    }
    external?.let { url -> ExternalLinkConfirmation(url, { external = null }, { external = null; app.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }) }
}
@Composable fun AccountName(app: MainActivity, id: String) {
    var label by remember(id) { mutableStateOf("") }; LaunchedEffect(id) { app.call("account", obj("id" to id)) { label = (it as? JSONObject)?.label() ?: "" } }
    if (label.isNotBlank()) Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
}
@Composable fun MessageInfo(app: MainActivity, message: JSONObject, close: () -> Unit) {
    AlertDialog(onDismissRequest = close, title = { Text("Message info") }, text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(message.optString("body")); Text("Sent ${Date(message.optLong("sentAt"))}")
        val live = app.snapshot.optJSONArray("messages")?.objects()?.find { it.optString("id") == message.optString("id") && it.optString("authorId") == message.optString("authorId") } ?: message
        val receipts = live.optJSONObject("receipts") ?: JSONObject()
        listOf("Read by" to true, "Delivered to" to false).forEach { (title, read) -> Text(title, style = MaterialTheme.typography.titleMedium); receipts.keys().asSequence().forEach { account -> val r = receipts.getJSONObject(account); if ((read && r.has("readAt")) || (!read && r.has("deliveredAt") && !r.has("readAt"))) { AccountName(app, account); Text(Date(r.optLong(if (read) "readAt" else "deliveredAt")).toString(), style = MaterialTheme.typography.bodySmall) } } }
        Text("Read confirmations appear only when recipients choose to share them.", style = MaterialTheme.typography.bodySmall)
    } }, confirmButton = { TextButton(close) { Text("Close") } })
}
@Composable fun AttachmentDialog(app: MainActivity, message: JSONObject, conversation: String, initial: Int, close: () -> Unit) {
    var index by remember { mutableIntStateOf(initial) }; val attachments = message.optJSONArray("attachments")?.objects().orEmpty(); val pointer = attachments.getOrNull(index) ?: return
    var loaded by remember(index) { mutableStateOf<JSONObject?>(null) }; var zoom by remember { mutableStateOf(false) }
    LaunchedEffect(index) { app.call("download", message.targetArgs(conversation).put("index", index)) { loaded = it as? JSONObject } }
    val bytes = remember(loaded) { loaded?.optString("data")?.let { app.decode(it) } }
    val mime = pointer.optString("contentType"); val video = mime.startsWith("video/"); val audio = mime.startsWith("audio/")
    val bitmap = remember(bytes) { if (mime in listOf("image/jpeg", "image/png", "image/webp") && bytes != null) mediaBitmap(bytes) else null }
    val temp = remember(bytes) { if ((video || audio) && bytes != null) File(app.cacheDir, "convo-preview-${java.util.UUID.randomUUID()}").apply { writeBytes(bytes) } else null }
    DisposableEffect(temp) { onDispose { temp?.delete() } }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { Column {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) { Text(pointer.optString("fileName", "Media"), Modifier.weight(1f), maxLines = 1); IconButton(onClick = { if (bytes != null) app.export(pointer.optString("fileName", "file"), mime, bytes) }, enabled = bytes != null) { Icon(Icons.Outlined.Download, "Download") }; IconButton(close) { Icon(Icons.Outlined.Close, "Close viewer") } }
            Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                if (loaded == null) CircularProgressIndicator()
                else if (bitmap != null) Image(bitmap, pointer.optString("fileName"), Modifier.fillMaxSize().clickable { zoom = !zoom }, contentScale = if (zoom) androidx.compose.ui.layout.ContentScale.Crop else androidx.compose.ui.layout.ContentScale.Fit)
                else if (temp != null) AndroidView(factory = { context -> VideoView(context).apply { setVideoURI(Uri.fromFile(temp)); setMediaController(MediaController(context).also { it.setAnchorView(this) }); setOnPreparedListener { start() } } }, modifier = Modifier.fillMaxSize())
                else Text("This file is ready to save.")
            }
            Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) { TextButton({ index-- }, enabled = index > 0) { Text("Previous") }; Text("${index + 1} / ${attachments.size}"); TextButton({ index++ }, enabled = index < attachments.lastIndex) { Text("Next") } }
        } }
    }
}
