package com.convo.android.ui.thread

import com.convo.android.R
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.i18n.*
import com.convo.android.ui.chats.PillChip
import com.convo.android.ui.components.*
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONObject

/**
 * Topic tabs of a group (specs §30.4): General plus topics; owners/admins add (+) and long-press to
 * rename, close or reopen. Topic rules (admin-only, revisions) live in the shared core.
 */
@Composable fun TopicBar(app: MainActivity, conversation: String, topics: List<JSONObject>, selected: String?, isAdmin: Boolean, select: (String?) -> Unit) {
    val colors = LocalConvoColors.current
    var editing by remember { mutableStateOf<JSONObject?>(null) }; var creating by remember { mutableStateOf(false) }
    Row(Modifier.fillMaxWidth().background(colors.panel).horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PillChip(tr("General"), selected == null) { select(null) }
        topics.forEach { t ->
            PillChip("# " + t.optString("name"), selected == t.optString("id"), if (t.optBoolean("closed")) Icons.Outlined.Lock else null,
                onLongClick = if (isAdmin) ({ editing = t }) else null) { select(t.optString("id")) }
        }
        if (isAdmin) PillChip("", false, Icons.Outlined.Add) { creating = true }
    }
    if (creating || editing != null) {
        val topic = editing
        var name by remember(topic) { mutableStateOf(topic?.optString("name") ?: "") }
        val close = { creating = false; editing = null }
        AlertDialog(onDismissRequest = close, title = { Text(if (topic != null) "Edit topic" else "New topic") }, text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it.take(48) }, label = { Text("Topic name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                Text("Topics share this group’s members and encryption. Only owners and admins create, rename or close them.", style = MaterialTheme.typography.bodySmall)
                if (topic != null) TextButton({ app.call("updateTopic", obj("conversationId" to conversation, "id" to topic.optString("id"), "closed" to !topic.optBoolean("closed"))) { close() } }) {
                    Text(if (topic.optBoolean("closed")) "Reopen topic" else "Close topic")
                }
            }
        }, confirmButton = {
            Button({
                // Close first so a second tap cannot submit twice.
                val chosen = name; close()
                if (topic != null) app.call("updateTopic", obj("conversationId" to conversation, "id" to topic.optString("id"), "name" to chosen))
                else app.call("createTopic", obj("conversationId" to conversation, "name" to chosen)) { v -> (v as? JSONObject)?.optString("id")?.let(select) }
            }, enabled = name.isNotBlank()) { Text("Save") }
        }, dismissButton = { TextButton(close) { Text("Cancel") } })
    }
}
