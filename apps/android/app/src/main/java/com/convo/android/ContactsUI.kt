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

@Composable fun ContactsPicker(app: MainActivity, multi: Boolean = false, selected: Set<String> = emptySet(), excluded: Set<String> = emptySet(), onPick: (JSONObject) -> Unit) {
    var query by remember { mutableStateOf("") }; var results by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var recent by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    LaunchedEffect(Unit) {
        val contacts = app.snapshot.optJSONArray("conversations")?.objects().orEmpty().filter { it.optString("kind") == "direct" }
        contacts.forEach { c -> app.call("account", obj("id" to c.optString("id"))) { a -> (a as? JSONObject)?.let { recent = recent + it } } }
    }
    LaunchedEffect(query) {
        results = emptyList()
        if (query.isNotBlank()) { kotlinx.coroutines.delay(200); val requested = query; app.call("directory", obj("query" to query)) { data -> if (requested == query) results = (data as? JSONArray)?.objects().orEmpty() } }
    }
    val choices = (if (query.isBlank()) (app.phoneMatches + recent).distinctBy { it.optString("accountId") } else (results + app.phoneMatches.filter { it.optString("localName").contains(query, true) }).distinctBy { it.optString("accountId") })
        .filter { it.optString("accountId") !in excluded && it.optString("accountId") != app.snapshot.optString("accountId") }
    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(query, { query = it }, singleLine = true, modifier = Modifier.fillMaxWidth().padding(12.dp), label = { Text("Search name or phone number") }, leadingIcon = { Icon(Icons.Outlined.Search, null) })
        LazyColumn {
            if (!multi && query.isBlank()) {
                item { ActionRow("New group", icon = Icons.Outlined.Group) { app.route = "new-group" } }
                item { ActionRow("Note to self", icon = Icons.Outlined.NoteAlt) { app.call("newChat", obj("id" to app.snapshot.optString("accountId"))) { value -> (value as? JSONObject)?.optString("id")?.let(app::openChat) } } }
                item { var joining by remember { mutableStateOf(false) }; var pasted by remember { mutableStateOf("") }
                    ActionRow("Join with invite link", icon = Icons.Outlined.Link) { joining = true }
                    if (joining) AlertDialog(onDismissRequest = { joining = false }, title = { Text("Join a group") },
                        text = { Column { Text("Ask the group’s admins to add you? They will see your name."); OutlinedTextField(pasted, { pasted = it }, label = { Text("Invite link") }, singleLine = true) } },
                        confirmButton = { TextButton({ val token = Regex("#/join/([A-Za-z0-9_-]{32})").find(pasted)?.groupValues?.get(1)
                            if (token == null) app.error = tr("This invite link is no longer valid.") else app.call("requestToJoin", obj("token" to token), quiet = true) { v -> if (v == null) app.error = tr("This invite link is no longer valid.") else app.notice = "Request sent" }
                            joining = false }) { Text("Ask to join") } },
                        dismissButton = { TextButton({ joining = false }) { Text("Cancel") } }) }
            }
            item {
                ActionRow(if (app.discovering) "Finding your contacts…" else "Find phone contacts", "With your permission, match phone numbers to Convo accounts. Contact names and photos stay on your phone.", Icons.Outlined.Contacts) { app.requestContacts() }
                if (app.discovering) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (app.discoveryDone && app.phoneMatches.isEmpty()) Text("No matching phone contacts found. You can still search the directory.", Modifier.padding(16.dp), style = MaterialTheme.typography.bodySmall)
                Text(if (query.isBlank()) "Phone contacts and recent chats" else "Directory results", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.primary)
            }
            items(choices, key = { it.optString("accountId") }) { account ->
                Row(Modifier.fillMaxWidth().clickable { onPick(account) }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    PersonAvatar(app, account.optString("accountId"), account.label())
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) { Text(account.optString("localName").takeIf { it.isNotBlank() } ?: account.label()); Text("@${account.optString("username")} · ${account.optString("phone")}", style = MaterialTheme.typography.bodySmall) }
                    if (multi) Checkbox(account.optString("accountId") in selected, onCheckedChange = { onPick(account) })
                }
            }
            if (choices.isEmpty()) item { Text(if (query.isBlank()) "Search the directory or find people from your phone contacts." else "No matching people", Modifier.padding(20.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}
fun JSONObject.label() = optString("displayName").takeIf { it.isNotBlank() && it != "null" } ?: optString("username").takeIf { it.isNotBlank() } ?: optString("title")

@Composable fun GroupWizard(app: MainActivity, channel: Boolean) {
    var selected by remember { mutableStateOf<List<JSONObject>>(emptyList()) }; var name by remember { mutableStateOf("") }
    var step by remember { mutableIntStateOf(0) }; var busy by remember { mutableStateOf(false) }
    androidx.activity.compose.BackHandler(step > 0) { if (!busy) step-- }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            listOf("People", "Details", "Review").forEachIndexed { index, label -> Text("${index + 1}  $label", color = if (step == index) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (step == 0) Box(Modifier.weight(1f)) {
            ContactsPicker(app, multi = true, selected = selected.map { it.optString("accountId") }.toSet()) { a -> selected = if (selected.any { it.optString("accountId") == a.optString("accountId") }) selected.filter { it.optString("accountId") != a.optString("accountId") } else selected + a }
        } else Column(Modifier.weight(1f).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            PersonAvatar(app, "new-group", name, 80, group = true)
            if (step == 1) OutlinedTextField(name, { name = it.filter { c -> !c.isISOControl() }.take(128) }, label = { Text(if (channel) "Channel name" else "Group name") }, modifier = Modifier.fillMaxWidth()) else Text(name, style = MaterialTheme.typography.headlineSmall)
            Text(if (channel) "Only owners and admins can publish. Subscribers can read announcements." else "Everyone in this group can send messages.")
            Text("${selected.size + 1} participants · You will be the owner", color = MaterialTheme.colorScheme.primary)
            LazyColumn { items(selected) { account -> ListItem(headlineContent = { Text(account.label()) }, supportingContent = { Text("@${account.optString("username")}") }, leadingContent = { PersonAvatar(app, account.optString("accountId"), account.label(), 36) }) } }
        }
        Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (step > 0) OutlinedButton({ step-- }, enabled = !busy) { Text("Back") }
            Button(onClick = { if (step < 2) step++ else {
                busy = true; app.call("createGroup", obj("name" to name.trim(), "members" to JSONArray(selected.map { it.optString("accountId") }), "channel" to channel)) { value -> busy = false; (value as? JSONObject)?.optString("id")?.let(app::openChat) }
            } }, enabled = !busy && selected.isNotEmpty() && (step == 0 || name.isNotBlank()), modifier = Modifier.weight(1f)) { Text(if (busy) "Creating…" else if (step == 0) "Next (${selected.size})" else if (step == 1) "Review" else if (channel) "Create channel" else "Create group") }
        }
    }
}
