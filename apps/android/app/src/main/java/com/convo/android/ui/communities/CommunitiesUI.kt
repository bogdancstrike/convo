package com.convo.android.ui.communities

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.calls.*
import com.convo.android.i18n.*
import com.convo.android.push.*
import com.convo.android.ui.chats.*
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import org.json.JSONArray
import org.json.JSONObject

/**
 * Communities (COM-01/02), same model as the web client: an announcement channel plus linked
 * groups. Joining a group from a community files a normal join request that its admins approve.
 * Names and descriptions are end-to-end encrypted in the groups' metadata.
 */
@Composable fun CommunitiesTab(app: MainActivity) {
    var communities by remember { mutableStateOf<List<JSONObject>?>(null) }
    LaunchedEffect(app.snapshot) { app.call("communities", quiet = true) { v -> communities = (v as? JSONArray)?.objects().orEmpty() } }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            val colors = LocalConvoColors.current
            // WhatsApp: "New community" with a rounded-square community tile.
            Row(Modifier.fillMaxWidth().clickable { app.route = "new-community" }.testTag("new-community").padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(colors.chip), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.Groups, null, Modifier.size(30.dp), tint = colors.textSecondary)
                    Box(Modifier.align(Alignment.BottomEnd).size(20.dp).clip(CircleShape).background(colors.actionFill), contentAlignment = Alignment.Center) { Icon(Icons.Outlined.Add, null, Modifier.size(14.dp), tint = colors.actionText) }
                }
                Text("New community", Modifier.padding(start = 14.dp), fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
            HorizontalDivider(thickness = 8.dp, color = colors.canvas)
        }
        items(communities.orEmpty(), key = { it.optString("communityId") }) { c ->
            Row(Modifier.fillMaxWidth().clickable { app.route = "community:${c.optString("communityId")}" }.padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp))) { PersonAvatar(app, c.optString("conversationId"), c.optString("name").ifBlank { "?" }, 52, group = true) }
                Column(Modifier.weight(1f).padding(start = 14.dp)) {
                    RawText(c.optString("name").ifBlank { tr("Community") }, maxLines = 1, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    RawText(c.optString("description").ifBlank { tr(roleLabel(c.optString("role"))) }, maxLines = 1, fontSize = 14.sp, color = LocalConvoColors.current.textSecondary)
                }
            }
        }
        if (communities?.isEmpty() == true) item {
            EmptyState(Icons.Outlined.Groups, "No communities yet", "A community brings announcements and related groups together. Create one, or ask an admin for an invite link.")
        }
    }
}

private fun roleLabel(role: String) = when (role) { "owner" -> "You own this community"; "admin" -> "You are an admin"; else -> "Member" }

