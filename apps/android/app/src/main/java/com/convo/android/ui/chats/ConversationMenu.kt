@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package com.convo.android.ui.chats

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.bridge.*
import com.convo.android.calls.*
import com.convo.android.i18n.*
import com.convo.android.push.*
import com.convo.android.ui.communities.*
import com.convo.android.ui.components.*
import com.convo.android.ui.contacts.*
import com.convo.android.ui.info.*
import com.convo.android.ui.linking.*
import com.convo.android.ui.locks.*
import com.convo.android.ui.media.*
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

@Composable fun LastSeenLabel(app: MainActivity, id: String) {
    var at by remember(id) { mutableStateOf("") }
    // Groups list their members ("Ana, Bogdan, You"), as the web header does.
    var members by remember(id) { mutableStateOf("") }
    LaunchedEffect(id) { if (id.startsWith("g:")) app.call("memberLabels", obj("id" to id), quiet = true) { v ->
        members = ((v as? JSONArray)?.objects().orEmpty().map { it.optString("label") }.filter { it.isNotBlank() }.sorted() + tr("You")).joinToString(", ") } }
    // WhatsApp: "typing…" replaces last seen while the other person is typing.
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val until = app.typingUntil[id] ?: 0L
    LaunchedEffect(until) { while (until > System.currentTimeMillis()) { now = System.currentTimeMillis(); kotlinx.coroutines.delay(500) }; now = System.currentTimeMillis() }
    if (until > now) { RawText(tr("typing…"), maxLines = 1, fontSize = 13.sp, color = LocalConvoColors.current.success); return }
    if (members.isNotBlank()) { RawText(members, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, fontSize = 13.sp, color = LocalConvoColors.current.textSecondary); return }
    LaunchedEffect(id) { if (id.startsWith("g:")) return@LaunchedEffect; while (true) { app.call("lastSeen", obj("id" to id), quiet = true) { value -> at = (value as? JSONObject)?.optString("at")?.takeUnless { it == "null" } ?: "" }; kotlinx.coroutines.delay(10000) } }
    val seen = try { java.time.Instant.parse(at).atZone(java.time.ZoneId.systemDefault()) } catch (_: Exception) { null }
    if (seen != null) RawText(if (seen.toLocalDate() == java.time.LocalDate.now()) tr("Last seen today at {time}").replace("{time}", seen.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm")))
        else tr("Last seen {date}").replace("{date}", seen.format(java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm"))), maxLines = 1, fontSize = 13.sp, color = LocalConvoColors.current.textSecondary)
}

@Composable fun ConversationQuickMenu(app: MainActivity, conversation: JSONObject) {
    var open by remember { mutableStateOf(false) }
    Box { IconButton(onClick = { open = true }) { Icon(Icons.Outlined.MoreVert, "Chat options") }
        DropdownMenu(open, { open = false }) { ConversationMenuItems(app, conversation) { open = false } }
    }
}
@Composable fun ChatMenu(app: MainActivity) {
    val c = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == app.active } ?: return
    var open by remember { mutableStateOf(false) }; var reporting by remember { mutableStateOf(false) }
    Box { IconButton(onClick = { open = true }) { Icon(Icons.Outlined.MoreVert, "Chat options") }; DropdownMenu(open, { open = false }) {
        DropdownMenuItem(text = { Text(when { c.optString("kind") == "direct" -> "Contact info"; c.optBoolean("adminOnly") -> "Channel info"; c.optString("kind") == "group" -> "Group info"; else -> "Conversation info" }) },
            leadingIcon = { Icon(Icons.Outlined.Info, null) }, onClick = { open = false; app.route = "info" })
        DropdownMenuItem(text = { Text("Search") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, onClick = { open = false; app.threadSearch = true })
        if (c.optString("kind") != "note") DropdownMenuItem(text = { Text("Report") }, leadingIcon = { Icon(Icons.Outlined.Flag, null) }, onClick = { open = false; reporting = true })
        HorizontalDivider()
        ConversationMenuItems(app, c) { open = false } } }
    if (reporting) com.convo.android.ui.thread.ReportDialog(app, c) { reporting = false }
}
@Composable fun ConversationMenuItems(app: MainActivity, c: JSONObject, close: () -> Unit) {
    var confirm by remember { mutableStateOf("") }
    listOf("Pin chat" to "pinned", "Archive chat" to "archived", "Mute notifications" to "muted").forEach { (label, key) -> DropdownMenuItem(text = { Text(if (c.optBoolean(key)) when(key) { "pinned" -> "Unpin chat"; "archived" -> "Unarchive chat"; else -> "Unmute notifications" } else label) }, onClick = { app.call("conversation", obj("id" to c.optString("id"), "patch" to obj(key to !c.optBoolean(key)))); close() }) }
    // Timed snooze (specs §30.8): an overlay; the mute/notify mode above resumes afterwards.
    val snoozeUntil = c.optJSONObject("snooze")?.optLong("until") ?: 0L
    if (snoozeUntil > System.currentTimeMillis()) DropdownMenuItem(text = { RawText(tr("End snooze (until {when})").replace("{when}", java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT).format(java.util.Date(snoozeUntil)))) },
        leadingIcon = { Icon(Icons.Outlined.Schedule, null) }, onClick = { close(); app.call("setSnooze", obj("id" to c.optString("id"), "until" to JSONObject.NULL)) })
    else DropdownMenuItem(text = { Text("Snooze notifications…") }, leadingIcon = { Icon(Icons.Outlined.Schedule, null) }, onClick = { close(); app.snoozeFor = c.optString("id") })
    if (c.optString("kind") == "group" && !c.optBoolean("left")) DropdownMenuItem(text = { Text(if (c.optBoolean("adminOnly")) "Leave channel" else "Leave group", color = MaterialTheme.colorScheme.error) },
        leadingIcon = { Icon(Icons.Outlined.Logout, null, tint = MaterialTheme.colorScheme.error) }, onClick = { confirm = "leave" })
    if (c.optString("kind") == "group") DropdownMenuItem(text = { Text(if (c.optString("notify") == "mentions") "Notify for all messages" else "Notify only for mentions") }, leadingIcon = { Icon(Icons.Outlined.AlternateEmail, null) },
        onClick = { close(); app.call("conversation", obj("id" to c.optString("id"), "patch" to obj("notify" to if (c.optString("notify") == "mentions") JSONObject.NULL else "mentions"))) })
    if (c.optString("kind") == "direct") {
        val blocked = c.optBoolean("blocked")
        DropdownMenuItem(text = { Text(if (blocked) "Unblock" else "Block contact", color = if (blocked) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error) }, leadingIcon = { Icon(Icons.Outlined.Block, null) },
            onClick = { if (blocked) { close(); app.call("block", obj("id" to c.optString("id"), "blocked" to false), success = "Contact unblocked") } else confirm = "block" })
    }
    val chatLocked = app.locks.locked(c.optString("id"))
    if (chatLocked || app.locks.passkey == true) DropdownMenuItem(text = { Text(if (chatLocked) "Stop requiring authentication" else "Require authentication to open") }, leadingIcon = { Icon(Icons.Outlined.Lock, null) }, onClick = {
        close(); app.locks.setChatLocked(c.optString("id"), !chatLocked) { app.notice = if (chatLocked) "Chat unlocked" else "Chat locked"; if (!chatLocked && app.route != "list") app.back() }
    })
    DropdownMenuItem(text = { Text("Clear chat", color = MaterialTheme.colorScheme.error) }, onClick = { confirm = "clear" })
    DropdownMenuItem(text = { Text("Delete chat", color = MaterialTheme.colorScheme.error) }, onClick = { confirm = "deleteChat" })
    ConversationConfirm(app, c, confirm, { confirm = it }, close)
}

/** Info page's red rows (WhatsApp): block or leave, clear and delete, with the menu's confirmations. */
@Composable fun ConversationDangerRows(app: MainActivity, c: JSONObject) {
    var confirm by remember { mutableStateOf("") }
    if (c.optString("kind") == "direct") {
        if (c.optBoolean("blocked")) ActionRow("Unblock", icon = Icons.Outlined.Block) { app.call("block", obj("id" to c.optString("id"), "blocked" to false), success = "Contact unblocked") }
        else ActionRow(tr("Block {name}").replace("{name}", c.optString("title")), icon = Icons.Outlined.Block, danger = true) { confirm = "block" }
    }
    if (c.optString("kind") == "group" && !c.optBoolean("left")) ActionRow(if (c.optBoolean("adminOnly")) "Leave channel" else "Leave group", icon = Icons.Outlined.Logout, danger = true) { confirm = "leave" }
    ActionRow("Clear chat", icon = Icons.Outlined.CleaningServices, danger = true) { confirm = "clear" }
    ActionRow("Delete chat", icon = Icons.Outlined.Delete, danger = true) { confirm = "deleteChat" }
    ConversationConfirm(app, c, confirm, { confirm = it }) {}
}

@Composable private fun ConversationConfirm(app: MainActivity, c: JSONObject, confirm: String, setConfirm: (String) -> Unit, close: () -> Unit) {
    if (confirm == "leave") AlertDialog(onDismissRequest = { setConfirm("") }, title = { Text(if (c.optBoolean("adminOnly")) "Leave channel?" else "Leave group?") },
        text = { Text("You keep the history on your devices but stop receiving new messages.") },
        confirmButton = { TextButton({ setConfirm(""); close(); app.call("leaveGroup", obj("id" to c.optString("id")), quiet = true) { if (it == null) app.error = tr("You are the only owner. Make another member owner first, then leave.") } }) { Text("Leave", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton({ setConfirm("") }) { Text("Cancel") } })
    else if (confirm == "block") AlertDialog(onDismissRequest = { setConfirm("") }, title = { Text("Block contact?") },
        text = { Text("Their messages and calls will no longer reach you, and they won’t be told.") },
        confirmButton = { TextButton({ setConfirm(""); close(); app.call("block", obj("id" to c.optString("id"), "blocked" to true), success = "Contact blocked") }) { Text("Block", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton({ setConfirm("") }) { Text("Cancel") } })
    else     if (confirm.isNotBlank()) AlertDialog(onDismissRequest = { setConfirm("") }, title = { Text(if (confirm == "clear") "Clear chat?" else "Delete chat?") }, text = { Text("This removes the local copy on this device. Other participants keep their messages.") }, confirmButton = { TextButton(onClick = { app.call(confirm, obj("id" to c.optString("id"))); setConfirm(""); close(); if (c.optString("id") == app.active) app.back() }) { Text("Remove", color = MaterialTheme.colorScheme.error) } }, dismissButton = { TextButton(onClick = { setConfirm("") }) { Text("Cancel") } })
}

/** Snooze dialog: presets resolve to an exact local time shown with the time zone before confirming. */
@Composable fun SnoozeDialog(app: MainActivity, conversationId: String) {
    val zone = java.util.TimeZone.getDefault().id
    val now = remember { java.util.Calendar.getInstance() }
    fun at(hour: Int, nextDay: Boolean): Long = (now.clone() as java.util.Calendar).apply {
        if (nextDay) add(java.util.Calendar.DAY_OF_MONTH, 1); set(java.util.Calendar.HOUR_OF_DAY, hour); set(java.util.Calendar.MINUTE, 0); set(java.util.Calendar.SECOND, 0); set(java.util.Calendar.MILLISECOND, 0)
    }.timeInMillis
    val evening = at(18, false).let { if (it <= now.timeInMillis) at(18, true) else it }
    val options = listOf("This evening" to evening, "Tomorrow morning" to at(9, true), "For 1 h" to now.timeInMillis + 3_600_000, "For 4 h" to now.timeInMillis + 4 * 3_600_000)
    var picked by remember { mutableStateOf(0) }
    val format = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT)
    AlertDialog(onDismissRequest = { app.snoozeFor = null }, title = { Text("Snooze notifications") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("Alerts pause until the time you choose. Messages still arrive and count as unread; calls still ring. Afterwards your current notification setting resumes.", style = MaterialTheme.typography.bodySmall)
            options.forEachIndexed { i, (label, time) ->
                Row(Modifier.fillMaxWidth().clickable { picked = i }, verticalAlignment = Alignment.CenterVertically) {
                    RadioButton(picked == i, { picked = i }); Column { Text(label); RawText(format.format(java.util.Date(time)), style = MaterialTheme.typography.bodySmall) }
                }
            }
            RawText(tr("Snoozed until {when} ({zone})").replace("{when}", format.format(java.util.Date(options[picked].second))).replace("{zone}", zone), style = MaterialTheme.typography.bodyMedium)
        }
    }, confirmButton = { TextButton(onClick = { app.call("setSnooze", obj("id" to conversationId, "until" to options[picked].second, "zone" to zone)); app.snoozeFor = null }) { Text("Snooze") } },
        dismissButton = { TextButton(onClick = { app.snoozeFor = null }) { Text("Cancel") } })
}
