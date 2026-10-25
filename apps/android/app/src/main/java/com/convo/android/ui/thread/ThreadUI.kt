@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
package com.convo.android.ui.thread

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
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import androidx.compose.foundation.gestures.detectHorizontalDragGestures

import androidx.compose.material.icons.automirrored.outlined.Reply

import androidx.compose.ui.draw.alpha

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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
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
    val pattern = LocalConvoColors.current.textPrimary.copy(alpha = .06f)
    Box(modifier.background(LocalConvoColors.current.wallpaper)) {
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
    var attachSheet by remember { mutableStateOf(false) }; var pollComposer by remember { mutableStateOf(false) }; var eventComposer by remember { mutableStateOf(false) }
    var stickerSheet by remember { mutableStateOf(false) }
    var sendMenu by remember { mutableStateOf(false) }
    var query by remember(id) { mutableStateOf("") }; var input by remember(id) { mutableStateOf(conversation.optString("draft")) }; var quote by remember(id) { mutableStateOf<JSONObject?>(null) }
    var group by remember(id) { mutableStateOf<JSONObject?>(null) }
    val currentDraft by rememberUpdatedState(input)
    LaunchedEffect(input) { kotlinx.coroutines.delay(250); app.call("conversation", obj("id" to id, "patch" to obj("draft" to input))) }
    DisposableEffect(id) { onDispose { app.call("conversation", obj("id" to id, "patch" to obj("draft" to currentDraft))) } }
    LaunchedEffect(app.threadSearch) { if (!app.threadSearch) query = "" }
    val own = app.snapshot.optString("accountId"); val kind = conversation.optString("kind")
    LaunchedEffect(id, app.snapshot.optString("connection")) { if (kind == "group") app.call("group", obj("id" to id)) { group = it as? JSONObject } }
    val role = group?.optJSONArray("members")?.objects()?.find { it.optString("accountId") == own }?.optString("role")
    // Group topics (specs §30.4): the selected topic filters messages and receives new ones.
    var topic by remember(id) { mutableStateOf<String?>(null) }
    val topics = conversation.optJSONArray("topics")?.objects().orEmpty()
    val isGroupAdmin = role in listOf("owner", "admin")
    val topicClosed = topics.find { it.optString("id") == topic }?.optBoolean("closed") == true && !isGroupAdmin
    // Member restrictions and slow mode (specs §30.4); the shared core enforces them.
    val policy = conversation.optJSONObject("memberPolicy")
    val restrictedHere = kind == "group" && !isGroupAdmin && policy?.optJSONArray("restricted")?.let { a -> (0 until a.length()).any { a.optString(it) == own } } == true
    val slowMode = if (kind == "group" && !isGroupAdmin) policy?.optInt("slowModeSeconds") ?: 0 else 0
    val readOnly = conversation.optBoolean("left") || group?.optBoolean("needsJoin") == true || (conversation.optBoolean("adminOnly") && role !in listOf("owner", "admin")) || topicClosed || restrictedHere
    val messages = all.filter { (topics.isEmpty() || it.optString("topic").ifBlank { null } == topic || (it.has("notice") && topic == null)) && (!starredOnly || it.optBoolean("starred")) && (query.isBlank() || it.optString("body").contains(query, true) || it.optJSONArray("attachments")?.objects()?.any { a -> a.optString("fileName").contains(query, true) } == true) }
    val wallpaper = conversation.optString("wallpaper").takeIf { it.isNotBlank() } ?: app.snapshot.optJSONObject("settings")?.optString("wallpaper") ?: "dots"
    if (attachSheet) AttachSheet(app, id, input, allowPoll = kind != "note", onSent = { input = "" }, onPoll = { pollComposer = true }, onEvent = { eventComposer = true }) { attachSheet = false }
    if (stickerSheet) StickerSheet(app, id, topic) { stickerSheet = false }
    if (pollComposer) PollComposer(app, id) { pollComposer = false }
    if (eventComposer) EventComposer(app, id) { eventComposer = false }
    ChatWallpaper(wallpaper, Modifier.fillMaxSize().background(LocalConvoColors.current.wallpaper)) {
        Column(Modifier.fillMaxSize()) {
            if (app.snapshot.optString("connection") != "online") Text("Waiting for connection. Messages will send when you reconnect.", Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.secondaryContainer).padding(12.dp), style = MaterialTheme.typography.bodySmall)
            if (kind == "group" && !conversation.optBoolean("adminOnly") && !conversation.optBoolean("left") && (topics.isNotEmpty() || isGroupAdmin)) TopicBar(app, id, topics, topic, isGroupAdmin) { topic = it }
            // GRP-01: a device in this group is not vouched for by its account; sending is paused.
            val untrusted = group?.optJSONArray("untrustedDevices")?.length() ?: 0
            if (untrusted > 0) Surface(color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
                RawText(tr("This group contains {count} device(s) that their owners never vouched for. Sending is paused to protect your messages; ask an admin to remove them or contact your security team.").replace("{count}", "$untrusted"),
                    Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = MaterialTheme.colorScheme.onErrorContainer, fontSize = 14.sp)
            }
            // Security identity change (new key for this contact): review the safety number before trusting new messages.
            if (conversation.has("identityChangedAt") && !conversation.isNull("identityChangedAt")) Surface(color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 10.dp)) {
                    RawText(tr("{name}’s security identity changed. Review it before trusting new messages.").replace("{name}", conversation.optString("title")),
                        color = MaterialTheme.colorScheme.onErrorContainer, fontSize = 14.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton({ app.route = "info" }) { Text("Review") }
                        TextButton({ app.call("acknowledgeIdentityChange", obj("id" to id)) }) { Text("Dismiss") }
                    }
                }
            }
            if (app.threadSearch) OutlinedTextField(query, { query = it }, placeholder = { Text(if (starredOnly) "Search starred messages" else "Search this chat") }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 4.dp), leadingIcon = { Icon(Icons.Outlined.Search, null) })
            val listState = androidx.compose.foundation.lazy.rememberLazyListState()
            val scope = rememberCoroutineScope()
            if (!starredOnly) PinnedBanner(app, conversation, all) { target ->
                val at = messages.indexOfFirst { it.optString("authorId") == target.optString("authorId") && it.optString("id") == target.optString("id") }
                if (at >= 0) scope.launch { listState.animateScrollToItem(at + 1) } // +1: encryption header item
            }
            // First-unread navigation: start at the "N unread messages" divider (anchor fixed at open),
            // follow new messages only when already at the bottom, otherwise count them on the jump button.
            val unreadAtOpen = remember(id) { conversation.optInt("unread") }
            var anchor by remember(id) { mutableStateOf<String?>(null) }
            var positioned by remember(id) { mutableStateOf(false) }
            var lastSize by remember(id) { mutableIntStateOf(0) }
            var newBelow by remember(id) { mutableIntStateOf(0) }
            val animate = app.snapshot.optJSONObject("settings")?.optBoolean("animations", true) != false
            LaunchedEffect(messages.size) {
                if (messages.isEmpty()) return@LaunchedEffect
                if (!positioned) {
                    positioned = true
                    val incoming = messages.filter { it.optString("direction") == "in" && !it.has("notice") }
                    anchor = if (unreadAtOpen > 0) incoming.getOrNull(maxOf(0, incoming.size - unreadAtOpen))?.let { "${it.optString("authorId")}/${it.optString("id")}" } else null
                    val at = messages.indexOfFirst { "${it.optString("authorId")}/${it.optString("id")}" == anchor }
                    listState.scrollToItem(if (at >= 0) at + 1 else messages.size)
                } else {
                    // Measured against the layout before the new rows (item 0 is the encryption notice).
                    val wasAtBottom = (listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) >= lastSize - 1
                    // WhatsApp: sending always returns to the newest message, wherever you had scrolled.
                    val sentByMe = messages.size > lastSize && messages.last().optString("direction") == "out"
                    if (wasAtBottom || sentByMe) { if (animate) listState.animateScrollToItem(messages.size) else listState.scrollToItem(messages.size); newBelow = 0 }
                    else if (messages.size > lastSize) newBelow += messages.subList(lastSize.coerceAtMost(messages.size), messages.size).count { it.optString("direction") == "in" && !it.has("notice") }
                }
                lastSize = messages.size
            }
            // The newest message (item index messages.size, after the encryption notice) is out of view.
            val canScrollDown by remember(messages.size) { derivedStateOf { (listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0) < messages.size } }
            LaunchedEffect(canScrollDown) { if (!canScrollDown) newBelow = 0 }
            Box(Modifier.weight(1f)) {
            LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp)) {
                item { EncryptionNotice() }
                itemsIndexed(messages, key = { _, it -> "${it.optString("authorId")}/${it.optString("id")}" }) { index, message ->
                    val previous = messages.getOrNull(index - 1)
                    val newDay = previous == null || dayOf(previous.optLong("sentAt")) != dayOf(message.optLong("sentAt"))
                    if (newDay) DateChip(message.optLong("sentAt"))
                    if (anchor == "${message.optString("authorId")}/${message.optString("id")}") Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.Center) {
                        Surface(shape = RoundedCornerShape(50), color = LocalConvoColors.current.panel) { RawText((if (unreadAtOpen == 1) tr("1 unread message") else tr("{count} unread messages").replace("{count}", "$unreadAtOpen")), Modifier.padding(horizontal = 14.dp, vertical = 4.dp), color = LocalConvoColors.current.accentText, style = MaterialTheme.typography.labelMedium) }
                    }
                    // WhatsApp grouping: a run of messages from one author shares a tail on its first bubble.
                    val first = newDay || previous == null || previous.has("notice") || previous.optString("authorId") != message.optString("authorId")
                    Box(Modifier.padding(top = if (first) 8.dp else 2.dp)) {
                        MessageCard(app, message, id, { selected -> quote = obj("authorId" to selected.optString("authorId"), "messageId" to selected.optString("id"), "excerpt" to selected.optString("body").take(256)) }, first)
                    }
                }
            }
            // Shown once the newest message is out of view; floats over the list like WhatsApp's.
            androidx.compose.animation.AnimatedVisibility(canScrollDown && messages.isNotEmpty(),
                Modifier.align(Alignment.BottomEnd).padding(end = 12.dp, bottom = 12.dp),
                enter = androidx.compose.animation.fadeIn() + androidx.compose.animation.scaleIn(), exit = androidx.compose.animation.fadeOut() + androidx.compose.animation.scaleOut()) {
                ScrollToLatestButton(newBelow) { scope.launch { if (animate) listState.animateScrollToItem(messages.size) else listState.scrollToItem(messages.size) }; newBelow = 0 }
            }
            }
            if (!starredOnly) {
                if (!readOnly && kind != "note") ScheduledBar(app, id)
                if (conversation.optBoolean("request") && !conversation.optBoolean("blocked")) Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("This person is not in your chats yet. Accept to send read receipts and share your profile, or block them.", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        OutlinedButton({ app.call("block", obj("id" to id, "blocked" to true), success = "Contact blocked") }) { Text("Block") }
                        Button({ app.call("acceptRequest", obj("id" to id)) }) { Text("Accept request") }
                    }
                }
                if (conversation.optBoolean("blocked")) Row(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("You blocked this contact.", Modifier.weight(1f)); TextButton({ app.call("block", obj("id" to id, "blocked" to false), success = "Contact unblocked") }) { Text("Unblock") }
                }
                else if (app.selection != null) SelectionBar(app, id, all)
                else if (readOnly) Text(if (restrictedHere) "An admin restricted you from sending messages in this group. You can still read it." else if (topicClosed) "This topic is closed. You can still read it." else if (group?.optBoolean("needsJoin") == true) "History restored. Ask an admin to add this device before sending." else if (conversation.optBoolean("left")) "You are no longer a member of this group" else "Only admins can post in this channel", Modifier.padding(20.dp))
                else Column {
                    if (slowMode > 0) RawText(tr("Slow mode is on: one message every {time}.").replace("{time}", com.convo.android.ui.info.formatInterval(slowMode.toLong())),
                        Modifier.fillMaxWidth().padding(vertical = 4.dp), fontSize = 13.sp, color = LocalConvoColors.current.textSecondary, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    quote?.let { QuotePreview(it.optString("excerpt")) { quote = null } }
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
                    // Community announcements: owners/admins may ask for explicit acknowledgements.
                    var canAck by remember(id) { mutableStateOf(false) }; var requestAck by remember(id) { mutableStateOf(false) }
                    var ackDue by remember(id) { mutableStateOf(0) }; var ackExpires by remember(id) { mutableStateOf(0) }
                    var ackReviewers by remember(id) { mutableStateOf<List<String>?>(null) } // null = publisher + owners
                    LaunchedEffect(id) { if (id.startsWith("g:")) app.call("canRequestAck", obj("id" to id), quiet = true) { canAck = it == true } }
                    if (canAck) Row(Modifier.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(requestAck, { requestAck = it }); Text("Ask members to acknowledge this announcement", style = MaterialTheme.typography.bodySmall)
                    }
                    if (canAck && requestAck) Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        AckDeadlinePicker("Due", ackDue, listOf(0, 1, 3, 7), noneLabel = "No deadline") { ackDue = it; if (ackExpires in 1 until it) ackExpires = it }
                        AckDeadlinePicker("Closes", ackExpires, listOf(0) + listOf(1, 3, 7, 30).filter { it >= ackDue }, noneLabel = "Stays open") { ackExpires = it }
                    }
                    if (canAck && requestAck) Box(Modifier.padding(horizontal = 12.dp)) { AckReviewerPicker(app, id, ackReviewers) { ackReviewers = it } }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 6.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (!voice) {
                            val colors = LocalConvoColors.current
                            // WhatsApp composer: one pill holding the field and attach, the round action outside.
                            Row(Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(24.dp)).background(colors.panel).padding(start = 16.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.weight(1f).padding(vertical = 12.dp)) {
                                    if (input.isEmpty()) Text("Type a message", color = colors.textSecondary, fontSize = 16.sp, maxLines = 1)
                                    BasicTextField(androidx.compose.ui.text.input.TextFieldValue(input, selection), { v -> if (v.text != input) app.typing(id, v.text); input = v.text; selection = v.selection }, maxLines = 6,
                                        textStyle = LocalTextStyle.current.copy(color = colors.textPrimary, fontSize = 16.sp), cursorBrush = SolidColor(colors.accent), modifier = Modifier.fillMaxWidth())
                                }
                                if (app.featureAllowed("stickers")) IconButton({ stickerSheet = true }) { Icon(Icons.Outlined.EmojiEmotions, "Stickers", tint = colors.textSecondary) }
                                IconButton({ attachSheet = true }) { Icon(Icons.Outlined.AttachFile, "Attach file", tint = colors.textSecondary) }
                            }
                        } else Spacer(Modifier.weight(1f))
                        // One VoiceComposer instance for the whole recording (recomposition must not cancel it).
                        if (voice || input.isBlank()) VoiceComposer(app, id) { voice = it }
                        else Box {
                            /** Sends the composer text now, quietly, or schedules it on this phone ([dueAt]). */
                            fun send(silent: Boolean = false, dueAt: Long? = null) {
                                val mentions = org.json.JSONArray(picked.filter { input.contains("@${it.optString("label")}") }.map { it.optString("accountId") }.distinct())
                                val day = 24L * 60 * 60 * 1000; val now = System.currentTimeMillis()
                                val ack: Any = if (!requestAck) false else obj(*listOfNotNull(if (ackDue > 0) "due" to now + ackDue * day else null, if (ackExpires > 0) "expires" to now + ackExpires * day else null,
                                    ackReviewers?.let { "reviewers" to org.json.JSONArray(it) }).toTypedArray())
                                val done: (Any?) -> Unit = { if (it != null) { app.typingStopped(id); input = ""; quote = null; picked.clear(); requestAck = false; ackDue = 0; ackExpires = 0 } }
                                if (dueAt != null) app.call("scheduleMessage", obj("conversationId" to id, "body" to input, "quote" to quote, "mentions" to mentions, "dueAt" to dueAt, "silent" to silent), success = tr("Message scheduled"), then = done)
                                else app.call("send", obj("conversationId" to id, "body" to input, "quote" to quote, "mentions" to mentions, "requestAck" to ack, "silent" to silent, "topic" to topic), then = done)
                            }
                            RoundActionButton(Icons.AutoMirrored.Outlined.Send, "Send message", onLongClick = if (kind == "note") null else ({ sendMenu = true })) { send() }
                            DropdownMenu(sendMenu, { sendMenu = false }) {
                                DropdownMenuItem(text = { Text("Send without sound") }, leadingIcon = { Icon(Icons.Outlined.NotificationsOff, null) }, onClick = { sendMenu = false; send(silent = true) })
                                DropdownMenuItem(text = { Text("Schedule message") }, leadingIcon = { Icon(Icons.Outlined.Schedule, null) }, onClick = {
                                    sendMenu = false; pickDateTime(app, System.currentTimeMillis() + 3_600_000) { at -> if (at > System.currentTimeMillis()) send(dueAt = at) else app.error = tr("Pick a time in the future") }
                                })
                            }
                        }
                    }
                }
            }
        }
    }
}
@Composable fun MessageCard(app: MainActivity, message: JSONObject, conversation: String, onReply: (JSONObject) -> Unit, first: Boolean = true) {
    message.optJSONObject("notice")?.let { TimerNotice(app, message, it.optLong("seconds"), it.optString("kind")); return }
    val outgoing = message.optString("direction") == "out"
    val isSticker = message.has("sticker") && !message.isNull("sticker") && !message.optBoolean("deleted")
    var menu by remember { mutableStateOf(false) }; var info by remember { mutableStateOf(false) }; var edit by remember { mutableStateOf(false) }; var edited by remember { mutableStateOf(message.optString("body")) }
    var delete by remember { mutableStateOf(false) }; var forwarding by remember { mutableStateOf(false) }; var selectedAttachment by remember { mutableIntStateOf(-1) }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (outgoing) Arrangement.End else Arrangement.Start) {
        val key = "${message.optString("authorId")}/${message.optString("id")}"
        val selecting = app.selection != null
        if (selecting) Checkbox(key in app.selection.orEmpty(), { app.toggleSelected(key) }, Modifier.align(Alignment.CenterVertically))
        // Swipe right to reply (specs §30.8): horizontal drags only, so scrolling is unaffected; the
        // "Reply" menu item remains the non-gesture alternative.
        val dragX = remember(key) { androidx.compose.animation.core.Animatable(0f) }
        val threshold = with(androidx.compose.ui.platform.LocalDensity.current) { 64.dp.toPx() }
        val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
        val scope = rememberCoroutineScope()
        val animate = app.snapshot.optJSONObject("settings")?.optBoolean("animations", true) != false
        if (dragX.value > 8f) Icon(Icons.AutoMirrored.Outlined.Reply, "Reply", Modifier.align(Alignment.CenterVertically).padding(end = 4.dp).alpha((dragX.value / threshold).coerceIn(0f, 1f)))
        Column(horizontalAlignment = if (outgoing) Alignment.End else Alignment.Start) {
        Card(Modifier.widthIn(max = 320.dp)
            .offset { androidx.compose.ui.unit.IntOffset(dragX.value.toInt(), 0) }
            .pointerInput(key, selecting) {
                if (selecting || message.optBoolean("deleted")) return@pointerInput
                detectHorizontalDragGestures(
                    onDragEnd = {
                        if (dragX.value >= threshold) onReply(message)
                        scope.launch { if (animate) dragX.animateTo(0f) else dragX.snapTo(0f) }
                    },
                    onDragCancel = { scope.launch { dragX.snapTo(0f) } },
                ) { change, amount ->
                    val next = (dragX.value + amount).coerceIn(0f, threshold * 1.4f)
                    if (dragX.value < threshold && next >= threshold) haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.LongPress)
                    change.consume(); scope.launch { dragX.snapTo(next) }
                }
            }
            .combinedClickable(onClickLabel = null, onLongClickLabel = tr("Message options"), onClick = { if (selecting) app.toggleSelected(key) }, onLongClick = { if (selecting) app.toggleSelected(key) else menu = true }),
            // Stickers sit on the wallpaper without bubble chrome, like WhatsApp.
            colors = CardDefaults.cardColors(contentColor = LocalConvoColors.current.textPrimary, containerColor = if (isSticker) androidx.compose.ui.graphics.Color.Transparent else if (outgoing) LocalConvoColors.current.bubbleOut else LocalConvoColors.current.bubbleIn),
            elevation = CardDefaults.cardElevation(defaultElevation = if (isSticker) 0.dp else 0.5.dp),
            shape = RoundedCornerShape(topStart = if (first && !outgoing) 0.dp else 10.dp, topEnd = if (first && outgoing) 0.dp else 10.dp, bottomStart = 10.dp, bottomEnd = 10.dp)) {
            val media = message.optJSONArray("attachments")?.length()?.let { it > 0 } == true
            Column(Modifier.padding(start = if (media) 4.dp else 9.dp, end = if (media) 4.dp else 9.dp, top = if (media) 4.dp else 6.dp, bottom = 5.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (conversation.startsWith("g:") && !outgoing && first) AccountName(app, message.optString("authorId"))
                message.optJSONObject("quote")?.let { RawText(it.optString("excerpt"), color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodySmall, modifier = Modifier.border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(6.dp)).padding(8.dp)) }
                if (message.optBoolean("deleted")) Text("This message was deleted", style = MaterialTheme.typography.bodySmall)
                else if (message.optBoolean("undecryptable")) Text("Message could not be decrypted", color = MaterialTheme.colorScheme.error)
                else {
                    // View-once media is never rendered as a normal attachment (no tile, cache or gallery).
                    val viewOnce = message.optJSONObject("viewOnce")
                    val attachments = if (viewOnce != null) emptyList() else message.optJSONArray("attachments")?.objects().orEmpty()
                    if (viewOnce != null) ViewOnceTile(app, message, conversation, viewOnce)
                    // Text first only without attachments; with media the caption goes underneath (WhatsApp).
                    if (message.has("sticker") && !message.isNull("sticker")) message.optJSONObject("sticker")?.let { StickerImage(app, it.optString("pack"), it.optString("id")) }
                    else if (message.has("report") && !message.isNull("report")) ReportCard(message)
                    else if (message.has("poll") && !message.isNull("poll")) PollCard(app, message, conversation)
                    else if (message.has("event") && !message.isNull("event")) EventCard(app, message, conversation)
                    else if (attachments.isEmpty() && message.optString("body").isNotBlank()) LinkedBody(app, message.optString("body"), message.optJSONArray("mentionLabels")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty(), metaReserve(message, outgoing))
                    if (message.has("ackRequest")) AckBox(app, message)
                    val visual = attachments.withIndex().filter { (_, a) -> a.optString("contentType").let { it.startsWith("image/") || it.startsWith("video/") } }.map { it.index to it.value }
                    if (visual.size >= 2) AlbumGrid(app, message, conversation, visual) { selectedAttachment = it }
                    message.optJSONArray("pendingFiles")?.objects()?.forEach { f ->
                        Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Schedule, null, Modifier.size(16.dp)); RawText(" ${f.optString("name")} · ${tr(if (message.optString("status") == "failed") "upload failed" else "waiting for connection")}", style = MaterialTheme.typography.bodySmall) }
                    }
                    attachments.forEachIndexed { index, a ->
                        // Voice notes and audio play inline (WhatsApp), never in the full-screen viewer.
                        if (a.optString("contentType").startsWith("audio/") || a.optBoolean("voiceNote")) com.convo.android.ui.media.VoicePlayer(app, message, conversation, index, a)
                        else if (visual.size < 2 || visual.none { it.first == index }) AttachmentTile(app, message, conversation, index, a) { selectedAttachment = index }
                    }
                    if (attachments.isNotEmpty() && message.optString("body").isNotBlank()) Box(Modifier.padding(horizontal = 5.dp)) { LinkedBody(app, message.optString("body"), message.optJSONArray("mentionLabels")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()) }
                }
                // Time and ticks sit at the end of the last text line (space reserved by metaReserve).
                val meta = LocalConvoColors.current.bubbleMeta
                val hasBody = message.optString("body").isNotBlank() && !message.optBoolean("deleted") && message.optJSONArray("attachments")?.length().let { it == null || it == 0 } && !message.has("ackRequest")
                Row(Modifier.align(Alignment.End).then(if (hasBody) Modifier.layout { measurable, constraints ->
                    // Zero-height slot: drawn over the reserved tail of the last text line.
                    val placeable = measurable.measure(constraints); layout(placeable.width, 0) { placeable.place(0, -placeable.height + 2.dp.roundToPx()) }
                } else Modifier), verticalAlignment = Alignment.CenterVertically) {
                    if (message.optLong("expireTimer") > 0 && !message.optBoolean("deleted")) Icon(Icons.Outlined.Timer, "Disappearing message", Modifier.size(14.dp).padding(end = 3.dp))
                    if (message.has("editedAt") && !message.optBoolean("deleted")) Text("edited ", fontSize = 11.sp, color = meta)
                    RawText(SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(message.optLong("sentAt"))), fontSize = 11.sp, color = meta)
                    if (message.optBoolean("starred")) Icon(Icons.Outlined.StarOutline, "Starred", Modifier.size(14.dp).padding(start = 3.dp))
                    if (outgoing) { val status = message.optString("status"); Icon(if (status in listOf("read", "delivered")) Icons.Outlined.DoneAll else if (status == "sent") Icons.Outlined.Done else if (status == "failed") Icons.Outlined.ErrorOutline else Icons.Outlined.Schedule, when(status) { "read" -> "Seen"; "delivered" -> "Received"; "sent" -> "Sent"; else -> status }, Modifier.size(18.dp).padding(start = 3.dp), tint = if (status == "read") LocalConvoColors.current.tickRead else meta) }
                    Box {
                        DropdownMenu(menu, { menu = false }) {
                            // Reaction bar first (WhatsApp long-press).
                            Row(Modifier.padding(horizontal = 8.dp, vertical = 2.dp)) { listOf("👍", "❤️", "😂", "😮", "😢", "🙏").forEach { emoji -> TextButton({ app.call("react", message.targetArgs(conversation).put("emoji", emoji)); menu = false }, contentPadding = PaddingValues(2.dp), modifier = Modifier.width(42.dp)) { RawText(emoji, fontSize = 22.sp) } } }
                            HorizontalDivider()
                            DropdownMenuItem(text = { Text("Message info") }, leadingIcon = { Icon(Icons.Outlined.Info, null) }, onClick = { menu = false; info = true })
                            DropdownMenuItem(text = { Text("Select") }, leadingIcon = { Icon(Icons.Outlined.CheckCircleOutline, null) }, onClick = { menu = false; app.selection = setOf("${message.optString("authorId")}/${message.optString("id")}") })
                            if (app.canPinActive) {
                                val pinned = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == conversation }?.optJSONArray("pinnedMessages")?.objects().orEmpty()
                                    .any { it.optString("authorId") == message.optString("authorId") && it.optString("id") == message.optString("id") }
                                DropdownMenuItem(text = { Text(if (pinned) "Unpin" else "Pin for everyone") }, leadingIcon = { Icon(Icons.Outlined.PushPin, null) }, onClick = { menu = false; app.call("pin", message.targetArgs(conversation).put("pinned", !pinned)) })
                            }
                            DropdownMenuItem(text = { Text("Reply") }, leadingIcon = { Icon(Icons.AutoMirrored.Outlined.Reply, null) }, onClick = { menu = false; onReply(message) })
                            if (!message.has("viewOnce")) DropdownMenuItem(text = { Text("Forward") }, leadingIcon = { Icon(Icons.Outlined.Shortcut, null) }, onClick = { menu = false; forwarding = true })
                            DropdownMenuItem(text = { Text(if (message.optBoolean("starred")) "Unstar" else "Star") }, leadingIcon = { Icon(Icons.Outlined.StarOutline, null) }, onClick = { menu = false; app.call("star", message.targetArgs(conversation).put("value", !message.optBoolean("starred"))) })
                            DropdownMenuItem(text = { Text("Copy text") }, leadingIcon = { Icon(Icons.Outlined.ContentCopy, null) }, onClick = { menu = false; (app.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Convo message", message.optString("body"))) })
                            if (outgoing && message.optLong("editableUntil", 0L) > System.currentTimeMillis()) DropdownMenuItem(text = { Text("Edit") }, leadingIcon = { Icon(Icons.Outlined.Edit, null) }, onClick = { menu = false; edit = true })
                            DropdownMenuItem(text = { Text("Delete", color = MaterialTheme.colorScheme.error) }, leadingIcon = { Icon(Icons.Outlined.Delete, null, tint = MaterialTheme.colorScheme.error) }, onClick = { menu = false; delete = true })
                            if (message.optString("status") == "failed") DropdownMenuItem(text = { Text("Retry") }, leadingIcon = { Icon(Icons.Outlined.Refresh, null) }, onClick = { menu = false; app.call("retry", message.targetArgs(conversation)) })
                        }
                    }
                }
            }
        }
        ReactionPill(message)
        }
    }
    if (selectedAttachment >= 0) AttachmentDialog(app, message, conversation, selectedAttachment) { selectedAttachment = -1 }
    if (info) MessageInfo(app, message, { info = false })
    if (edit) AlertDialog(onDismissRequest = { edit = false }, title = { Text("Edit message") }, text = { OutlinedTextField(edited, { edited = it }) }, confirmButton = { TextButton({ app.call("edit", message.targetArgs(conversation).put("body", edited)); edit = false }) { Text("Save") } }, dismissButton = { TextButton({ edit = false }) { Text("Cancel") } })
    if (delete) AlertDialog(onDismissRequest = { delete = false }, title = { Text("Delete message?") }, text = { Text("Choose whether to remove your local copy or delete your message for everyone.") }, confirmButton = { Column { if (outgoing) TextButton({ app.call("deleteMessage", message.targetArgs(conversation).put("everyone", true)); delete = false }) { Text("Delete for everyone") }; TextButton({ app.call("deleteMessage", message.targetArgs(conversation).put("everyone", false)); delete = false }) { Text("Delete for me") } } }, dismissButton = { TextButton({ delete = false }) { Text("Cancel") } })
    if (forwarding) AlertDialog(onDismissRequest = { forwarding = false }, title = { Text("Forward to") }, text = { LazyColumn { items(app.snapshot.optJSONArray("conversations")?.objects().orEmpty().filter { !app.locks.locked(it.optString("id")) }) { c -> TextButton({ app.call("forward", message.targetArgs(conversation).put("destination", c.optString("id"))); forwarding = false }) { Text(c.optString("title")) } } } }, confirmButton = { TextButton({ forwarding = false }) { Text("Cancel") } })
}
@Composable fun LinkedBody(app: MainActivity, body: String, mentions: List<String> = emptyList(), reserve: String = "") {
    var external by remember { mutableStateOf<String?>(null) }
    val pattern = remember { Regex("https?://[^\\s<>]+|www\\.[^\\s<>]+", RegexOption.IGNORE_CASE) }
    val links = pattern.findAll(body).map { it.value.trimEnd('.', ',', ';', '!', '?', ')', ']', '}') }.toList()
    // @mentions are highlighted; the labels come from the message's structured mention IDs.
    val accent = LocalConvoColors.current.accentText
    val annotated = remember(body, mentions, reserve) {
        androidx.compose.ui.text.buildAnnotatedString {
            append(body)
            mentions.forEach { label -> var at = body.indexOf("@$label"); while (at >= 0) { addStyle(androidx.compose.ui.text.SpanStyle(color = accent, fontWeight = FontWeight.SemiBold), at, at + label.length + 1); at = body.indexOf("@$label", at + 1) } }
            // Invisible tail the width of the time/ticks, so they fit on the last line (WhatsApp).
            if (reserve.isNotEmpty()) { pushStyle(androidx.compose.ui.text.SpanStyle(color = androidx.compose.ui.graphics.Color.Transparent, fontSize = 11.sp)); append(reserve); pop() }
        }
    }
    // No SelectionContainer: it would take the bubble's long-press (message options has "Copy text").
    androidx.compose.material3.Text(annotated, fontSize = 16.sp, lineHeight = 21.sp)
    links.forEach { text -> val target = if (text.startsWith("www.")) "https://$text" else text
        val uri = Uri.parse(target)
        if (uri.scheme in listOf("https", "http") && uri.userInfo == null) TextButton(onClick = { if (app.snapshot.optJSONObject("settings")?.optBoolean("confirmExternalLinks", true) != false) external = target else app.startActivity(Intent(Intent.ACTION_VIEW, uri)) }, contentPadding = PaddingValues(0.dp)) { Icon(Icons.Outlined.OpenInNew, null, Modifier.size(16.dp)); RawText(tr("Open {link}").replace("{link}", text), maxLines = 2) }
    }
    external?.let { url -> ExternalLinkConfirmation(url, { external = null }, { external = null; app.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }) }
}
@Composable fun AccountName(app: MainActivity, id: String) {
    var label by remember(id) { mutableStateOf("") }; LaunchedEffect(id) { app.call("account", obj("id" to id)) { label = (it as? JSONObject)?.label() ?: "" } }
    if (label.isNotBlank()) Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
}
@Composable fun MessageInfo(app: MainActivity, message: JSONObject, close: () -> Unit) {
    AlertDialog(onDismissRequest = close, title = { Text("Message info") }, text = { Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text(message.optString("body")); RawText(tr("Sent {time}").replace("{time}", "${Date(message.optLong("sentAt"))}"))
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
    var zoom by remember { mutableStateOf(false) }
    var bytes by remember(position) { mutableStateOf<ByteArray?>(null) }
    LaunchedEffect(position) { app.fetchMedia(message, conversation, index, pointer) { bytes = it } }
    val mime = pointer.optString("contentType"); val video = mime.startsWith("video/"); val audio = mime.startsWith("audio/")
    val bitmap = remember(bytes) { if (mime in MediaPolicy.imageTypes && bytes != null) mediaBitmap(bytes!!) else null }
    val temp = remember(bytes) { if ((video || audio) && bytes != null) File(app.cacheDir, "convo-preview-${java.util.UUID.randomUUID()}").apply { writeBytes(bytes!!) } else null }
    DisposableEffect(temp) { onDispose { temp?.delete() } }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        // WhatsApp viewer: black canvas, translucent top bar (back, sender/time, save), swipe to page.
        Surface(Modifier.fillMaxSize(), color = Color.Black, contentColor = Color.White) { Column {
            Row(Modifier.fillMaxWidth().background(Color(0x99000000)).padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(close) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Close viewer", tint = Color.White) }
                Column(Modifier.weight(1f)) {
                    RawText(pointer.optString("fileName", tr("Media")), maxLines = 1, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    RawText(SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault()).format(Date(message.optLong("sentAt"))), fontSize = 13.sp, color = Color(0xFFC7D0D6))
                }
                IconButton(onClick = { bytes?.let { app.export(pointer.optString("fileName", "file"), mime, it) } }, enabled = bytes != null) { Icon(Icons.Outlined.Download, "Download", tint = Color.White) }
            }
            var drag by remember { mutableFloatStateOf(0f) }
            Box(Modifier.weight(1f).fillMaxWidth().pointerInput(position, items.size) {
                // Swipe left/right pages through the chat's photos and videos.
                detectHorizontalDragGestures(onDragStart = { drag = 0f }, onDragEnd = {
                    if (drag < -120 && position < items.lastIndex) position++ else if (drag > 120 && position > 0) position--
                }) { _, amount -> drag += amount }
            }, contentAlignment = Alignment.Center) {
                if (bytes == null) CircularProgressIndicator(color = Color.White)
                else if (bitmap != null) Image(bitmap, pointer.optString("fileName"), Modifier.fillMaxSize().clickable { zoom = !zoom }, contentScale = if (zoom) androidx.compose.ui.layout.ContentScale.Crop else androidx.compose.ui.layout.ContentScale.Fit)
                else if (temp != null) AndroidView(factory = { context -> VideoView(context).apply { setVideoURI(Uri.fromFile(temp)); setMediaController(MediaController(context).also { it.setAnchorView(this) }); setOnPreparedListener { start() } } }, modifier = Modifier.fillMaxSize())
                else Text("This file is ready to save.", color = Color.White)
            }
            if (items.size > 1) Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                IconButton({ position-- }, enabled = position > 0) { Icon(Icons.Outlined.ChevronLeft, "Previous", tint = if (position > 0) Color.White else Color(0x55FFFFFF)) }
                RawText("${position + 1} / ${items.size}", color = Color(0xFFC7D0D6), fontSize = 14.sp)
                IconButton({ position++ }, enabled = position < items.lastIndex) { Icon(Icons.Outlined.ChevronRight, "Next", tint = if (position < items.lastIndex) Color.White else Color(0x55FFFFFF)) }
            }
        } }
    }
}