@Composable fun NewCommunity(app: MainActivity) {
    var name by remember { mutableStateOf("") }; var description by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        OutlinedTextField(name, { name = it.filter { ch -> !ch.isISOControl() }.take(128) }, label = { Text("Community name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(description, { description = it.take(1000) }, label = { Text("Description") }, minLines = 3, modifier = Modifier.fillMaxWidth())
        Text("Creates an announcement channel where only admins post. Members join with an invite link you approve. The name and description are end-to-end encrypted.", style = MaterialTheme.typography.bodySmall)
        Button(onClick = {
            busy = true
            app.call("createCommunity", obj("name" to name.trim(), "description" to description.trim())) { v -> busy = false; (v as? JSONObject)?.optString("communityId")?.let { app.route = "community:$it" } }
        }, enabled = name.isNotBlank() && !busy, modifier = Modifier.fillMaxWidth()) { Text("Create community") }
    }
}

@Composable fun CommunityDetail(app: MainActivity, communityId: String) {
    var community by remember(communityId) { mutableStateOf<JSONObject?>(null) }
    var groups by remember(communityId) { mutableStateOf<List<JSONObject>?>(null) }
    var onboarding by remember(communityId) { mutableStateOf<JSONObject?>(null) }
    var requested by remember(communityId) { mutableStateOf(setOf<String>()) }
    var adding by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var operations by remember(communityId) { mutableStateOf<List<JSONObject>>(emptyList()) }
    LaunchedEffect(communityId, app.snapshot, refresh) {
        app.call("communities", quiet = true) { v -> community = (v as? JSONArray)?.objects()?.find { it.optString("communityId") == communityId } }
        app.call("communityGroups", obj("id" to communityId), quiet = true) { v -> groups = (v as? JSONArray)?.objects().orEmpty() }
        app.call("onboarding", obj("id" to communityId), quiet = true) { v -> onboarding = v as? JSONObject }
        // Managers: membership changes still being applied to linked secure groups (or blocked).
        app.call("communityOperations", obj("id" to communityId), quiet = true) { v -> operations = (v as? JSONArray)?.objects().orEmpty() }
    }
    val c = community ?: run { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return }
    val manager = c.optString("role") in listOf("owner", "admin")
    val conversations = app.snapshot.optJSONArray("conversations")?.objects().orEmpty()
    fun ready(id: String) = conversations.any { it.optString("id") == id }
    fun act(method: String, groupId: String, delegation: Boolean = false) = app.call(method, obj("id" to communityId, "groupId" to groupId, "delegation" to delegation)) { refresh++ }
    val follow = remember(communityId) { mutableStateMapOf<String, Boolean>() }
    LazyColumn(Modifier.fillMaxSize()) {
        val open = if (manager) operations.filter { it.optString("status") != "completed" } else emptyList()
        if (open.isNotEmpty()) item {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text("Membership updates", style = MaterialTheme.typography.titleSmall)
                open.forEach { o ->
                    val group = groups.orEmpty().find { it.optString("groupId") == o.optString("groupId") }?.optString("name")?.takeIf { it.isNotBlank() } ?: tr("Private group")
                    RawText(tr(if (o.optString("status") == "pending") "Removing {name} from {group} — updating secure group" else "{name} owns {group}: transfer ownership to remove them there")
                        .replace("{name}", o.optString("name")).replace("{group}", group), style = MaterialTheme.typography.bodySmall)
                }
                if (open.any { it.optString("status") == "blocked" }) {
                    Text("A removed person still owns a linked group. Ask them (or that group’s owners) to make someone else owner, then retry; it also retries automatically when ownership changes.", style = MaterialTheme.typography.bodySmall)
                    OutlinedButton({ app.call("retryCommunityOperations", obj("id" to communityId)) { refresh++ } }) { Text("Retry blocked removals") }
                }
            }
        }
        item {
            val active = groups.orEmpty().filter { it.optString("status") == "active" }
            Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.Top) {
                PersonAvatar(app, c.optString("conversationId"), c.optString("name").ifBlank { "?" }, 64, group = true)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    RawText(c.optString("name").ifBlank { tr("Community") }, style = MaterialTheme.typography.headlineSmall)
                    RawText(tr("{groups} groups · you’re in {joined}").replace("{groups}", "${active.size}").replace("{joined}", "${active.count { it.optBoolean("member") }}"),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (c.optString("description").isNotBlank()) RawText(c.optString("description"), style = MaterialTheme.typography.bodyMedium)
                }
            }
            onboarding?.let { view -> WelcomeCard(app, communityId, JSONObject(view.toString()).put("communityName", c.optString("name")), groups.orEmpty(), { refresh++ }) { gid ->
                app.call("requestCommunityGroup", obj("id" to communityId, "groupId" to gid)) { requested = requested + gid } } }
            val root = c.optString("conversationId")
            ListItem(headlineContent = { Text("Announcements") }, supportingContent = { Text(if (manager) "Post updates to everyone in the community" else "Updates from the community admins") },
                leadingContent = { Icon(Icons.Outlined.Campaign, null) },
                modifier = Modifier.clickable(enabled = ready(root)) { app.openChatFrom(root) }.testTag("community-announcements"))
            if (manager) ListItem(headlineContent = { Text("Welcome & rules") }, supportingContent = { Text("What new members see first; encrypted for members only") },
                leadingContent = { Icon(Icons.Outlined.Campaign, null) }, modifier = Modifier.clickable { app.route = "community-onboarding:$communityId" })
            if (manager) ListItem(headlineContent = { Text("Invite members") }, supportingContent = { Text("Share the announcements’ invite link; you approve each request.") },
                leadingContent = { Icon(Icons.Outlined.Link, null) }, modifier = Modifier.clickable(enabled = ready(root)) { app.openChatFrom(root); app.route = "info" })
            Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp, top = 12.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Groups in this community", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                if (manager) {
                    Button(onClick = { creating = true }, modifier = Modifier.testTag("community-new-group")) { Icon(Icons.Outlined.Add, null); Spacer(Modifier.width(4.dp)); Text("New group") }
                    TextButton(onClick = { adding = true }) { Text("Add existing") }
                }
            }
        }
        items(groups.orEmpty(), key = { it.optString("groupId") }) { g ->
            val groupId = g.optString("groupId"); val conversation = g.optString("conversationId")
            val open = g.optBoolean("member") && ready(conversation)
            val status = when {
                g.optString("status") == "proposed" -> if (g.optBoolean("canAccept")) "Asked to join this community — you own this group" else "Waiting for the group owner to accept"
                open -> "You’re a member"
                g.optBoolean("member") -> "Joining securely…"
                g.optString("visibility") == "private" -> "Private — invited members only"
                else -> "Anyone in the community can ask to join"
            }
            ListItem(headlineContent = { RawText(g.optString("name").ifBlank { tr("Private group") }) },
                supportingContent = { Column { Text(status); if (g.optString("status") == "active" && g.optBoolean("delegation")) Text("Follows community removals", style = MaterialTheme.typography.bodySmall)
                    if (g.optBoolean("canAccept")) Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(follow[groupId] ?: true, { follow[groupId] = it }); Text("Remove people here when they leave the community", style = MaterialTheme.typography.bodySmall) } } },
                leadingContent = { PersonAvatar(app, conversation, g.optString("name").ifBlank { "?" }, 40, group = true) },
                trailingContent = {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (g.optBoolean("canAccept")) Button(onClick = { act("acceptCommunityLink", groupId, follow[groupId] ?: true) }) { Text("Accept") }
                        if (g.optString("status") == "active" && !g.optBoolean("member") && g.optString("visibility") == "discoverable") {
                            if (groupId in requested) Text("Request sent", style = MaterialTheme.typography.bodySmall)
                            else Button(onClick = { app.call("requestCommunityGroup", obj("id" to communityId, "groupId" to groupId)) { requested = requested + groupId } }) { Text("Ask to join") }
                        }
                        if (manager || g.optBoolean("canAccept")) TextButton(onClick = { act("unlinkCommunityGroup", groupId) }) { Text("Remove") }
                    }
                },
                modifier = Modifier.clickable(enabled = open) { app.openChatFrom(conversation) })
        }
        if (groups?.isEmpty() == true) item { Text(if (manager) "No groups yet. Create one for a team or topic, or add a group you’re already in." else "No groups to show yet.", Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium) }
    }
    if (creating) NewCommunityGroupDialog(app, communityId, onDismiss = { creating = false }) { conversationId -> creating = false; refresh++; app.openChatFrom(conversationId) }
    if (adding) {
        val linked = groups.orEmpty().map { it.optString("conversationId") }.toSet()
        val candidates = conversations.filter { it.optString("kind") == "group" && !it.optBoolean("left") && it.optString("id") != c.optString("conversationId") && it.optString("id") !in linked }
        var visibility by remember { mutableStateOf("discoverable") }
        var delegation by remember { mutableStateOf(true) }
        AlertDialog(onDismissRequest = { adding = false }, title = { Text("Add a group") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("discoverable" to "Community members can see it and ask to join", "private" to "Hidden; members join by invitation").forEach { (value, label) ->
                    Row(Modifier.fillMaxWidth().selectable(visibility == value) { visibility = value }, verticalAlignment = Alignment.CenterVertically) { RadioButton(visibility == value, { visibility = value }); Text(label) }
                }
                Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(delegation, { delegation = it }); Text("Also remove people from the group when they leave the community (groups you own)", style = MaterialTheme.typography.bodySmall) }
                HorizontalDivider()
                if (candidates.isEmpty()) Text("You’re not in any other groups that can be added.")
                candidates.forEach { conv ->
                    ListItem(headlineContent = { RawText(conv.optString("title")) }, modifier = Modifier.clickable {
                        adding = false
                        app.call("linkCommunityGroup", obj("id" to communityId, "conversationId" to conv.optString("id"), "visibility" to visibility, "delegation" to delegation)) { refresh++ }
                    })
                }
            }
        }, confirmButton = { TextButton(onClick = { adding = false }) { Text("Cancel") } })
    }
}

