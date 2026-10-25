package com.convo.android.ui.thread

import com.convo.android.R
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.i18n.*
import com.convo.android.ui.components.*
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.composed
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

/** Poll limits, mirroring the shared core (crypto/content.ts). */
private const val MAX_OPTIONS = 10
private const val MAX_QUESTION = 300
private const val MAX_OPTION = 100

/**
 * A poll inside its bubble (FR-EXT-01): radios (single choice) or checkboxes (multiple), counts
 * with bars, "View votes" with names, and "Close poll" for the author or a group owner/admin.
 * Ballots go through the shared core, which converges every member on the same result.
 */
@Composable fun PollCard(app: MainActivity, message: JSONObject, conversation: String) {
    val colors = LocalConvoColors.current
    val poll = message.optJSONObject("poll") ?: return
    val options = poll.optJSONArray("options")?.objects().orEmpty()
    val votes = poll.optJSONObject("votes") ?: JSONObject()
    val closed = poll.has("closed") && !poll.isNull("closed")
    val multiple = poll.optBoolean("multiple")
    val me = app.snapshot.optString("accountId")
    val mine = votes.optJSONObject(me)?.optJSONArray("optionIds")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
    val counts = options.associate { o -> o.optString("id") to votes.keys().asSequence().count { voter -> votes.optJSONObject(voter)?.optJSONArray("optionIds")?.let { a -> (0 until a.length()).any { a.optString(it) == o.optString("id") } } == true } }
    val voters = votes.keys().asSequence().count { (votes.optJSONObject(it)?.optJSONArray("optionIds")?.length() ?: 0) > 0 }
    val top = maxOf(1, counts.values.maxOrNull() ?: 0)
    var canClose by remember(message.optString("id")) { mutableStateOf(false) }
    var names by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(message.optString("id")) { app.call("canClosePoll", message.targetArgs(conversation), quiet = true) { canClose = it == true } }
    LaunchedEffect(names != null, voters) { if (names != null) app.call("pollVoters", message.targetArgs(conversation), quiet = true) { names = it as? JSONObject ?: JSONObject() } }
    fun vote(optionId: String) {
        if (closed) return
        val next = if (multiple) (if (optionId in mine) mine - optionId else mine + optionId) else (if (optionId in mine) emptyList() else listOf(optionId))
        app.call("votePoll", message.targetArgs(conversation).put("optionIds", JSONArray(next)), quiet = true)
    }
    Column(Modifier.widthIn(min = 240.dp, max = 300.dp).padding(horizontal = 4.dp, vertical = 2.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Poll, null, Modifier.size(18.dp), tint = colors.textSecondary)
            RawText(poll.optString("question"), Modifier.padding(start = 6.dp), fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = if (closed) colors.textSecondary else colors.textPrimary)
        }
        Text(if (closed) "Poll closed" else if (multiple) "Select one or more" else "Select one", Modifier.padding(top = 2.dp, bottom = 6.dp), fontSize = 13.sp, color = colors.textSecondary)
        options.forEach { option ->
            val id = option.optString("id"); val count = counts[id] ?: 0; val chosen = id in mine
            Column(Modifier.fillMaxWidth().clickable(enabled = !closed) { vote(id) }.padding(vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(20.dp).clip(if (multiple) RoundedCornerShape(4.dp) else CircleShape)
                        .background(if (chosen) colors.accent else Color.Transparent)
                        .then(if (chosen) Modifier else Modifier.background(Color.Transparent)), contentAlignment = Alignment.Center) {
                        if (chosen) Icon(Icons.Outlined.Check, null, Modifier.size(14.dp), tint = Color.White)
                        else Box(Modifier.fillMaxSize().padding(1.dp).clip(if (multiple) RoundedCornerShape(4.dp) else CircleShape).background(colors.textSecondary).padding(2.dp).clip(if (multiple) RoundedCornerShape(3.dp) else CircleShape).background(colors.panel))
                    }
                    RawText(option.optString("text"), Modifier.weight(1f).padding(start = 10.dp), fontSize = 15.sp)
                    RawText("$count", fontSize = 13.sp, color = colors.textSecondary)
                }
                Box(Modifier.padding(start = 30.dp, top = 6.dp).fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(colors.border)) {
                    Box(Modifier.fillMaxWidth(count.toFloat() / top).fillMaxHeight().background(if (chosen) colors.accent else colors.accent.copy(alpha = .45f)))
                }
                names?.optJSONArray(id)?.takeIf { it.length() > 0 }?.let { a -> RawText((0 until a.length()).joinToString(", ") { tr(a.optString(it)) }, Modifier.padding(start = 30.dp, top = 4.dp), fontSize = 12.sp, color = colors.textSecondary) }
            }
        }
        HorizontalDivider(Modifier.padding(top = 4.dp), color = colors.border)
        Row(Modifier.fillMaxWidth()) {
            TextButton({ names = if (names == null) JSONObject() else null }, Modifier.weight(1f)) {
                RawText(if (names != null) tr("Hide votes") else tr("View votes ({count})").replace("{count}", "$voters"), color = colors.accentText)
            }
            if (canClose && !closed) TextButton({ app.call("closePoll", message.targetArgs(conversation), quiet = true) }, Modifier.weight(1f)) { Text("Close poll", color = colors.accentText) }
        }
    }
}