/** Disappearing timer labels shared by notices and the info picker. */
val DisappearingTimers = listOf(0L to "Off", 86_400L to "24 hours", 604_800L to "7 days", 7_776_000L to "90 days")
fun timerLabel(seconds: Long) = tr(DisappearingTimers.find { it.first == seconds }?.second ?: "Off")

@Composable fun TimerNotice(app: MainActivity, message: JSONObject, seconds: Long, kind: String = "timer") {
    val own = message.optString("authorId") == app.snapshot.optString("accountId")
    val who = if (own) tr("You") else app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == message.optString("authorId") }?.optString("title") ?: message.optString("authorId").take(8)
    val notice = message.optJSONObject("notice")
    val device = notice?.let { "${when (it.optString("platform")) { "android" -> "Android"; "ios" -> "iOS"; else -> "Web" }} (#${it.optInt("deviceId")})" } ?: ""
    val text = if (kind == "device") (if (notice?.optString("change") == "added") tr("Security: a new device was linked to your account — {device}. If this wasn’t you, unlink it in Settings → Devices.") else tr("Security: {device} was removed from your account.")).replace("{device}", device)
        else if (kind == "left") tr("{who} left").replace("{who}", who) else if (seconds > 0) tr("{who} set disappearing messages to {duration}").replace("{who}", who).replace("{duration}", timerLabel(seconds))
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

