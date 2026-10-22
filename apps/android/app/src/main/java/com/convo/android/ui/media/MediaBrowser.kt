package com.convo.android.ui.media

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.calls.*
import com.convo.android.i18n.*
import com.convo.android.push.*
import com.convo.android.ui.communities.*
import com.convo.android.ui.contacts.*
import com.convo.android.ui.info.*
import com.convo.android.ui.linking.*
import com.convo.android.ui.locks.*
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import org.json.JSONArray
import org.json.JSONObject

/** The same media filtering/selection rules as web, executed by the shared protocol facade. */
@Composable fun MediaBrowser(app: MainActivity, conversation: String? = null, close: () -> Unit) {
    var tab by remember { mutableStateOf("media") }
    var query by remember { mutableStateOf("") }
    var sender by remember { mutableStateOf("all") }
    var sort by remember { mutableStateOf("newest") }
    var filters by remember { mutableStateOf(false) }
    var selecting by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var entries by remember { mutableStateOf(emptyList<JSONObject>()) }
    var total by remember { mutableIntStateOf(0) }
    var limit by remember { mutableIntStateOf(60) }
    var loading by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var refresh by remember { mutableIntStateOf(0) }
    var delete by remember { mutableStateOf(false) }
    var forward by remember { mutableStateOf(false) }
    var viewing by remember { mutableStateOf<JSONObject?>(null) }
    var external by remember { mutableStateOf<String?>(null) }
    val picked = entries.filter { it.optString("key") in selected }
    fun action(name: String, destination: String? = null) {
        if (busy || picked.isEmpty()) return
        busy = true
        app.call("mediaAction", obj("action" to name, "keys" to JSONArray(selected.toList()), "destination" to destination)) { result ->
            busy = false
            if (result != null) {
                if (name == "download") (result as? JSONObject)?.let { app.export(it.optString("name"), it.optString("mime"), app.decode(it.optString("data"))) }
                if (name in listOf("delete", "forward")) { selected = emptySet(); selecting = false }
                refresh++
            }
        }
    }
    LaunchedEffect(tab, query, sender, sort) { selected = emptySet(); limit = 60 }
    LaunchedEffect(tab, query, sender, sort, limit, refresh, app.snapshot) {
        kotlinx.coroutines.delay(150)
        app.call("mediaEntries", obj("conversationId" to conversation, "exclude" to org.json.JSONArray(app.locks.lockedChats.filter { it != conversation }), "limit" to limit, "filter" to obj("tab" to tab, "query" to query, "sender" to sender, "sort" to sort))) { value ->
            loading = false; failed = value == null
            (value as? JSONObject)?.let { result -> entries = result.optJSONArray("entries")?.objects().orEmpty(); total = result.optInt("total"); selected = selected.intersect(entries.map { it.optString("key") }.toSet()) }
        }
    }
    fun choose(key: String) { selected = if (key in selected) selected - key else if (selected.size < 100) selected + key else selected }
    Dialog(onDismissRequest = { if (!busy) close() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.fillMaxSize(), color = LocalConvoColors.current.panel) {
            Column(Modifier.fillMaxSize()) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) { Text("Media", style = MaterialTheme.typography.titleLarge); Text(if (conversation == null) "Media from all chats" else "Media from this chat", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    Box {
                        IconButton({ filters = true }) { Icon(Icons.Outlined.FilterList, "Filter and sort") }
                        DropdownMenu(filters, { filters = false }) {
                            Text("Sent by", Modifier.padding(16.dp), style = MaterialTheme.typography.labelMedium)
                            listOf("all" to "All senders", "you" to "Sent by you", "others" to "Sent by others").forEach { (key, label) -> DropdownMenuItem(text = { Text(label) }, leadingIcon = { RadioButton(sender == key, null) }, onClick = { sender = key; filters = false }) }
                            HorizontalDivider()
                            Text("Sort by", Modifier.padding(16.dp), style = MaterialTheme.typography.labelMedium)
                            listOf("newest" to "Newest first", "oldest" to "Oldest first", "largest" to "Largest first").forEach { (key, label) -> DropdownMenuItem(text = { Text(label) }, leadingIcon = { RadioButton(sort == key, null) }, onClick = { sort = key; filters = false }) }
                        }
                    }
                    IconButton({ selecting = !selecting; selected = emptySet() }, enabled = !busy) { Icon(if (selecting) Icons.Outlined.Close else Icons.Outlined.Checklist, if (selecting) "Cancel selection" else "Select items") }
                    IconButton(close, enabled = !busy) { Icon(Icons.Outlined.Close, "Close media") }
                }
                TabRow(listOf("media", "docs", "links").indexOf(tab), containerColor = LocalConvoColors.current.panel) {
                    listOf("media" to "Media", "docs" to "Docs", "links" to "Links").forEach { (key, label) -> Tab(tab == key, { if (!busy) tab = key }, text = { Text(label) }) }
                }
                OutlinedTextField(query, { query = it }, singleLine = true, placeholder = { Text("Search captions, filenames and links") }, leadingIcon = { Icon(Icons.Outlined.Search, null) }, modifier = Modifier.fillMaxWidth().padding(12.dp), shape = RoundedCornerShape(12.dp))
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("${sender.replaceFirstChar { it.uppercase() }} · ${sort.replaceFirstChar { it.uppercase() }} · $total items", Modifier.weight(1f), style = MaterialTheme.typography.labelSmall)
                    if (selecting) TextButton({ selected = entries.take(100).map { it.optString("key") }.toSet() }) { Text("Select all") }
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    if (loading) CircularProgressIndicator(Modifier.align(Alignment.Center))
                    else if (failed) TextButton({ refresh++; loading = true }, Modifier.align(Alignment.Center)) { Text("Could not load media. Retry") }
                    else if (entries.isEmpty()) Text("No matching ${tab.lowercase()}", Modifier.align(Alignment.Center), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    else LazyVerticalGrid(columns = if (tab == "media") GridCells.Adaptive(150.dp) else GridCells.Fixed(1), contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(entries, key = { it.optString("key") }) { entry ->
                            val key = entry.optString("key"); val message = entry.getJSONObject("message"); val chat = entry.getJSONObject("conversation"); val index = entry.optInt("attachmentIndex", -1)
                            OutlinedCard(modifier = Modifier.fillMaxWidth(), border = BorderStroke(if (key in selected) 2.dp else 1.dp, if (key in selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant)) {
                                Column(Modifier.padding(8.dp)) {
                                    if (selecting) Row(Modifier.fillMaxWidth().clickable { choose(key) }, verticalAlignment = Alignment.CenterVertically) { Checkbox(key in selected, { choose(key) }, enabled = !busy); Text("Select item", style = MaterialTheme.typography.labelSmall) }
                                    if (!selecting && index >= 0) AttachmentTile(app, message, chat.optString("id"), index, message.getJSONArray("attachments").getJSONObject(index)) { viewing = entry }
                                    else if (index >= 0) Text(message.getJSONArray("attachments").getJSONObject(index).optString("fileName", "Attachment"), Modifier.padding(12.dp), maxLines = 2)
                                    else TextButton({ val url = entry.optString("link"); if (selecting) choose(key) else if (app.snapshot.optJSONObject("settings")?.optBoolean("confirmExternalLinks", true) != false) external = url else app.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }) { Text(entry.optString("link"), maxLines = 3) }
                                    Text(chat.optString("title"), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(top = 6.dp), maxLines = 1)
                                    if (message.optString("body").isNotBlank()) Text(message.optString("body"), style = MaterialTheme.typography.bodySmall, maxLines = 2)
                                    Text(formatSize(entry.optLong("size")), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                        }
                        if (entries.size < total) item(span = { GridItemSpan(maxLineSpan) }) { TextButton({ limit += 60 }) { Text("Load more") } }
                    }
                }
                if (selecting) {
                    HorizontalDivider()
                    Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("${picked.size} selected", Modifier.weight(1f), style = MaterialTheme.typography.labelMedium)
                        IconButton({ if (picked.sumOf { it.optLong("size") } <= 64L * 1024 * 1024) action("download") else app.error = "Choose up to 64 MB per download on this phone." }, enabled = !busy && picked.isNotEmpty()) { Icon(Icons.Outlined.Download, "Download selected") }
                        IconButton({ forward = true }, enabled = !busy && picked.isNotEmpty()) { Icon(Icons.Outlined.Forward, "Forward selected") }
                        IconButton({ action("star") }, enabled = !busy && picked.isNotEmpty()) { Icon(Icons.Outlined.StarOutline, "Star or unstar selected messages") }
                        IconButton({ delete = true }, enabled = !busy && picked.isNotEmpty()) { Icon(Icons.Outlined.DeleteOutline, "Delete selected messages for me", tint = MaterialTheme.colorScheme.error) }
                    }
                    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                }
            }
        }
        viewing?.let { entry -> AttachmentDialog(app, entry.getJSONObject("message"), entry.getJSONObject("conversation").optString("id"), entry.optInt("attachmentIndex")) { viewing = null } }
        external?.let { url -> ExternalLinkConfirmation(url, { external = null }) { external = null; app.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }
        if (delete) Confirm("Delete selected messages for you?", "This removes the whole messages, including their captions and any other attachments. Other participants keep their copies.", "Delete", { delete = false }) { delete = false; action("delete") }
        if (forward) AlertDialog(onDismissRequest = { forward = false }, title = { Text("Forward selected") }, text = { androidx.compose.foundation.lazy.LazyColumn { items(app.snapshot.optJSONArray("conversations")?.length() ?: 0) { index -> val c = app.snapshot.getJSONArray("conversations").getJSONObject(index); TextButton({ forward = false; action("forward", c.optString("id")) }) { Text(c.optString("title")) } } } }, confirmButton = { TextButton({ forward = false }) { Text("Cancel") } })
    }
}
