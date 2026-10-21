package com.convo.android

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Campaign
import androidx.compose.material.icons.outlined.Link
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
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
            ListItem(headlineContent = { Text("New community") }, leadingContent = { Icon(Icons.Outlined.Add, null) },
                modifier = Modifier.clickable { app.route = "new-community" }.testTag("new-community"))
        }
        items(communities.orEmpty(), key = { it.optString("communityId") }) { c ->
            ListItem(headlineContent = { RawText(c.optString("name").ifBlank { tr("Community") }) },
                supportingContent = { RawText(c.optString("description").ifBlank { tr(roleLabel(c.optString("role"))) }, maxLines = 1) },
                leadingContent = { PersonAvatar(app, c.optString("conversationId"), c.optString("name").ifBlank { "?" }, 44, group = true) },
                modifier = Modifier.clickable { app.route = "community:${c.optString("communityId")}" })
        }
        if (communities?.isEmpty() == true) item {
            Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("No communities yet", style = MaterialTheme.typography.titleMedium)
                Text("A community brings announcements and related groups together. Create one, or ask an admin for an invite link.", style = MaterialTheme.typography.bodyMedium)
            }
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
    var requested by remember(communityId) { mutableStateOf(setOf<String>()) }
    var adding by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    LaunchedEffect(communityId, app.snapshot, refresh) {
        app.call("communities", quiet = true) { v -> community = (v as? JSONArray)?.objects()?.find { it.optString("communityId") == communityId } }
        app.call("communityGroups", obj("id" to communityId), quiet = true) { v -> groups = (v as? JSONArray)?.objects().orEmpty() }
    }
    val c = community ?: run { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }; return }
    val manager = c.optString("role") in listOf("owner", "admin")
    val conversations = app.snapshot.optJSONArray("conversations")?.objects().orEmpty()
    fun ready(id: String) = conversations.any { it.optString("id") == id }
    fun act(method: String, groupId: String) = app.call(method, obj("id" to communityId, "groupId" to groupId)) { refresh++ }
    LazyColumn(Modifier.fillMaxSize()) {
        item {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                RawText(c.optString("name").ifBlank { tr("Community") }, style = MaterialTheme.typography.headlineSmall)
                if (c.optString("description").isNotBlank()) RawText(c.optString("description"), style = MaterialTheme.typography.bodyMedium)
            }
            val root = c.optString("conversationId")
            ListItem(headlineContent = { Text("Announcements") }, supportingContent = { Text(if (manager) "Post updates to everyone in the community" else "Updates from the community admins") },
                leadingContent = { Icon(Icons.Outlined.Campaign, null) },
                modifier = Modifier.clickable(enabled = ready(root)) { app.openChatFrom(root) }.testTag("community-announcements"))
            if (manager) ListItem(headlineContent = { Text("Invite members") }, supportingContent = { Text("Share the announcements’ invite link; you approve each request.") },
                leadingContent = { Icon(Icons.Outlined.Link, null) }, modifier = Modifier.clickable(enabled = ready(root)) { app.openChatFrom(root); app.route = "info" })
            Text("Groups in this community", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp))
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
            ListItem(headlineContent = { RawText(g.optString("name").ifBlank { tr("Private group") }) }, supportingContent = { Text(status) },
                leadingContent = { PersonAvatar(app, conversation, g.optString("name").ifBlank { "?" }, 40, group = true) },
                trailingContent = {
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        if (g.optBoolean("canAccept")) Button(onClick = { act("acceptCommunityLink", groupId) }) { Text("Accept") }
                        if (g.optString("status") == "active" && !g.optBoolean("member") && g.optString("visibility") == "discoverable") {
                            if (groupId in requested) Text("Request sent", style = MaterialTheme.typography.bodySmall)
                            else Button(onClick = { app.call("requestCommunityGroup", obj("id" to communityId, "groupId" to groupId)) { requested = requested + groupId } }) { Text("Ask to join") }
                        }
                        if (manager || g.optBoolean("canAccept")) TextButton(onClick = { act("unlinkCommunityGroup", groupId) }) { Text("Remove") }
                    }
                },
                modifier = Modifier.clickable(enabled = open) { app.openChatFrom(conversation) })
        }
        if (groups?.isEmpty() == true) item { Text(if (manager) "No groups yet. Add a group you’re in." else "No groups to show yet.", Modifier.padding(16.dp), style = MaterialTheme.typography.bodyMedium) }
        if (manager) item {
            TextButton(onClick = { adding = true }, modifier = Modifier.padding(8.dp)) { Icon(Icons.Outlined.Add, null); Spacer(Modifier.width(6.dp)); Text("Add a group") }
        }
    }
    if (adding) {
        val linked = groups.orEmpty().map { it.optString("conversationId") }.toSet()
        val candidates = conversations.filter { it.optString("kind") == "group" && !it.optBoolean("left") && it.optString("id") != c.optString("conversationId") && it.optString("id") !in linked }
        var visibility by remember { mutableStateOf("discoverable") }
        AlertDialog(onDismissRequest = { adding = false }, title = { Text("Add a group") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("discoverable" to "Community members can see it and ask to join", "private" to "Hidden; members join by invitation").forEach { (value, label) ->
                    Row(Modifier.fillMaxWidth().selectable(visibility == value) { visibility = value }, verticalAlignment = Alignment.CenterVertically) { RadioButton(visibility == value, { visibility = value }); Text(label) }
                }
                HorizontalDivider()
                if (candidates.isEmpty()) Text("You’re not in any other groups that can be added.")
                candidates.forEach { conv ->
                    ListItem(headlineContent = { RawText(conv.optString("title")) }, modifier = Modifier.clickable {
                        adding = false
                        app.call("linkCommunityGroup", obj("id" to communityId, "conversationId" to conv.optString("id"), "visibility" to visibility)) { refresh++ }
                    })
                }
            }
        }, confirmButton = { TextButton(onClick = { adding = false }) { Text("Cancel") } })
    }
}