/** Placeholder text as wide as the bubble's meta row ("edited 14:05 ✓✓"), drawn transparent. */
fun metaReserve(message: JSONObject, outgoing: Boolean): String {
    val attachments = message.optJSONArray("attachments")?.length() ?: 0
    if (attachments > 0 || message.has("ackRequest")) return ""
    var width = 7 // " 00:00" plus a gap
    if (message.has("editedAt")) width += 7
    if (message.optLong("expireTimer") > 0) width += 2
    if (message.optBoolean("starred")) width += 2
    if (outgoing) width += 3
    return "\u00A0".repeat(2) + "\u2007".repeat(width)
}

fun dayOf(at: Long): java.time.LocalDate = java.time.Instant.ofEpochMilli(at).atZone(java.time.ZoneId.systemDefault()).toLocalDate()

/** "TODAY" / "YESTERDAY" / date chip between days (web `.day-chip`). */
@Composable fun DateChip(at: Long) {
    val colors = LocalConvoColors.current
    val day = dayOf(at); val today = java.time.LocalDate.now()
    val label = when (day) {
        today -> tr("Today"); today.minusDays(1) -> tr("Yesterday")
        else -> day.format(java.time.format.DateTimeFormatter.ofPattern(if (day.year == today.year) "d MMMM" else "d MMMM yyyy", java.util.Locale.forLanguageTag(if (Strings.locale == "ro") "ro" else "en")))
    }
    Row(Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 2.dp), horizontalArrangement = Arrangement.Center) {
        Surface(shape = RoundedCornerShape(8.dp), color = colors.panel, shadowElevation = 0.5.dp) {
            RawText(label.uppercase(), Modifier.padding(horizontal = 12.dp, vertical = 5.dp), color = colors.textSecondary, fontSize = 12.sp, fontWeight = FontWeight.Medium)
        }
    }
}

