@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
package com.convo.android.ui.chats

import com.convo.android.*
import com.convo.android.bridge.*
import com.convo.android.i18n.*
import com.convo.android.ui.components.*
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState

/**
 * The chat list (web: ChatListPanel): pill search, All / Unread / Groups filters, an "Archived"
 * row on top, and WhatsApp-style rows with time, sender prefix, status icons and unread badge.
 * Long-press or the row's ⋮ opens the same conversation menu as the web.
 */
@Composable fun ChatList(app: MainActivity, channels: Boolean, unreadOnly: Boolean = false) {
    val colors = LocalConvoColors.current
    var query by remember { mutableStateOf("") }; var matches by remember { mutableStateOf(emptyList<String>()) }
    var archived by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf(if (unreadOnly) "unread" else "all") }
    // Private chat folders (specs §30.4): re-read whenever the snapshot changes (sync from own devices).
    var folders by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var editingFolder by remember { mutableStateOf<JSONObject?>(null) }; var newFolder by remember { mutableStateOf(false) }
    LaunchedEffect(app.snapshot) { if (!channels) app.call("folders", quiet = true) { v -> folders = (v as? JSONArray)?.objects().orEmpty() } }
    val activeFolder = folders.find { "folder:${it.optString("id")}" == filter }
    // Locked chats are listed only after authenticating, never in ordinary lists or search.
    var showLocked by remember { mutableStateOf(false) }
    val locked = app.locks.lockedChats
    BackHandler(archived) { archived = false }
    LaunchedEffect(query) { if (query.isBlank()) matches = emptyList() else { kotlinx.coroutines.delay(200); app.call("search", obj("query" to query)) { result -> matches = (result as? JSONArray)?.objects()?.map { it.optString("conversationId") }?.filter { it !in app.locks.lockedChats } ?: emptyList() } } }
    LaunchedEffect(app.locks.appUnlocked) { if (!app.locks.appUnlocked) showLocked = false }
    val all = app.snapshot.optJSONArray("conversations")?.objects().orEmpty()
    val scope = all.filter { (it.optString("id") in locked) == showLocked && (showLocked || it.optBoolean("adminOnly") == channels || !channels) && (!channels || it.optBoolean("adminOnly")) }
    val archivedCount = scope.count { it.optBoolean("archived") }
    val conversations = scope.filter { c ->
        (showLocked || c.optBoolean("archived") == archived) &&
            (filter != "unread" || c.optInt("unread") > 0) && (filter != "groups" || c.optString("kind") == "group") &&
            (activeFolder == null || folderMatches(activeFolder, c)) &&
            (query.isBlank() || c.optString("title").contains(query, true) || c.optString("id") in matches)
    }
    if (newFolder || editingFolder != null) FolderEditor(app, all.filter { it.optString("id") !in locked }, folders, editingFolder) {
        if (editingFolder != null && filter == "folder:${editingFolder!!.optString("id")}") filter = "all"
        newFolder = false; editingFolder = null
    }
    Column(Modifier.fillMaxSize().background(colors.panel)) {
        if (archived) Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { archived = false }) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") }
            Text("Archived", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        SearchField(query, { query = it }, if (channels) "Search channels" else "Search or start a new chat", Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
        if (!archived) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 16.dp, end = 16.dp, bottom = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val options = if (channels) listOf("all" to "All", "unread" to "Unread") else listOf("all" to "All", "unread" to "Unread", "groups" to "Groups")
            options.forEach { (key, label) -> PillChip(label, filter == key && !showLocked) { filter = key; showLocked = false } }
            if (!channels) folders.forEach { f -> PillChip(f.optString("name"), filter == "folder:${f.optString("id")}" && !showLocked, onLongClick = { editingFolder = f }) { filter = "folder:${f.optString("id")}"; showLocked = false } }
            if (!channels) PillChip("", false, Icons.Outlined.Add) { newFolder = true }
            if (locked.isNotEmpty()) PillChip("Locked chats", showLocked, Icons.Outlined.Lock) {
                if (showLocked) showLocked = false else app.locks.authenticate("Show locked chats", "Confirm it’s you") { showLocked = true }
            }
        }
        // LazyColumn anchors its position to the first visible row's key, so a chat that moves to the
        // top (new message, new request) would otherwise appear above the viewport. Like WhatsApp,
        // a list that was showing its top keeps showing it.
        val listState = androidx.compose.foundation.lazy.rememberLazyListState()
        val topKey = conversations.firstOrNull()?.optString("id")
        var wasAtTop by remember { mutableStateOf(true) }
        // Recorded when a user scroll ends; layout shifts from inserted rows do not count as scrolling.
        LaunchedEffect(listState) { snapshotFlow { listState.isScrollInProgress }.collect { scrolling -> if (!scrolling) wasAtTop = listState.firstVisibleItemIndex == 0 && listState.firstVisibleItemScrollOffset == 0 } }
        LaunchedEffect(topKey) { if (wasAtTop) listState.scrollToItem(0) }
        LazyColumn(Modifier.fillMaxSize(), state = listState, contentPadding = PaddingValues(bottom = 88.dp)) {
            if (!archived && !showLocked && archivedCount > 0 && query.isBlank()) item(key = "archived") {
                Row(Modifier.fillMaxWidth().combinedClickable { archived = true }.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Archive, null, tint = colors.accentText) }
                    Text("Archived", Modifier.weight(1f).padding(start = 14.dp), fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    RawText(archivedCount.toString(), color = colors.accentText, style = MaterialTheme.typography.labelMedium)
                }
            }
            items(conversations, key = { it.optString("id") }) { c ->
                ChatRow(app, c) { if (showLocked) app.locks.unlockedChat = c.optString("id"); app.openChat(c.optString("id")) }
            }
            if (conversations.isEmpty()) item {
                when {
                    query.isNotBlank() -> Text("No chats match your search.", Modifier.fillMaxWidth().padding(32.dp), color = colors.textSecondary, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    filter == "unread" -> EmptyState(Icons.Outlined.MarkChatRead, "No unread chats", "You’re all caught up. New unread messages will appear here.")
                    filter == "groups" -> EmptyState(Icons.Outlined.Group, "No groups yet", "Create a group to chat with several people at once.", action = "New group") { app.route = "new-group" }
                    channels -> EmptyState(Icons.Outlined.Campaign, "No channels yet", "Create a channel to share announcements.", action = "New channel") { app.route = "new-channel" }
                    else -> EmptyState(Icons.Outlined.ChatBubbleOutline, "No chats yet", "Start a conversation with someone in your organization.", action = "New chat") { app.route = "new" }
                }
            }
        }
    }
}