/** WhatsApp poll creation: question, options (a new empty field appears as you type), multiple answers. */
@Composable fun PollComposer(app: MainActivity, conversation: String, close: () -> Unit) {
    var question by remember { mutableStateOf("") }
    val options = remember { mutableStateListOf("", "") }
    var multiple by remember { mutableStateOf(true) }
    val filled = options.map { it.trim() }.filter { it.isNotEmpty() }
    fun setOption(index: Int, value: String) {
        options[index] = value.take(MAX_OPTION)
        while (options.size > 2 && options.last().isBlank() && options[options.size - 2].isBlank()) options.removeAt(options.lastIndex)
        if (options.last().isNotBlank() && options.size < MAX_OPTIONS) options.add("")
    }
    AlertDialog(onDismissRequest = close, title = { Text("Create poll") }, text = {
        Column(Modifier.heightIn(max = 460.dp).verticalScrollable(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(question, { question = it.take(MAX_QUESTION) }, label = { Text("Question") }, modifier = Modifier.fillMaxWidth())
            Text("Options", style = MaterialTheme.typography.labelLarge)
            options.forEachIndexed { i, o -> OutlinedTextField(o, { setOption(i, it) }, placeholder = { Text("Add option") }, singleLine = true, modifier = Modifier.fillMaxWidth()) }
            Row(verticalAlignment = Alignment.CenterVertically) { Switch(multiple, { multiple = it }); Text("Allow multiple answers", Modifier.padding(start = 10.dp)) }
            Text("Everyone in this chat can see who voted for what.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }, confirmButton = {
        Button({ app.call("sendPoll", obj("conversationId" to conversation, "question" to question, "options" to JSONArray(filled), "multiple" to multiple)) { if (it != null) close() } },
            enabled = question.isNotBlank() && filled.isNotEmpty()) { Text("Send") }
    }, dismissButton = { TextButton(close) { Text("Cancel") } })
}

private fun Modifier.verticalScrollable(): Modifier = composed { this.verticalScroll(androidx.compose.foundation.rememberScrollState()) }

/** WhatsApp attach sheet: round coloured shortcuts for documents, gallery, audio, polls and events. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun AttachSheet(app: MainActivity, conversation: String, caption: String, allowPoll: Boolean, onSent: () -> Unit, onPoll: () -> Unit, onEvent: () -> Unit, close: () -> Unit) {
    fun pick(mime: String) { close(); app.pickFile({ data, name, type -> app.call("attach", obj("conversationId" to conversation, "data" to data, "name" to name, "mime" to type, "caption" to caption)) { if (it != null) onSent() } }, mime) }
    @Composable fun Shortcut(icon: ImageVector, label: String, color: Color, onClick: () -> Unit) {
        Column(Modifier.width(76.dp).clickable(onClick = onClick).padding(vertical = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(54.dp).clip(CircleShape).background(color), contentAlignment = Alignment.Center) { Icon(icon, null, Modifier.size(26.dp), tint = Color.White) }
            Text(label, Modifier.padding(top = 6.dp), fontSize = 13.sp)
        }
    }
    ModalBottomSheet(onDismissRequest = close) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, bottom = 32.dp), horizontalArrangement = Arrangement.SpaceEvenly) {
            Shortcut(Icons.Outlined.Description, "Document", Color(0xFF7F66FF)) { pick("*/*") }
            Shortcut(Icons.Outlined.Image, "Gallery", Color(0xFF007BFC)) { pick("image/*,video/*") }
            Shortcut(Icons.Outlined.Headphones, "Audio", Color(0xFFFA6533)) { pick("audio/*") }
            if (allowPoll) Shortcut(Icons.Outlined.Poll, "Poll", Color(0xFF02A698)) { close(); onPoll() }
            if (allowPoll) Shortcut(Icons.Outlined.Event, "Event", Color(0xFFD3396D)) { close(); onEvent() }
        }
    }
}
