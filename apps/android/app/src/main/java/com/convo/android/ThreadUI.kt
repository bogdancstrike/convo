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
import kotlinx.coroutines.launch
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.ui.input.pointer.pointerInput
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
            val scope = rememberCoroutineScope()
            if (!starredOnly) PinnedBanner(app, conversation, all) { target ->
                val at = messages.indexOfFirst { it.optString("authorId") == target.optString("authorId") && it.optString("id") == target.optString("id") }
                if (at >= 0) scope.launch { listState.animateScrollToItem(at + 1) } // +1: encryption header item
            }
            LaunchedEffect(messages.size) { if (messages.isNotEmpty()) if (app.snapshot.optJSONObject("settings")?.optBoolean("animations", true) != false) listState.animateScrollToItem(messages.size) else listState.scrollToItem(messages.size) }
            LazyColumn(Modifier.weight(1f), state = listState, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                item { Text("Your personal messages are end-to-end encrypted", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                items(messages, key = { "${it.optString("authorId")}/${it.optString("id")}" }) { message -> MessageCard(app, message, id, { selected -> quote = obj("authorId" to selected.optString("authorId"), "messageId" to selected.optString("id"), "excerpt" to selected.optString("body").take(256)) }) }
            }
            if (!starredOnly) {
                if (conversation.optBoolean("blocked")) Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("You blocked this contact.", Modifier.weight(1f)); TextButton({ app.call("block", obj("id" to id, "blocked" to false), success = "Contact unblocked") }) { Text("Unblock") }
                }
                else if (app.selection != null) SelectionBar(app, id, all)
                else if (readOnly) Text(if (group?.optBoolean("needsJoin") == true) "History restored. Ask an admin to add this device before sending." else if (conversation.optBoolean("left")) "You are no longer a member of this group" else "Only admins can post in this channel", Modifier.padding(20.dp))
                else Column(Modifier.background(MaterialTheme.colorScheme.surface)) {
                    quote?.let { Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) { Text("Reply: ${it.optString("excerpt")}", Modifier.weight(1f), maxLines = 2); IconButton({ quote = null }) { Icon(Icons.Outlined.Close, "Cancel reply") } } }
                    var voice by remember(id) { mutableStateOf(false) }
                    // Caret position (coerced to the text): moves to the end after inserting a mention.
                    var selection by remember(id) { mutableStateOf(androidx.compose.ui.text.TextRange(input.length)) }
                    // @mentions (groups): suggestions for the trailing `@query`, picked members sent as IDs.
                    var members by remember(id) { mutableStateOf<List<JSONObject>>(emptyList()) }
                    val picked = remember(id) { mutableStateListOf<JSONObject>() }
                    LaunchedEffect(id) { if (id.startsWith("g:")) app.call("memberLabels", obj("id" to id), quiet = true) { v -> members = (v as? org.json.JSONArray)?.objects().orEmpty() } }
                    val mentionQuery = Regex("(^|\\s)@([^\\s@]{0,32})$").find(input)?.groupValues?.get(2)
                    val suggestions = if (mentionQuery == null) emptyList() else members.filter { m -> m.optString("label").lowercase().split(" ").any { it.startsWith(mentionQuery.lowercase()) } }.take(5)
                    if (suggestions.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        suggestions.forEach { m -> AssistChip({ input = input.dropLast(mentionQuery!!.length + 1) + "@${m.optString("label")} "; selection = androidx.compose.ui.text.TextRange(input.length); picked.removeAll { it.optString("accountId") == m.optString("accountId") }; picked.add(m) },
                            label = { RawText("@${m.optString("label")}") }) }
                    }
                    Row(Modifier.fillMaxWidth().padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        if (!voice) {
                            IconButton({ app.pickFile({ data, name, mime -> app.call("attach", obj("conversationId" to id, "data" to data, "name" to name, "mime" to mime, "caption" to input)) { if (it != null) input = "" } }) }) { Icon(Icons.Outlined.AttachFile, "Attach file") }
                            OutlinedTextField(androidx.compose.ui.text.input.TextFieldValue(input, selection), { v -> input = v.text; selection = v.selection }, placeholder = { Text("Type a message") }, modifier = Modifier.weight(1f), maxLines = 5, shape = RoundedCornerShape(24.dp))
                        } else Spacer(Modifier.weight(1f))
                        // One VoiceComposer instance for the whole recording (recomposition must not cancel it).
                        if (voice || input.isBlank()) VoiceComposer(app, id) { voice = it }
                        else IconButton(onClick = {
                            val mentions = org.json.JSONArray(picked.filter { input.contains("@${it.optString("label")}") }.map { it.optString("accountId") }.distinct())
                            app.call("send", obj("conversationId" to id, "body" to input, "quote" to quote, "mentions" to mentions)) { if (it != null) { input = ""; quote = null; picked.clear() } } }) { Icon(Icons.AutoMirrored.Outlined.Send, "Send message", tint = MaterialTheme.colorScheme.primary) }
                    }
                }
            }
        }
    }
}
@Composable fun MessageCard(app: MainActivity, message: JSONObject, conversation: String, onReply: (JSONObject) -> Unit) {
    message.optJSONObject("notice")?.let { TimerNotice(app, message, it.optLong("seconds")); return }
    val outgoing = message.optString("direction") == "out"
    var menu by remember { mutableStateOf(false) }; var info by remember { mutableStateOf(false) }; var edit by remember { mutableStateOf(false) }; var edited by remember { mutableStateOf(message.optString("body")) }
    var delete by remember { mutableStateOf(false) }; var forwarding by remember { mutableStateOf(false) }; var selectedAttachment by remember { mutableIntStateOf(-1) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (outgoing) Arrangement.End else Arrangement.Start) {
        val key = "${message.optString("authorId")}/${message.optString("id")}"
        val selecting = app.selection != null
        if (selecting) Checkbox(key in app.selection.orEmpty(), { app.toggleSelected(key) }, Modifier.align(Alignment.CenterVertically))
        Card(Modifier.widthIn(max = 320.dp).combinedClickable(onClick = { if (selecting) app.toggleSelected(key) }, onLongClick = { if (selecting) app.toggleSelected(key) else menu = true }), colors = CardDefaults.cardColors(contentColor = LocalConvoColors.current.textPrimary, containerColor = if (outgoing) MaterialTheme.colorScheme.secondaryContainer else LocalConvoColors.current.bubbleIn), shape = RoundedCornerShape(8.dp)) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (conversation.startsWith("g:") && !outgoing) AccountName(app, message.optString("authorId"))
                message.optJSONObject("quote")?.let { RawText(it.optString("excerpt"), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(6.dp)).padding(8.dp)) }
                if (message.optBoolean("deleted")) Text("This message was deleted", style = MaterialTheme.typography.bodySmall)
                else if (message.optBoolean("undecryptable")) Text("Message could not be decrypted", color = MaterialTheme.colorScheme.error)
                else {
                    if (message.optString("body").isNotBlank()) LinkedBody(app, message.optString("body"), message.optJSONArray("mentionLabels")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty())
                    message.optJSONArray("attachments")?.objects()?.forEachIndexed { index, a ->
                        AttachmentTile(app, message, conversation, index, a) { selectedAttachment = index }
                    }
                }
                message.optJSONObject("reactions")?.let { reactions -> if (reactions.length() > 0) Text(reactions.keys().asSequence().joinToString("  ") { "${it} ${reactions.optJSONArray(it)?.length() ?: 0}" }) }
                Row(Modifier.align(Alignment.End), verticalAlignment = Alignment.CenterVertically) {
                    if (message.optLong("expireTimer") > 0 && !message.optBoolean("deleted")) Icon(Icons.Outlined.Timer, "Disappearing message", Modifier.size(14.dp).padding(end = 3.dp))
                    if (message.has("editedAt") && !message.optBoolean("deleted")) Text("edited ", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(message.optLong("sentAt"))), style = MaterialTheme.typography.labelSmall)
                    if (message.optBoolean("starred")) Icon(Icons.Outlined.StarOutline, "Starred", Modifier.size(14.dp).padding(start = 3.dp))
                    if (outgoing) { val status = message.optString("status"); Icon(if (status in listOf("read", "delivered")) Icons.Outlined.DoneAll else if (status == "sent") Icons.Outlined.Done else if (status == "failed") Icons.Outlined.ErrorOutline else Icons.Outlined.Schedule, when(status) { "read" -> "Seen"; "delivered" -> "Received"; "sent" -> "Sent"; else -> status }, Modifier.size(18.dp).padding(start = 4.dp), tint = if (status == "read") LocalConvoColors.current.tickRead else MaterialTheme.colorScheme.onSurfaceVariant) }
                    Box { IconButton(onClick = { menu = true }, modifier = Modifier.size(28.dp)) { Icon(Icons.Outlined.KeyboardArrowDown, "Message options", Modifier.size(18.dp)) }
                        DropdownMenu(menu, { menu = false }) {
                            Row { listOf("👍", "❤️", "😂", "😮", "😢", "🙏").forEach { emoji -> TextButton({ app.call("react", message.targetArgs(conversation).put("emoji", emoji)); menu = false }, contentPadding = PaddingValues(2.dp), modifier = Modifier.width(38.dp)) { Text(emoji) } } }
                            DropdownMenuItem(text = { Text("Message info") }, onClick = { menu = false; info = true })
                            DropdownMenuItem(text = { Text("Select") }, onClick = { menu = false; app.selection = setOf("${message.optString("authorId")}/${message.optString("id")}") })
                            if (app.canPinActive) {
                                val pinned = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == conversation }?.optJSONArray("pinnedMessages")?.objects().orEmpty()
                                    .any { it.optString("authorId") == message.optString("authorId") && it.optString("id") == message.optString("id") }
                                DropdownMenuItem(text = { Text(if (pinned) "Unpin" else "Pin for everyone") }, onClick = { menu = false; app.call("pin", message.targetArgs(conversation).put("pinned", !pinned)) })
                            }
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
    if (forwarding) AlertDialog(onDismissRequest = { forwarding = false }, title = { Text("Forward to") }, text = { LazyColumn { items(app.snapshot.optJSONArray("conversations")?.objects().orEmpty().filter { !app.locks.locked(it.optString("id")) }) { c -> TextButton({ app.call("forward", message.targetArgs(conversation).put("destination", c.optString("id"))); forwarding = false }) { Text(c.optString("title")) } } } }, confirmButton = { TextButton({ forwarding = false }) { Text("Cancel") } })
}
@Composable fun LinkedBody(app: MainActivity, body: String, mentions: List<String> = emptyList()) {
    var external by remember { mutableStateOf<String?>(null) }
    val pattern = remember { Regex("https?://[^\\s<>]+|www\\.[^\\s<>]+", RegexOption.IGNORE_CASE) }
    val links = pattern.findAll(body).map { it.value.trimEnd('.', ',', ';', '!', '?', ')', ']', '}') }.toList()
    // @mentions are highlighted; the labels come from the message's structured mention IDs.
    val accent = MaterialTheme.colorScheme.primary
    val annotated = remember(body, mentions) {
        androidx.compose.ui.text.buildAnnotatedString {
            append(body)
            mentions.forEach { label -> var at = body.indexOf("@$label"); while (at >= 0) { addStyle(androidx.compose.ui.text.SpanStyle(color = accent, fontWeight = FontWeight.SemiBold), at, at + label.length + 1); at = body.indexOf("@$label", at + 1) } }
        }
    }
    SelectionContainer { androidx.compose.material3.Text(annotated) }
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
private fun isVisual(pointer: JSONObject) = pointer.optString("contentType").let { it in setOf("image/jpeg", "image/png", "image/webp", "image/gif") || it.startsWith("video/") }

/**
 * Viewer entry point: photos and videos page through every visual attachment of the open chat
 * (like the web viewer); documents and audio show on their own.
 */
@Composable fun AttachmentDialog(app: MainActivity, message: JSONObject, conversation: String, initial: Int, close: () -> Unit) {
    val own = message.optJSONArray("attachments")?.objects().orEmpty()
    val items = remember(message, initial) {
        val chosen = own.getOrNull(initial)
        val chat = if (conversation == app.active) app.snapshot.optJSONArray("messages")?.objects().orEmpty() else emptyList()
        val visual = chat.filter { !it.optBoolean("deleted") }.flatMap { m -> m.optJSONArray("attachments")?.objects().orEmpty().mapIndexedNotNull { i, p -> if (isVisual(p)) m to i else null } }
        if (chosen != null && isVisual(chosen) && visual.any { (m, i) -> m.optString("id") == message.optString("id") && i == initial }) visual
        else own.indices.map { message to it }
    }
    val start = items.indexOfFirst { (m, i) -> m.optString("id") == message.optString("id") && m.optString("authorId") == message.optString("authorId") && i == initial }.coerceAtLeast(0)
    MediaViewer(app, items, start, conversation, close)
}

@Composable fun MediaViewer(app: MainActivity, items: List<Pair<JSONObject, Int>>, initial: Int, conversation: String, close: () -> Unit) {
    var position by remember { mutableIntStateOf(initial) }
    val (message, index) = items.getOrNull(position) ?: return
    val attachments = message.optJSONArray("attachments")?.objects().orEmpty(); val pointer = attachments.getOrNull(index) ?: return
    var loaded by remember(position) { mutableStateOf<JSONObject?>(null) }; var zoom by remember { mutableStateOf(false) }
    LaunchedEffect(position) { app.call("download", message.targetArgs(conversation).put("index", index)) { loaded = it as? JSONObject; loaded?.optString("data")?.takeIf { d -> d.isNotEmpty() }?.let { d -> app.saveReceivedMedia(message, pointer, d) } } }
    val bytes = remember(loaded) { loaded?.optString("data")?.let { app.decode(it) } }
    val mime = pointer.optString("contentType"); val video = mime.startsWith("video/"); val audio = mime.startsWith("audio/")
    val bitmap = remember(bytes) { if (mime in listOf("image/jpeg", "image/png", "image/webp") && bytes != null) mediaBitmap(bytes) else null }
    val temp = remember(bytes) { if ((video || audio) && bytes != null) File(app.cacheDir, "convo-preview-${java.util.UUID.randomUUID()}").apply { writeBytes(bytes) } else null }
    DisposableEffect(temp) { onDispose { temp?.delete() } }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) { Column {
            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) { Text(pointer.optString("fileName", "Media"), Modifier.weight(1f), maxLines = 1); IconButton(onClick = { if (bytes != null) app.export(pointer.optString("fileName", "file"), mime, bytes) }, enabled = bytes != null) { Icon(Icons.Outlined.Download, "Download") }; IconButton(close) { Icon(Icons.Outlined.Close, "Close viewer") } }
            var drag by remember { mutableFloatStateOf(0f) }
            Box(Modifier.weight(1f).fillMaxWidth().pointerInput(position, items.size) {
                // Swipe left/right pages through the chat's photos and videos.
                detectHorizontalDragGestures(onDragStart = { drag = 0f }, onDragEnd = {
                    if (drag < -120 && position < items.lastIndex) position++ else if (drag > 120 && position > 0) position--
                }) { _, amount -> drag += amount }
            }, contentAlignment = Alignment.Center) {
                if (loaded == null) CircularProgressIndicator()
                else if (bitmap != null) Image(bitmap, pointer.optString("fileName"), Modifier.fillMaxSize().clickable { zoom = !zoom }, contentScale = if (zoom) androidx.compose.ui.layout.ContentScale.Crop else androidx.compose.ui.layout.ContentScale.Fit)
                else if (temp != null) AndroidView(factory = { context -> VideoView(context).apply { setVideoURI(Uri.fromFile(temp)); setMediaController(MediaController(context).also { it.setAnchorView(this) }); setOnPreparedListener { start() } } }, modifier = Modifier.fillMaxSize())
                else Text("This file is ready to save.")
            }
            Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween) { TextButton({ position-- }, enabled = position > 0) { Text("Previous") }; Text("${position + 1} / ${items.size}"); TextButton({ position++ }, enabled = position < items.lastIndex) { Text("Next") } }
        } }
    }
}

