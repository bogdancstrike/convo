package com.convo.android.ui.info

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
import com.convo.android.ui.linking.*
import com.convo.android.ui.locks.*
import com.convo.android.ui.media.*
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

@Composable fun ConversationInfo(app: MainActivity) {
    val id = app.active ?: return
    val c = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == id } ?: return
    val isGroup = c.optString("kind") == "group"
    var group by remember(id) { mutableStateOf<JSONObject?>(null) }; var adding by remember { mutableStateOf(false) }
    var roleConfirm by remember { mutableStateOf<Pair<String, String>?>(null) }
    LaunchedEffect(id) { if (isGroup) while (true) { app.call("group", obj("id" to id)) { group = it as? JSONObject }; kotlinx.coroutines.delay(3000) } }
    val members = group?.optJSONArray("members")?.objects().orEmpty()
    var memberQuery by remember(id) { mutableStateOf("") }; var adminsOnly by remember(id) { mutableStateOf(false) }
    var memberNames by remember(id) { mutableStateOf<Map<String, String>>(emptyMap()) }
    LaunchedEffect(id, members.size) { if (id.startsWith("g:")) app.call("memberLabels", obj("id" to id), quiet = true) { v -> memberNames = (v as? org.json.JSONArray)?.objects().orEmpty().associate { it.optString("accountId") to it.optString("label") } } }
    val shownMembers = members.filter { m -> (!adminsOnly || m.optString("role") != "member") &&
        fold(memberNames[m.optString("accountId")] ?: if (m.optString("accountId") == app.snapshot.optString("accountId")) "You" else "").let { name -> fold(memberQuery).split(Regex("\\s+")).filter { it.isNotBlank() }.all { name.contains(it) } } }
    val me = app.snapshot.optString("accountId"); val myRole = members.find { it.optString("accountId") == me }?.optString("role")
    val canManage = myRole in listOf("owner", "admin") && !c.optBoolean("left") && group?.optBoolean("needsJoin") != true
    val colors = LocalConvoColors.current
    val canCall = c.optString("kind") != "note" && !c.optBoolean("left") && !c.optBoolean("adminOnly") && !c.optBoolean("blocked")
    LazyColumn(Modifier.fillMaxSize().background(colors.canvas), contentPadding = PaddingValues(bottom = 24.dp)) {
        // Hero (WhatsApp/web info drawer): photo, name, how to reach them, quick actions.
        item { Column(Modifier.fillMaxWidth().background(colors.panel).padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            PersonAvatar(app, id, c.optString("title"), 120, isGroup, viewable = true)
            Text(if (c.optString("kind") == "note") "Note to self" else c.optString("title"), Modifier.padding(top = 14.dp), fontSize = 24.sp, fontWeight = FontWeight.SemiBold, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            if (isGroup) RawText((if (c.optBoolean("adminOnly")) tr("Channel") else tr("Group")) + " · " + tr("{count} members").replace("{count}", "${members.size}"), Modifier.padding(top = 4.dp), color = colors.textSecondary, fontSize = 15.sp)
            else if (c.optString("kind") == "direct") HeroContact(app, id)
            Row(Modifier.fillMaxWidth().padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (canCall) {
                    QuickAction(Icons.Outlined.Call, "Voice call", Modifier.weight(1f), enabled = app.calls.call == null) { app.calls.start(id, false) }
                    QuickAction(Icons.Outlined.Videocam, "Video call", Modifier.weight(1f), enabled = app.calls.call == null) { app.calls.start(id, true) }
                }
                QuickAction(Icons.Outlined.Search, "Search", Modifier.weight(1f)) { app.threadSearch = true; app.route = "thread" }
            }
        } }
        if (!isGroup) item { InfoSection { ContactDetails(app, id) } }
        item { InfoSection {
            ActionRow("Media, links and docs", icon = Icons.Outlined.PermMedia) { app.route = "media" }
            ActionRow("Starred messages", icon = Icons.Outlined.StarOutline) { app.route = "starred" }
            // Members-only link to this group's call (AC-CALL-07); not for channels.
            if (isGroup && !c.optBoolean("adminOnly") && !c.optBoolean("left")) ActionRow("Share call link", "Only members of this group can join with it", Icons.Outlined.AddIcCall) { app.shareCallLink(id) }
        } }
        item { InfoSection {
            ActionRow(if (c.optBoolean("muted")) "Unmute notifications" else "Mute notifications", icon = if (c.optBoolean("muted")) Icons.Outlined.VolumeOff else Icons.Outlined.NotificationsNone) {
                app.call("conversation", obj("id" to id, "patch" to obj("muted" to !c.optBoolean("muted")))) }
            ActionRow("Chat background", icon = Icons.Outlined.Palette) { app.route = "appearance" }
            // Disappearing messages: any chat; groups and channels need owner/admin.
            val canChange = !c.optBoolean("left") && (!isGroup || myRole in listOf("owner", "admin"))
            Column(Modifier.padding(horizontal = 20.dp, vertical = 10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Timer, null, Modifier.size(24.dp), tint = colors.textSecondary)
                    Column(Modifier.padding(start = 24.dp)) {
                        Text("Disappearing messages", fontSize = 16.sp)
                        Text("New messages disappear from everyone’s devices after the selected time. Sent messages count from sending; received ones from being read.", color = colors.textSecondary, fontSize = 13.sp)
                    }
                }
                Row(Modifier.padding(start = 48.dp, top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    DisappearingTimers.forEach { (seconds, label) -> PillChip(label, c.optLong("expireSeconds") == seconds) { if (canChange) app.call("setDisappearing", obj("id" to id, "seconds" to seconds)) } }
                }
                if (!canChange) Text("Only group admins can change this.", Modifier.padding(start = 48.dp, top = 4.dp), color = colors.textSecondary, fontSize = 13.sp)
            }
            // Per-chat "require authentication", same control as the chat ⋮ menu (all chat types).
            if (app.locks.locked(id) || app.locks.passkey == true) Box(Modifier.padding(horizontal = 8.dp)) {
                PrivacySwitch("Require authentication to open", "Fingerprint, face or screen lock. The chat is hidden from the chat list, search, media and gallery saving until you confirm.",
                    app.locks.locked(id)) { lock -> app.locks.setChatLocked(id, lock) { app.notice = if (lock) "Chat locked" else "Chat unlocked" } }
            }
            if (!isGroup && id != app.snapshot.optString("accountId")) EncryptionRow(app, id)
        } }
        if (isGroup) {
            // About (specs §30.8): E2EE description; owners/admins edit name and description.
            item {
                var editing by remember { mutableStateOf(false) }
                val description = group?.optString("description").orEmpty()
                if (description.isNotBlank() || canManage) Column(Modifier.fillMaxWidth().padding(top = 8.dp).background(colors.panel).padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("About", color = colors.textSecondary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
                    if (description.isNotBlank()) LinkedBody(app, description, emptyList()) else Text("No description yet.", style = MaterialTheme.typography.bodySmall)
                    if (canManage) TextButton(onClick = { editing = true }) { Text("Edit name and description") }
                }
                if (editing) {
                    var name by remember { mutableStateOf(c.optString("title")) }; var text by remember { mutableStateOf(description) }
                    val bytes = text.toByteArray(Charsets.UTF_8).size
                    AlertDialog(onDismissRequest = { editing = false }, title = { Text("Edit name and description") }, text = {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedTextField(name, { name = it.take(128) }, label = { Text("Group name") }, singleLine = true)
                            OutlinedTextField(text, { text = it }, label = { Text("About") }, minLines = 4, maxLines = 10, isError = bytes > 8192)
                            RawText("$bytes / 8192", style = MaterialTheme.typography.bodySmall)
                        }
                    }, confirmButton = { TextButton(enabled = name.isNotBlank() && bytes <= 8192, onClick = { editing = false; app.call("updateGroupInfo", obj("id" to id, "name" to name, "description" to text)) }) { Text("Save") } },
                        dismissButton = { TextButton(onClick = { editing = false }) { Text("Cancel") } })
                }
            }
            item { Spacer(Modifier.height(8.dp).fillMaxWidth()); RawText(tr("{count} participants").replace("{count}", "${members.size}"), Modifier.fillMaxWidth().background(colors.panel).padding(start = 20.dp, top = 14.dp, bottom = 6.dp), color = colors.textSecondary, fontSize = 14.sp, fontWeight = FontWeight.Medium) }
            // Member search (specs §30.8): local roster, case/diacritic-insensitive; Admins includes owners.
            item {
                if (members.size > 1) Column(Modifier.background(colors.panel).padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    SearchField(memberQuery, { memberQuery = it }, "Search members")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PillChip("All", !adminsOnly) { adminsOnly = false }; PillChip("Admins", adminsOnly) { adminsOnly = true }
                    }
                    RawText(tr("{shown} of {total} members").replace("{shown}", "${shownMembers.size}").replace("{total}", "${members.size}"), style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.semantics { liveRegion = androidx.compose.ui.semantics.LiveRegionMode.Polite })
                }
            }
            if (canManage) item { Column(Modifier.background(colors.panel)) { ActionRow("Add participant", icon = Icons.Outlined.PersonAdd) { adding = true } } }
            if (canManage) item { Column(Modifier.fillMaxWidth().background(colors.panel).padding(horizontal = 20.dp, vertical = 8.dp)) { InviteSection(app, id) } }
            if (canManage && !c.optBoolean("adminOnly")) item { SlowModeSection(app, id, c.optJSONObject("memberPolicy")?.optInt("slowModeSeconds") ?: 0) }
            val restricted = c.optJSONObject("memberPolicy")?.optJSONArray("restricted")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
            items(shownMembers, key = { it.optString("accountId") }) { member ->
                val accountId = member.optString("accountId"); var account by remember(accountId) { mutableStateOf<JSONObject?>(null) }; var menu by remember { mutableStateOf(false) }
                LaunchedEffect(accountId) { app.call("account", obj("id" to accountId)) { account = it as? JSONObject } }
                val name = account?.label() ?: "…"; val role = member.optString("role")
                Row(Modifier.fillMaxWidth().background(colors.panel).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    PersonAvatar(app, accountId, name, 44)
                    Column(Modifier.weight(1f).clickable { app.route = "contact:$accountId" }.padding(horizontal = 14.dp)) { Text(if (accountId == me) "You" else name); Text("@${account?.optString("username") ?: "…"}", style = MaterialTheme.typography.bodySmall); if (role != "member") Text(role.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                        else if (accountId in restricted) Text("Restricted", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error) }
                    if (canManage && accountId != me && (role != "owner" || myRole == "owner")) Box {
                        IconButton({ menu = true }) { Icon(Icons.Outlined.MoreVert, "Participant options") }
                        DropdownMenu(menu, { menu = false }) {
                            if (myRole == "owner") {
                                if (role != "owner") DropdownMenuItem(text = { Text(if (role == "admin") "Remove admin role" else "Make admin") }, onClick = { menu = false; app.call("role", obj("id" to id, "member" to accountId, "role" to if (role == "admin") "member" else "admin")) })
                                DropdownMenuItem(text = { Text(if (role == "owner") "Change owner to admin" else "Make owner") }, onClick = { menu = false; roleConfirm = accountId to if (role == "owner") "admin" else "owner" })
                            }
                            if (role == "member" && !c.optBoolean("adminOnly")) DropdownMenuItem(text = { Text(if (accountId in restricted) "Allow sending" else "Restrict from sending") }, onClick = {
                                menu = false; app.call("setMemberPolicy", obj("conversationId" to id, "restricted" to JSONArray(if (accountId in restricted) restricted - accountId else restricted + accountId)))
                            })
                            DropdownMenuItem(text = { Text("Remove", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; roleConfirm = accountId to "remove" })
                            DropdownMenuItem(text = { Text("Remove and ban", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; roleConfirm = accountId to "ban" })
                        }
                    }
                }
            }
        }
        item { InfoSection {
            var export by remember { mutableStateOf(false) }
            ActionRow("Export chat", icon = Icons.Outlined.Download) { export = true }
            if (export) Confirm("Export readable chat?", "The exported file is not encrypted. Save it somewhere private.", "Export", { export = false }) { export = false; val text = app.snapshot.optJSONArray("messages")?.objects().orEmpty().joinToString("\n") { "[${java.util.Date(it.optLong("sentAt"))}] ${it.optString("authorId")}: ${if (it.optBoolean("deleted")) "[deleted]" else it.optString("body")}" }; app.export("convo-chat.txt", "text/plain", text.toByteArray()) }
            ConversationDangerRows(app, c)
        } }
    }
    if (adding) androidx.compose.ui.window.Dialog(onDismissRequest = { adding = false }, properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false)) { Surface(Modifier.fillMaxSize()) { Column { Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Text("Add participant", Modifier.weight(1f).padding(16.dp), style = MaterialTheme.typography.titleLarge); IconButton({ adding = false }) { Icon(Icons.Outlined.Close, "Close") } }; ContactsPicker(app, multi = true, excluded = members.map { it.optString("accountId") }.toSet()) { a -> app.call("addMembers", obj("id" to id, "members" to JSONArray(listOf(a.optString("accountId"))))) { adding = false } } } } }
    roleConfirm?.takeIf { it.second == "ban" }?.let { (member, _) -> Confirm("Remove and ban?", "They cannot ask to join or be added again until unbanned.", "Remove and ban", { roleConfirm = null }) { roleConfirm = null; app.call("banMember", obj("id" to id, "accountId" to member)) } }
    roleConfirm?.takeIf { it.second != "ban" }?.let { (member, role) -> Confirm(if (role == "remove") "Remove participant?" else "Change participant role?", if (role == "owner") "An owner has the same group permissions as you." else "The server will enforce group permissions and keep at least one owner.", "Confirm", { roleConfirm = null }) { roleConfirm = null; app.call(if (role == "remove") "removeMember" else "role", obj("id" to id, "member" to member, "role" to role)) } }
}
@Composable fun ContactInfo(app: MainActivity, id: String) {
    var account by remember(id) { mutableStateOf<JSONObject?>(null) }; var groups by remember(id) { mutableStateOf<List<JSONObject>>(emptyList()) }
    LaunchedEffect(id) {
        app.call("account", obj("id" to id)) { account = it as? JSONObject }
        app.snapshot.optJSONArray("conversations")?.objects().orEmpty().filter { it.optString("kind") == "group" && !it.optBoolean("left") }.forEach { conversation -> app.call("group", obj("id" to conversation.optString("id"))) { value -> val members = (value as? JSONObject)?.optJSONArray("members")?.objects().orEmpty(); if (members.any { it.optString("accountId") == id }) groups = (groups + conversation).distinctBy { it.optString("id") } } }
    }
    val colors = LocalConvoColors.current
    LazyColumn(Modifier.fillMaxSize().background(colors.canvas), contentPadding = PaddingValues(bottom = 24.dp)) {
        item { Column(Modifier.fillMaxWidth().background(colors.panel).padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            PersonAvatar(app, id, account?.label() ?: "…", 120, viewable = true)
            RawText(account?.label() ?: "…", Modifier.padding(top = 14.dp), fontSize = 24.sp, fontWeight = FontWeight.SemiBold)
            LastSeenLabel(app, id)
            Row(Modifier.fillMaxWidth().padding(top = 18.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                QuickAction(Icons.Outlined.ChatBubbleOutline, "Message", Modifier.weight(1f)) { app.call("newChat", obj("id" to id)) { data -> (data as? JSONObject)?.optString("id")?.let(app::openChat) } }
            }
        } }
        item { InfoSection { ContactDetails(app, id); if (id != app.snapshot.optString("accountId")) EncryptionRow(app, id) } }
        if (groups.isNotEmpty()) item { InfoSection(tr("{count} groups in common").replace("{count}", "${groups.size}")) {
            groups.forEach { g -> Row(Modifier.fillMaxWidth().clickable { app.openChat(g.optString("id")); app.route = "info" }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                PersonAvatar(app, g.optString("id"), g.optString("title"), 44, group = true); RawText(g.optString("title"), Modifier.padding(start = 14.dp), fontSize = 16.sp) } }
        } }
    }
}
/** Phone or @handle under the hero name. */
@Composable fun HeroContact(app: MainActivity, id: String) {
    var account by remember(id) { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(id) { app.call("account", obj("id" to id)) { account = it as? JSONObject } }
    account?.let { RawText(it.optString("phone").takeIf { p -> p.isNotBlank() } ?: "@${it.optString("username")}", Modifier.padding(top = 4.dp), color = LocalConvoColors.current.textSecondary, fontSize = 16.sp) }
}

/** About (status), handle and phone rows (web contact drawer). */
@Composable fun ContactDetails(app: MainActivity, id: String) {
    val colors = LocalConvoColors.current
    var account by remember(id) { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(id) { app.call("account", obj("id" to id)) { account = it as? JSONObject } }
    val status = app.snapshot.optJSONObject("profiles")?.optJSONObject(id)?.optString("status")?.takeIf { it.isNotBlank() && it != "null" }
    Column(Modifier.padding(horizontal = 20.dp, vertical = 6.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (status != null) Column { Text("About", color = colors.textSecondary, fontSize = 13.sp); RawText(status, fontSize = 16.sp) }
        account?.let {
            Column { Text("Username", color = colors.textSecondary, fontSize = 13.sp); RawText("@${it.optString("username")}", fontSize = 16.sp) }
            if (it.optString("phone").isNotBlank()) Column { Text("Phone", color = colors.textSecondary, fontSize = 13.sp); RawText(it.optString("phone"), fontSize = 16.sp) }
        }
    }
}

/** "Encryption — compare the safety number" row with its verification dialog. */
@Composable fun EncryptionRow(app: MainActivity, id: String) {
    var fingerprint by remember(id) { mutableStateOf<JSONObject?>(null) }; var showIdentity by remember { mutableStateOf(false) }
    ActionRow("Encryption", "Messages and calls are end-to-end encrypted. Tap to verify.", Icons.Outlined.Lock) { app.call("identity", obj("id" to id)) { fingerprint = it as? JSONObject; showIdentity = true } }
    if (showIdentity) AlertDialog(onDismissRequest = { showIdentity = false }, title = { Text("Verify safety number") }, text = { Text(fingerprint?.optString("digits")?.takeIf { it.isNotBlank() } ?: "Exchange a message with this person first.") }, confirmButton = { TextButton({ app.call("verify", obj("id" to id, "verified" to true)); showIdentity = false }) { Text("Numbers match — verify") } }, dismissButton = { TextButton({ showIdentity = false }) { Text("Close") } })
}
@Composable fun SharedMedia(app: MainActivity) {
    var tab by remember { mutableStateOf("Media") }; var selected by remember { mutableStateOf<Pair<JSONObject, Int>?>(null) }
    val messages = app.snapshot.optJSONArray("messages")?.objects().orEmpty().filter { !it.optBoolean("deleted") }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) { listOf("Media", "Docs", "Links").forEach { label -> FilterChip(tab == label, { tab = label }, label = { Text(label) }) } }
        LazyColumn(contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            items(messages) { message ->
                if (tab == "Links") { if (message.optString("body").contains(Regex("https?://|www\\."))) LinkedBody(app, message.optString("body")) }
                else message.optJSONArray("attachments")?.objects()?.forEachIndexed { index, a ->
                    val type = a.optString("contentType"); val media = type.startsWith("image/") || type.startsWith("video/") || type.startsWith("audio/")
                    if (media == (tab == "Media")) ActionRow(a.optString("fileName", "Attachment"), type, if (type.startsWith("image/")) Icons.Outlined.Image else Icons.Outlined.InsertDriveFile) { selected = message to index }
                }
            }
        }
    }
    selected?.let { (message, index) -> AttachmentDialog(app, message, app.active ?: "", index) { selected = null } }
}

/** Invite link and join requests (owners/admins); approving adds the person via MLS. */
@Composable fun InviteSection(app: MainActivity, id: String) {
    var link by remember(id) { mutableStateOf<String?>(null) }
    var requests by remember(id) { mutableStateOf<List<JSONObject>>(emptyList()) }
    var banned by remember(id) { mutableStateOf<List<JSONObject>>(emptyList()) }
    LaunchedEffect(id) { while (true) {
        app.call("joinRequests", obj("id" to id), quiet = true) { v -> requests = (v as? org.json.JSONArray)?.objects().orEmpty() }
        app.call("groupBans", obj("id" to id), quiet = true) { v -> banned = (v as? org.json.JSONArray)?.objects().orEmpty() }
        kotlinx.coroutines.delay(10_000) } }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Invite link", style = MaterialTheme.typography.titleMedium)
        if (link == null) OutlinedButton({ app.call("createInvite", obj("id" to id)) { v -> link = (v as? JSONObject)?.optString("url") } }) { Text("Create invite link") }
        else {
            RawText(link!!, style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ (app.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText("Convo invite", link)); app.notice = "Copied" }) { Text("Copy text") }
                OutlinedButton({ app.startActivity(android.content.Intent.createChooser(android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain").putExtra(android.content.Intent.EXTRA_TEXT, link), null)) }) { Text("Share") }
            }
        }
        Text("Anyone in your organization with the link can ask to join. Admins approve each request; the link alone does not reveal the group’s name or members.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton({ app.call("revokeInvites", obj("id" to id), success = "Links reset") { link = null } }) { Text("Reset links") }
        if (banned.isNotEmpty()) Text(tr("Banned ({count})").replace("{count}", "${banned.size}"), style = MaterialTheme.typography.titleSmall)
        banned.forEach { r -> Row(verticalAlignment = Alignment.CenterVertically) { RawText(r.optString("label"), Modifier.weight(1f)); TextButton({ app.call("unbanMember", obj("id" to id, "accountId" to r.optString("accountId"))) { banned = banned - r } }) { Text("Unban") } } }
        requests.forEach { r ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                RawText(r.optString("label"), Modifier.weight(1f))
                TextButton({ app.call("addMembers", obj("id" to id, "members" to org.json.JSONArray(listOf(r.optString("accountId"))))) { requests = requests - r } }) { Text("Approve") }
                TextButton({ app.call("declineJoin", obj("id" to id, "accountId" to r.optString("accountId"))) { requests = requests - r } }) { Text("Decline") }
            }
        }
    }
}

/** Case- and diacritic-insensitive search key (Romanian comma/cedilla forms included). */
fun fold(value: String): String = java.text.Normalizer.normalize(value, java.text.Normalizer.Form.NFD).replace(Regex("\\p{Mn}+"), "").lowercase(java.util.Locale.forLanguageTag("ro"))