/** Yellow end-to-end encryption pill at the top of every chat (web `.e2e-notice`). */
@Composable fun EncryptionNotice() {
    val colors = LocalConvoColors.current
    Row(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 6.dp), horizontalArrangement = Arrangement.Center) {
        Surface(shape = RoundedCornerShape(8.dp), color = colors.warningBg) {
            Row(Modifier.padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Lock, null, Modifier.size(13.dp), tint = colors.warningText)
                Text("Your personal messages are end-to-end encrypted", Modifier.padding(start = 6.dp), color = colors.warningText, fontSize = 12.5.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
    }
}

/** Reply preview above the composer: accent bar, excerpt, cancel. */
@Composable fun QuotePreview(excerpt: String, onCancel: () -> Unit) {
    val colors = LocalConvoColors.current
    Row(Modifier.fillMaxWidth().padding(start = 8.dp, end = 8.dp, top = 6.dp).clip(RoundedCornerShape(12.dp)).background(colors.panel).height(IntrinsicSize.Min), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(4.dp).fillMaxHeight().background(colors.accent))
        Column(Modifier.weight(1f).padding(horizontal = 10.dp, vertical = 8.dp)) {
            Text("Reply", color = colors.accentText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            RawText(excerpt, maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, color = colors.textSecondary, fontSize = 14.sp)
        }
        IconButton(onCancel) { Icon(Icons.Outlined.Close, "Cancel reply", tint = colors.textSecondary) }
    }
}

/** Reactions as a pill overlapping the bubble's bottom edge (WhatsApp / web `.reactions`). */
@Composable fun ReactionPill(message: JSONObject) {
    val reactions = message.optJSONObject("reactions") ?: return
    if (reactions.length() == 0 || message.optBoolean("deleted")) return
    val colors = LocalConvoColors.current
    val counts = reactions.keys().asSequence().map { it to (reactions.optJSONArray(it)?.length() ?: 0) }.filter { it.second > 0 }.toList()
    if (counts.isEmpty()) return
    Surface(Modifier.padding(horizontal = 8.dp).offset(y = (-6).dp).testTag("reaction"), shape = RoundedCornerShape(12.dp), color = colors.panelRaised, shadowElevation = 1.dp, border = androidx.compose.foundation.BorderStroke(1.dp, colors.wallpaper)) {
        RawText(counts.joinToString(" ") { it.first } + (counts.sumOf { it.second }.takeIf { it > 1 }?.let { " $it" } ?: ""),
            Modifier.padding(horizontal = 6.dp, vertical = 2.dp), fontSize = 14.sp, color = colors.textSecondary)
    }
}

/**
 * WhatsApp's "scroll to latest" control: a small round chevron over the bottom of the chat, with a
 * green count of messages that arrived while you were reading older ones.
 */
@Composable private fun ScrollToLatestButton(newMessages: Int, onClick: () -> Unit) {
    val colors = LocalConvoColors.current
    Box(contentAlignment = Alignment.TopCenter) {
        Surface(onClick = onClick, Modifier.padding(top = if (newMessages > 0) 10.dp else 0.dp).size(42.dp), shape = CircleShape, color = colors.panel, shadowElevation = 3.dp) {
            Box(contentAlignment = Alignment.Center) { Icon(Icons.Outlined.KeyboardDoubleArrowDown, tr("Jump to latest messages"), tint = colors.textSecondary) }
        }
        if (newMessages > 0) Surface(shape = RoundedCornerShape(50), color = colors.success) {
            RawText(if (newMessages > 99) "99+" else "$newMessages", Modifier.padding(horizontal = 6.dp, vertical = 1.dp), color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