/** Disappearing timer labels shared by notices and the info picker. */
val DisappearingTimers = listOf(0L to "Off", 86_400L to "24 hours", 604_800L to "7 days", 7_776_000L to "90 days")
fun timerLabel(seconds: Long) = tr(DisappearingTimers.find { it.first == seconds }?.second ?: "Off")

@Composable fun TimerNotice(app: MainActivity, message: JSONObject, seconds: Long) {
    val own = message.optString("authorId") == app.snapshot.optString("accountId")
    val who = if (own) tr("You") else app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == message.optString("authorId") }?.optString("title") ?: message.optString("authorId").take(8)
    val text = if (seconds > 0) tr("{who} set disappearing messages to {duration}").replace("{who}", who).replace("{duration}", timerLabel(seconds))
        else tr("{who} turned off disappearing messages").replace("{who}", who)
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.Center) {
        Surface(shape = RoundedCornerShape(8.dp), color = MaterialTheme.colorScheme.surface) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Timer, null, Modifier.size(14.dp)); RawText(" $text", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Shared pins: one pinned message at a time under the header; tap cycles, × unpins (if allowed). */
@Composable fun PinnedBanner(app: MainActivity, conversation: JSONObject, messages: List<JSONObject>, onJump: (JSONObject) -> Unit) {
    val pins = conversation.optJSONArray("pinnedMessages")?.objects().orEmpty()
    val targets = pins.mapNotNull { p -> messages.find { it.optString("authorId") == p.optString("authorId") && it.optString("id") == p.optString("id") && !it.optBoolean("deleted") } }
    if (targets.isEmpty()) return
    var index by remember(conversation.optString("id")) { mutableIntStateOf(0) }
    val current = targets[index % targets.size]
    Surface(color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().clickable { onJump(current); index = (index + 1) % targets.size }.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.PushPin, null, Modifier.size(16.dp))
            Column(Modifier.weight(1f).padding(start = 8.dp)) {
                Text(if (targets.size > 1) tr("Pinned {n} of {total}").replace("{n}", "${index % targets.size + 1}").replace("{total}", "${targets.size}") else "Pinned message", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                RawText(current.optString("body").ifBlank { tr("📷 Photo") }, maxLines = 1, style = MaterialTheme.typography.bodySmall)
            }
            if (app.canPinActive) IconButton({ app.call("pin", current.targetArgs(conversation.optString("id")).put("pinned", false)) }) { Icon(Icons.Outlined.Close, "Unpin") }
        }
    }
}

