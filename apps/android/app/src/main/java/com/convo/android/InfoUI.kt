package com.convo.android

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
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
    val me = app.snapshot.optString("accountId"); val myRole = members.find { it.optString("accountId") == me }?.optString("role")
    val canManage = myRole in listOf("owner", "admin") && !c.optBoolean("left") && group?.optBoolean("needsJoin") != true
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Column(Modifier.fillMaxWidth().padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            PersonAvatar(app, id, c.optString("title"), 104, isGroup)
            Text(if (c.optString("kind") == "note") "Note to self" else c.optString("title"), style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 16.dp))
            if (isGroup) SuggestionChip({}, label = { Text(if (c.optBoolean("adminOnly")) "Channel" else "Group") }, icon = { Icon(if (c.optBoolean("adminOnly")) Icons.Outlined.Campaign else Icons.Outlined.Group, null, Modifier.size(16.dp)) })
        } }
        if (!isGroup) item { ContactDetails(app, id) }
        item { ActionRow("Media, links and docs", icon = Icons.Outlined.PermMedia) { app.route = "media" } }
        item { ActionRow("Starred messages", icon = Icons.Outlined.StarOutline) { app.route = "starred" } }
        item { ActionRow("Chat background", icon = Icons.Outlined.Palette) { app.route = "appearance" } }
        // Disappearing messages: any chat; groups and channels need owner/admin.
        item {
            val canChange = !c.optBoolean("left") && (!isGroup || myRole in listOf("owner", "admin"))
            Column {
                Text("Disappearing messages", style = MaterialTheme.typography.titleMedium)
                Text("New messages disappear from everyone’s devices after the selected time. Sent messages count from sending; received ones from being read.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    DisappearingTimers.forEach { (seconds, label) ->
                        FilterChip(c.optLong("expireSeconds") == seconds, { if (canChange) app.call("setDisappearing", obj("id" to id, "seconds" to seconds)) }, label = { Text(label) }, enabled = canChange)
                    }
                }
                if (!canChange) Text("Only group admins can change this.", style = MaterialTheme.typography.bodySmall)
            }
        }
        // Per-chat "require authentication", same control as the chat ⋮ menu (all chat types).
        if (app.locks.locked(id) || app.locks.passkey == true) item {
            PrivacySwitch("Require authentication to open", "Fingerprint, face or screen lock. The chat is hidden from the chat list, search, media and gallery saving until you confirm.",
                app.locks.locked(id)) { lock -> app.locks.setChatLocked(id, lock) { app.notice = if (lock) "Chat locked" else "Chat unlocked" } }
        }
        item { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) { ConversationQuickMenu(app, c) } }
        item { var export by remember { mutableStateOf(false) }; ActionRow("Export chat", icon = Icons.Outlined.Download) { export = true }; if (export) Confirm("Export readable chat?", "The exported file is not encrypted. Save it somewhere private.", "Export", { export = false }) { export = false; val text = app.snapshot.optJSONArray("messages")?.objects().orEmpty().joinToString("\n") { "[${java.util.Date(it.optLong("sentAt"))}] ${it.optString("authorId")}: ${if (it.optBoolean("deleted")) "[deleted]" else it.optString("body")}" }; app.export("convo-chat.txt", "text/plain", text.toByteArray()) } }
        if (isGroup) {
            item { Text("${members.size} participants", style = MaterialTheme.typography.titleMedium) }
            if (canManage) item { InviteSection(app, id) }
            if (canManage) item { ActionRow("Add participant", icon = Icons.Outlined.PersonAdd) { adding = true } }
            items(members, key = { it.optString("accountId") }) { member ->
                val accountId = member.optString("accountId"); var account by remember(accountId) { mutableStateOf<JSONObject?>(null) }; var menu by remember { mutableStateOf(false) }
                LaunchedEffect(accountId) { app.call("account", obj("id" to accountId)) { account = it as? JSONObject } }
                val name = account?.label() ?: "…"; val role = member.optString("role")
                Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                    PersonAvatar(app, accountId, name, 44)
                    Column(Modifier.weight(1f).clickable { app.route = "contact:$accountId" }.padding(horizontal = 14.dp)) { Text(if (accountId == me) "You" else name); Text("@${account?.optString("username") ?: "…"}", style = MaterialTheme.typography.bodySmall); if (role != "member") Text(role.replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary) }
                    if (canManage && accountId != me && (role != "owner" || myRole == "owner")) Box {
                        IconButton({ menu = true }) { Icon(Icons.Outlined.MoreVert, "Participant options") }
                        DropdownMenu(menu, { menu = false }) {
                            if (myRole == "owner") {
                                if (role != "owner") DropdownMenuItem(text = { Text(if (role == "admin") "Remove admin role" else "Make admin") }, onClick = { menu = false; app.call("role", obj("id" to id, "member" to accountId, "role" to if (role == "admin") "member" else "admin")) })
                                DropdownMenuItem(text = { Text(if (role == "owner") "Change owner to admin" else "Make owner") }, onClick = { menu = false; roleConfirm = accountId to if (role == "owner") "admin" else "owner" })
                            }
                            DropdownMenuItem(text = { Text("Remove", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; roleConfirm = accountId to "remove" })
                            DropdownMenuItem(text = { Text("Remove and ban", color = MaterialTheme.colorScheme.error) }, onClick = { menu = false; roleConfirm = accountId to "ban" })
                        }
                    }
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
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
    LazyColumn(contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        item { Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) { PersonAvatar(app, id, account?.label() ?: "…", 100); Text(account?.label() ?: "…", style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 12.dp)); LastSeenLabel(app, id) } }
        item { ContactDetails(app, id) }
        item { Button({ app.call("newChat", obj("id" to id)) { data -> (data as? JSONObject)?.optString("id")?.let(app::openChat) } }, modifier = Modifier.fillMaxWidth()) { Text("Message") } }
        item { Text("${groups.size} groups in common", style = MaterialTheme.typography.titleMedium) }
        items(groups) { g -> ActionRow(g.optString("title"), icon = if (g.optBoolean("adminOnly")) Icons.Outlined.Campaign else Icons.Outlined.Group) { app.openChat(g.optString("id")); app.route = "info" } }
    }
}
@Composable fun ContactDetails(app: MainActivity, id: String) {
    var account by remember(id) { mutableStateOf<JSONObject?>(null) }; var fingerprint by remember(id) { mutableStateOf<JSONObject?>(null) }; var showIdentity by remember { mutableStateOf(false) }
    LaunchedEffect(id) { app.call("account", obj("id" to id)) { account = it as? JSONObject } }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        account?.let { Text("@${it.optString("username")}"); if (it.optString("phone").isNotBlank()) Text(it.optString("phone")) }
        app.snapshot.optJSONObject("profiles")?.optJSONObject(id)?.optString("status")?.takeIf { it.isNotBlank() }?.let { Text("Status", style = MaterialTheme.typography.labelMedium); Text(it) }
        if (id != app.snapshot.optString("accountId")) ActionRow("Encryption", "Compare the safety number with your contact", Icons.Outlined.Lock) { app.call("identity", obj("id" to id)) { fingerprint = it as? JSONObject; showIdentity = true } }
    }
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