/**
 * Creates a group inside the community (WhatsApp-style): name, optional description, people from
 * the community, who can find it. Linked at once because the creator owns both.
 */
@Composable fun NewCommunityGroupDialog(app: MainActivity, communityId: String, onDismiss: () -> Unit, onCreated: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    var description by remember { mutableStateOf("") }
    var visibility by remember { mutableStateOf("discoverable") }
    var delegation by remember { mutableStateOf(true) }
    var members by remember { mutableStateOf<List<JSONObject>?>(null) }
    val picked = remember { mutableStateListOf<String>() }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(communityId) { app.call("communityMembers", obj("id" to communityId), quiet = true) { v -> members = (v as? JSONArray)?.objects().orEmpty() } }
    AlertDialog(onDismissRequest = onDismiss, title = { Text("New group in this community") }, text = {
        LazyColumn(verticalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.heightIn(max = 520.dp)) {
            item { OutlinedTextField(name, { name = it.take(128) }, label = { Text("Group name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("community-group-name")) }
            item { OutlinedTextField(description, { description = it.take(2000) }, label = { Text("Description (optional)") }, maxLines = 3, modifier = Modifier.fillMaxWidth()) }
            item { RawText(tr("Add people from the community ({count} selected)").replace("{count}", "${picked.size}"), style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp)) }
            if (members?.isEmpty() == true) item { Text("No other members yet. Invite people to the community first; they can ask to join the group later.", style = MaterialTheme.typography.bodySmall) }
            items(members.orEmpty(), key = { it.optString("accountId") }) { m ->
                val id = m.optString("accountId")
                Row(Modifier.fillMaxWidth().clickable { if (id in picked) picked.remove(id) else picked.add(id) }, verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(id in picked, { if (it) picked.add(id) else picked.remove(id) })
                    PersonAvatar(app, id, m.optString("name"), 28); Spacer(Modifier.width(8.dp)); RawText(m.optString("name"))
                }
            }
            item { Text("Who can find it", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(top = 8.dp)) }
            items(listOf("discoverable" to "Visible in the community — members can see it and ask to join", "private" to "Hidden — members join by invitation")) { (value, label) ->
                Row(Modifier.fillMaxWidth().selectable(visibility == value) { visibility = value }, verticalAlignment = Alignment.CenterVertically) { RadioButton(visibility == value, { visibility = value }); Text(label, style = MaterialTheme.typography.bodySmall) }
            }
            item { Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(delegation, { delegation = it }); Text("Also remove people from this group when they leave the community", style = MaterialTheme.typography.bodySmall) } }
        }
    }, confirmButton = {
        Button(enabled = !busy && name.isNotBlank(), onClick = {
            busy = true
            app.call("createCommunityGroup", obj("id" to communityId, "name" to name.trim(), "description" to description.trim(), "memberIds" to JSONArray(picked.toList()),
                "visibility" to visibility, "delegation" to delegation)) { v -> busy = false; (v as? JSONObject)?.optString("id")?.takeIf { it.isNotBlank() }?.let(onCreated) }
        }, modifier = Modifier.testTag("community-create-group-submit")) { Text(if (busy) "Creating…" else "Create group") }
    }, dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } })
}