/** Batch actions on selected messages (max 100): copy, star, forward to one chat, delete for me. */
@Composable fun SelectionBar(app: MainActivity, conversation: String, all: List<JSONObject>) {
    val keys = app.selection ?: return
    val chosen = all.filter { "${it.optString("authorId")}/${it.optString("id")}" in keys }.sortedBy { it.optLong("sort") }
    var forward by remember { mutableStateOf(false) }; var delete by remember { mutableStateOf(false) }
    fun each(method: String, extra: (JSONObject) -> JSONObject = { it }) = chosen.forEach { app.call(method, extra(it.targetArgs(conversation)), quiet = true) }
    Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton({ app.selection = null }) { Icon(Icons.Outlined.Close, "Cancel selection") }
        RawText(tr("{count} selected").replace("{count}", "${chosen.size}"), Modifier.weight(1f))
        IconButton({ (app.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Convo messages", chosen.joinToString("\n") { it.optString("body") })); app.notice = "Copied" }, enabled = chosen.isNotEmpty()) { Icon(Icons.Outlined.ContentCopy, "Copy text") }
        IconButton({ val value = !chosen.all { it.optBoolean("starred") }; each("star") { it.put("value", value) }; app.selection = null }, enabled = chosen.isNotEmpty()) { Icon(Icons.Outlined.StarOutline, "Star") }
        IconButton({ forward = true }, enabled = chosen.isNotEmpty()) { Icon(Icons.AutoMirrored.Outlined.Send, "Forward") }
        IconButton({ delete = true }, enabled = chosen.isNotEmpty()) { Icon(Icons.Outlined.Delete, "Delete for me", tint = MaterialTheme.colorScheme.error) }
    }
    if (delete) Confirm("Delete selected messages for you?", "Other participants keep their copies.", "Delete for me", { delete = false }) { delete = false; each("deleteMessage") { it.put("everyone", false) }; app.selection = null }
    if (forward) AlertDialog(onDismissRequest = { forward = false }, title = { Text("Forward to") }, text = { LazyColumn { items(app.snapshot.optJSONArray("conversations")?.objects().orEmpty().filter { !app.locks.locked(it.optString("id")) }) { c ->
        TextButton({ forward = false; each("forward") { it.put("destination", c.optString("id")) }; app.selection = null; app.notice = "Forwarded" }) { RawText(c.optString("title")) } } } },
        confirmButton = { TextButton({ forward = false }) { Text("Cancel") } })
}