/** One conversation row: 52 dp avatar, title + time, prefixed preview + status icons and badge. */
@Composable fun ChatRow(app: MainActivity, c: JSONObject, onOpen: () -> Unit) {
    val colors = LocalConvoColors.current
    var menu by remember { mutableStateOf(false) }
    val unread = c.optInt("unread")
    val title = if (c.optString("kind") == "note") tr("Note to self") else c.optString("title")
    Box {
        Row(Modifier.fillMaxWidth().combinedClickable(onLongClick = { menu = true }, onClick = onOpen).padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically) {
            PersonAvatar(app, c.optString("id"), title, 52, group = c.optString("kind") == "group")
            Column(Modifier.weight(1f).padding(start = 14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RawText(title, Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = colors.textPrimary)
                    RawText(listTime(c.optLong("lastActivity")), Modifier.padding(start = 8.dp), fontSize = 12.sp,
                        color = if (unread > 0) colors.accentText else colors.textSecondary, fontWeight = if (unread > 0) FontWeight.SemiBold else null)
                }
                Row(Modifier.padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    PreviewLine(c, Modifier.weight(1f))
                    val iconMod = Modifier.padding(start = 4.dp).size(17.dp)
                    if (c.optBoolean("muted")) Icon(Icons.Outlined.VolumeOff, "Muted", iconMod, tint = colors.textSecondary)
                    if ((c.optJSONObject("snooze")?.optLong("until") ?: 0L) > System.currentTimeMillis()) Icon(Icons.Outlined.Schedule, "Snoozed", iconMod, tint = colors.textSecondary)
                    if (c.optBoolean("pinned")) Icon(Icons.Outlined.PushPin, "Pinned", iconMod, tint = colors.textSecondary)
                    if (c.optBoolean("request")) Tag("Request")
                    if (c.optBoolean("mentioned") && unread > 0) Box(Modifier.padding(start = 6.dp).size(20.dp).clip(CircleShape).background(colors.badge), contentAlignment = Alignment.Center) { RawText("@", color = colors.badgeText, fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                    if (unread > 0) Box(Modifier.padding(start = 6.dp).defaultMinSize(minWidth = 20.dp).height(20.dp).clip(CircleShape).background(colors.badge).padding(horizontal = 6.dp), contentAlignment = Alignment.Center) {
                        RawText(if (unread > 999) "999+" else unread.toString(), color = colors.badgeText, fontSize = 11.5.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
            IconButton(onClick = { menu = true }, Modifier.size(36.dp)) { Icon(Icons.Outlined.MoreVert, "Chat options", Modifier.size(18.dp), tint = colors.textSecondary) }
        }
        Box(Modifier.align(Alignment.TopEnd).padding(end = 12.dp, top = 40.dp)) {
            DropdownMenu(menu, { menu = false }) { ConversationMenuItems(app, c) { menu = false } }
        }
    }
}

/** "You: …", "Ana: …" in groups, or the draft in accent — as on the web. */
@Composable private fun PreviewLine(c: JSONObject, modifier: Modifier) {
    val colors = LocalConvoColors.current
    val draft = c.optString("draft").takeIf { it.isNotBlank() && it != "null" }
    val preview = c.optString("preview").let { p -> if (p in setOf("📷 Photo", "🎤 Voice message", "📎 File")) tr(p) else p }
    val prefix = when {
        draft != null -> null
        c.optBoolean("previewFromMe") && preview.isNotBlank() -> tr("You") + ": "
        c.optString("previewAuthorName").isNotBlank() && c.optString("previewAuthorName") != "null" -> c.optString("previewAuthorName").substringBefore(' ') + ": "
        else -> ""
    }
    androidx.compose.material3.Text(androidx.compose.ui.text.buildAnnotatedString {
        if (draft != null) {
            pushStyle(androidx.compose.ui.text.SpanStyle(color = colors.accentText, fontWeight = FontWeight.SemiBold)); append(tr("Draft") + ": "); pop(); append(draft)
        } else { append(prefix ?: ""); append(preview) }
    }, modifier, maxLines = 1, overflow = TextOverflow.Ellipsis, fontSize = 14.sp, color = colors.textSecondary)
}

/** WhatsApp list times: "14:05" today, "Yesterday", weekday this week, else the date. */
@Composable fun listTime(at: Long): String {
    if (at <= 0) return ""
    val zone = java.time.ZoneId.systemDefault()
    val day = java.time.Instant.ofEpochMilli(at).atZone(zone)
    val today = java.time.LocalDate.now(zone)
    val locale = java.util.Locale.forLanguageTag(if (Strings.locale == "ro") "ro" else "en")
    return when {
        day.toLocalDate() == today -> day.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))
        day.toLocalDate() == today.minusDays(1) -> tr("Yesterday")
        day.toLocalDate().isAfter(today.minusDays(7)) -> day.format(java.time.format.DateTimeFormatter.ofPattern("EEEE", locale)).replaceFirstChar { it.uppercase() }
        else -> day.format(java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy"))
    }
}

/** Filled pill search field (web `.search`): no outline, leading magnifier, clear button. */
@Composable fun SearchField(value: String, onChange: (String) -> Unit, placeholder: String, modifier: Modifier = Modifier) {
    val colors = LocalConvoColors.current
    Row(modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(22.dp)).background(colors.hover).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Search, null, Modifier.size(20.dp), tint = colors.textSecondary)
        Box(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            if (value.isEmpty()) Text(placeholder, color = colors.textSecondary, fontSize = 15.sp, maxLines = 1)
            BasicTextField(value, onChange, singleLine = true, textStyle = LocalTextStyle.current.copy(color = colors.textPrimary, fontSize = 15.sp),
                cursorBrush = SolidColor(colors.accent), modifier = Modifier.fillMaxWidth())
        }
        if (value.isNotEmpty()) Icon(Icons.Outlined.Close, "Clear", Modifier.size(20.dp).combinedClickable { onChange("") }, tint = colors.textSecondary)
    }
}

/** Filter chip (web `.chip`): pill, tinted when pressed, no outline. */
/** WhatsApp filter pill; [onLongClick] (folders) opens its editor. */
@Composable fun PillChip(label: String, selected: Boolean, icon: androidx.compose.ui.graphics.vector.ImageVector? = null, onLongClick: (() -> Unit)? = null, onClick: () -> Unit) {
    val colors = LocalConvoColors.current
    Row(Modifier.height(32.dp).clip(RoundedCornerShape(16.dp)).background(if (selected) colors.chipActive else colors.chip).combinedClickable(onLongClick = onLongClick, onClick = onClick).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (icon != null) Icon(icon, null, Modifier.size(15.dp), tint = if (selected) colors.chipActiveText else colors.chipText)
        Text(label, color = if (selected) colors.chipActiveText else colors.chipText, fontSize = 14.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium)
    }
}

/** Small role/state tag (web `.role-tag`). */
@Composable fun Tag(label: String) {
    val colors = LocalConvoColors.current
    Box(Modifier.padding(start = 6.dp).clip(RoundedCornerShape(4.dp)).background(colors.chip).padding(horizontal = 6.dp, vertical = 1.dp)) {
        Text(label, color = colors.chipText, fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
    }
}