/** Standard checklist item labels (stable IDs shared with the web client). */
internal val presetItems = mapOf("read-description" to "Read the community description", "ack-rules" to "Acknowledge the rules",
    "choose-groups" to "Choose discussion groups", "notifications" to "Set notification preferences")

/**
 * Newcomer welcome (specs §30.7) on Android: welcome text, versioned rules with an explicit
 * acknowledgement to the named reviewers, recommended groups (ask to join) and a private
 * checklist synced only to own devices. Completion grants nothing.
 */
@Composable fun WelcomeCard(app: MainActivity, communityId: String, view: JSONObject, groups: List<JSONObject>, onChanged: () -> Unit, onAskToJoin: (String) -> Unit) {
    val pkg = view.optJSONObject("pkg") ?: return
    val progress = view.optJSONObject("progress")
    val reviewer = view.optBoolean("reviewer")
    val rules = pkg.optJSONObject("rules")
    val rulesVersion = rules?.optInt("version") ?: 0
    val acked = progress?.optJSONObject("rulesAck")
    val rulesCurrent = rules != null && acked?.optInt("version") == rulesVersion
    val needsRules = rules?.optBoolean("ackRequired") == true && !rulesCurrent && !reviewer
    val outdated = needsRules && acked != null
    val ticks = remember(communityId) { mutableStateMapOf<String, Boolean>() }
    fun done(id: String) = ticks[id] ?: if (id == "ack-rules") reviewer || rulesCurrent else progress?.optJSONObject("items")?.optJSONObject(id)?.optBoolean("done") == true
    val checklist = pkg.optJSONArray("checklist")?.objects().orEmpty()
    val complete = checklist.filter { it.optBoolean("required") && (it.optString("id") != "ack-rules" || rules?.optBoolean("ackRequired") == true) }.all { done(it.optString("id")) }
    var expanded by remember(communityId) { mutableStateOf(false) }
    if (complete && !needsRules && !expanded) {
        TextButton(onClick = { expanded = true }, modifier = Modifier.padding(horizontal = 8.dp)) { Text("You’re all set · show welcome") }
        return
    }
    Card(Modifier.fillMaxWidth().padding(12.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            RawText(tr("Welcome to {name}").replace("{name}", view.optString("communityName").ifBlank { tr("Community") }), style = MaterialTheme.typography.titleMedium)
            if (pkg.optString("welcome").isNotBlank()) RawText(pkg.optString("welcome"))
            if (outdated) Text("Updated rules — review and acknowledge", color = MaterialTheme.colorScheme.primary)
            if (rules != null) {
                RawText(tr("Community rules (version {version})").replace("{version}", "$rulesVersion"), style = MaterialTheme.typography.titleSmall)
                RawText(rules.optString("text"))
                if (rules.optBoolean("ackRequired")) when {
                    reviewer -> Text("You receive members’ rules acknowledgements.", style = MaterialTheme.typography.bodySmall)
                    rulesCurrent -> RawText(tr("You acknowledged rules version {version}").replace("{version}", "$rulesVersion"))
                    else -> Button(onClick = { app.call("acknowledgeRules", obj("id" to communityId)) { onChanged() } }) { RawText(tr("I acknowledge the rules (version {version})").replace("{version}", "$rulesVersion")) }
                }
            }
            val recommended = pkg.optJSONArray("recommended")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
                .mapNotNull { id -> groups.find { it.optString("groupId") == id && it.optString("status") == "active" && it.optString("visibility") == "discoverable" } }
            if (recommended.isNotEmpty()) {
                Text("Recommended groups", style = MaterialTheme.typography.titleSmall)
                recommended.forEach { g ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        RawText(g.optString("name").ifBlank { tr("Private group") })
                        if (g.optBoolean("member")) Text("You’re a member", style = MaterialTheme.typography.bodySmall) else TextButton(onClick = { onAskToJoin(g.optString("groupId")) }) { Text("Ask to join") }
                    }
                }
            }
            if (checklist.isNotEmpty()) {
                Text("Getting started", style = MaterialTheme.typography.titleSmall)
                checklist.forEach { item ->
                    val id = item.optString("id")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(done(id), { value -> ticks[id] = value; app.call("setChecklistItem", obj("id" to communityId, "itemId" to id, "done" to value), quiet = true) }, enabled = id != "ack-rules")
                        RawText(presetItems[id]?.let { tr(it) } ?: item.optString("label"), Modifier.weight(1f))
                        Text(if (item.optBoolean("required")) "Required" else "Optional", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
            Text("Your checklist progress stays on your devices; admins can’t see it.", style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { expanded = false; ticks.clear(); onChanged() }) { Text("Continue later") }
        }
    }
}

/** Admin editor for the onboarding package (Android parity with the web editor). */
@Composable fun OnboardingEditor(app: MainActivity, communityId: String) {
    var view by remember(communityId) { mutableStateOf<JSONObject?>(null) }
    var groups by remember(communityId) { mutableStateOf<List<JSONObject>>(emptyList()) }
    var loaded by remember(communityId) { mutableStateOf(false) }
    var welcome by remember(communityId) { mutableStateOf("") }; var rules by remember(communityId) { mutableStateOf("") }
    var ackRequired by remember(communityId) { mutableStateOf(false) }
    val recommended = remember(communityId) { mutableStateListOf<String>() }
    val checklist = remember(communityId) { mutableStateListOf<JSONObject>() }
    var custom by remember { mutableStateOf("") }; var busy by remember { mutableStateOf(false) }
    LaunchedEffect(communityId) {
        app.call("communityGroups", obj("id" to communityId), quiet = true) { v -> groups = (v as? JSONArray)?.objects().orEmpty() }
        app.call("onboarding", obj("id" to communityId), quiet = true) { v ->
            val pkg = (v as? JSONObject)?.optJSONObject("pkg"); view = v as? JSONObject
            welcome = pkg?.optString("welcome").orEmpty(); rules = pkg?.optJSONObject("rules")?.optString("text").orEmpty()
            ackRequired = pkg?.optJSONObject("rules")?.optBoolean("ackRequired") == true
            pkg?.optJSONArray("recommended")?.let { a -> (0 until a.length()).forEach { recommended.add(a.optString(it)) } }
            val items = pkg?.optJSONArray("checklist")?.objects()
            if (items != null) checklist.addAll(items) else listOf("read-description" to true, "ack-rules" to true, "choose-groups" to false)
                .forEach { (id, required) -> checklist.add(JSONObject().put("id", id).put("label", tr(presetItems.getValue(id))).put("required", required)) }
            loaded = true
        }
    }
    if (!loaded) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { OutlinedTextField(welcome, { welcome = it.take(4000) }, label = { Text("Welcome message") }, minLines = 3, modifier = Modifier.fillMaxWidth().padding(top = 12.dp)) }
        item { OutlinedTextField(rules, { rules = it.take(8000) }, label = { Text("Community rules") }, minLines = 4, modifier = Modifier.fillMaxWidth()) }
        item { Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(ackRequired, { ackRequired = it }); Text("Ask members to acknowledge the rules") } }
        view?.let { v -> val r = v.optJSONObject("pkg")?.optJSONObject("rules")
            if (v.optBoolean("reviewer") && r?.optBoolean("ackRequired") == true) item {
                RawText(tr("Rules version {version}: acknowledged by {done} of {total}").replace("{version}", "${r.optInt("version")}")
                    .replace("{done}", "${v.optJSONArray("rulesAcknowledged")?.length() ?: 0}").replace("{total}", "${v.optJSONArray("audience")?.length() ?: 0}"), style = MaterialTheme.typography.bodySmall)
            } }
        val discoverable = groups.filter { it.optString("status") == "active" && it.optString("visibility") == "discoverable" }
        if (discoverable.isNotEmpty()) {
            item { Text("Recommended groups", style = MaterialTheme.typography.titleSmall) }
            items(discoverable, key = { "rec-" + it.optString("groupId") }) { g -> val id = g.optString("groupId")
                Row(verticalAlignment = Alignment.CenterVertically) { Checkbox(id in recommended, { if (it) recommended.add(id) else recommended.remove(id) }); RawText(g.optString("name").ifBlank { tr("Private group") }) } }
        }
        item { Text("Getting started", style = MaterialTheme.typography.titleSmall) }
        items(presetItems.keys.toList(), key = { "preset-$it" }) { id ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checklist.any { it.optString("id") == id }, { on -> if (on) checklist.add(JSONObject().put("id", id).put("label", tr(presetItems.getValue(id))).put("required", false)) else checklist.removeAll { it.optString("id") == id } })
                Text(presetItems.getValue(id))
            }
        }
        items(checklist.toList(), key = { "req-" + it.optString("id") }) { item ->
            Row(verticalAlignment = Alignment.CenterVertically) {
                Switch(item.optBoolean("required"), { on -> val i = checklist.indexOfFirst { it.optString("id") == item.optString("id") }; if (i >= 0) checklist[i] = JSONObject(item.toString()).put("required", on) })
                Spacer(Modifier.width(8.dp)); RawText(tr("Required: {item}").replace("{item}", item.optString("label")), Modifier.weight(1f))
                if (item.optString("id") !in presetItems) TextButton(onClick = { checklist.removeAll { it.optString("id") == item.optString("id") } }) { Text("Remove") }
            }
        }
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(custom, { custom = it.take(120) }, label = { Text("Add your own checklist item") }, singleLine = true, modifier = Modifier.weight(1f))
                TextButton(enabled = custom.isNotBlank() && checklist.size < 20, onClick = { checklist.add(JSONObject().put("id", "c-" + java.util.UUID.randomUUID().toString().take(8)).put("label", custom.trim()).put("required", false)); custom = "" }) { Text("Add") }
            }
        }
        item {
            Button(enabled = !busy, modifier = Modifier.fillMaxWidth().padding(bottom = 24.dp), onClick = {
                busy = true
                app.call("saveOnboarding", obj("id" to communityId, "welcome" to welcome, "rules" to rules, "ackRequired" to (ackRequired && rules.isNotBlank()),
                    "recommended" to JSONArray(recommended.toList()), "checklist" to JSONArray(checklist.map { JSONObject(it.toString()) }))) { busy = false; if (it != null) app.route = "community:$communityId" }
            }) { Text("Save") }
        }
    }
}
