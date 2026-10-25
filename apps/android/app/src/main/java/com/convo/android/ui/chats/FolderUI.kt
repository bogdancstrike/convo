package com.convo.android.ui.chats

import com.convo.android.R
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.i18n.*
import com.convo.android.ui.components.*
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

/** Mirrors core/folders.ts `folderMatches`: explicit chats or included types, optionally unread only. */
fun folderMatches(folder: JSONObject, c: JSONObject): Boolean {
    val type = when { c.optString("kind") == "direct" -> "direct"; c.optString("kind") == "group" -> if (c.optBoolean("adminOnly")) "channel" else "group"; else -> null }
    val chats = folder.optJSONArray("chats")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
    val types = folder.optJSONArray("types")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
    val included = c.optString("id") in chats || (type != null && type in types)
    return included && (!folder.optBoolean("unreadOnly") || c.optInt("unread") > 0)
}

/**
 * Create or edit a private chat folder (specs §30.4): name, chat types, chosen chats and unread
 * only. Folders are private and reach only this account's devices; the shared core validates them.
 */
@Composable fun FolderEditor(app: MainActivity, conversations: List<JSONObject>, folders: List<JSONObject>, folder: JSONObject?, close: () -> Unit) {
    fun list(key: String) = folder?.optJSONArray(key)?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
    var name by remember { mutableStateOf(folder?.optString("name") ?: "") }
    val types = remember { mutableStateListOf<String>().apply { addAll(list("types")) } }
    val chats = remember { mutableStateListOf<String>().apply { addAll(list("chats")) } }
    var unreadOnly by remember { mutableStateOf(folder?.optBoolean("unreadOnly") ?: false) }
    fun save(remove: Boolean = false) {
        val id = folder?.optString("id") ?: java.util.UUID.randomUUID().toString().replace("-", "")
        val next = obj("id" to id, "name" to name.trim(), "types" to JSONArray(types.toList()), "chats" to JSONArray(chats.toList()), "unreadOnly" to unreadOnly)
        val updated = if (remove) folders.filter { it.optString("id") != id } else if (folder != null) folders.map { if (it.optString("id") == id) next else it } else folders + next
        app.call("saveFolders", obj("folders" to JSONArray(updated))) { close() }
    }
    @Composable fun Check(label: String, checked: Boolean, toggle: (Boolean) -> Unit) {
        // The whole row toggles (a larger touch target than the box alone).
        Row(Modifier.fillMaxWidth().clickable { toggle(!checked) }, verticalAlignment = Alignment.CenterVertically) { Checkbox(checked, toggle); RawText(label) }
    }
    AlertDialog(onDismissRequest = close, title = { Text(if (folder != null) "Edit folder" else "New folder") }, text = {
        Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState())) {
            OutlinedTextField(name, { name = it.take(24) }, label = { Text("Folder name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            Text("Include all", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.labelLarge)
            listOf("direct" to "Personal chats", "group" to "Groups", "channel" to "Channels").forEach { (key, label) -> Check(tr(label), key in types) { if (it) types.add(key) else types.remove(key) } }
            Check(tr("Only chats with unread messages"), unreadOnly) { unreadOnly = it }
            Text("Chats in this folder", Modifier.padding(top = 12.dp), style = MaterialTheme.typography.labelLarge)
            conversations.filter { it.optString("kind") != "note" }.forEach { c -> Check(c.optString("title"), c.optString("id") in chats) { if (it) chats.add(c.optString("id")) else chats.remove(c.optString("id")) } }
            Text("Folders are private: only you see them, on your own devices.", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall)
        }
    }, confirmButton = { Button({ save() }, enabled = name.isNotBlank()) { Text("Save") } }, dismissButton = {
        Row { if (folder != null) TextButton({ save(remove = true) }) { Text("Delete folder", color = MaterialTheme.colorScheme.error) }; TextButton(close) { Text("Cancel") } }
    })
}
