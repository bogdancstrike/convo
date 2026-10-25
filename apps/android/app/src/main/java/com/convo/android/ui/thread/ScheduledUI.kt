package com.convo.android.ui.thread

import com.convo.android.R
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.i18n.*
import com.convo.android.ui.components.*
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import androidx.compose.foundation.background
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
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private fun whenText(ms: Long) = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("EEE, d MMM · HH:mm"))

/**
 * "N scheduled" bar above the composer (specs §30.4). Scheduled messages are encrypted items on this
 * phone, sent by it while Convo runs at or after their time; the list says so and offers change
 * time, send now and cancel.
 */
@Composable fun ScheduledBar(app: MainActivity, conversation: String) {
    val colors = LocalConvoColors.current
    var items by remember(conversation) { mutableStateOf<List<JSONObject>>(emptyList()) }
    var open by remember { mutableStateOf(false) }
    // The snapshot refreshes on every scheduled change; re-read the list each time.
    LaunchedEffect(conversation, app.snapshot) { app.call("scheduledMessages", obj("conversationId" to conversation), quiet = true) { v -> items = (v as? JSONArray)?.objects().orEmpty() } }
    if (items.isEmpty()) return
    Row(Modifier.fillMaxWidth().background(colors.panel).clickable { open = true }.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.Schedule, null, Modifier.size(16.dp), tint = colors.accentText)
        RawText(" " + tr("{count} scheduled").replace("{count}", "${items.size}") + " · " + whenText(items.first().optLong("dueAt")), color = colors.accentText, fontSize = 13.sp)
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text("Scheduled messages") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Kept encrypted on this device and sent by it: the message goes out when this device is online at or after that time.", fontSize = 13.sp, color = colors.textSecondary)
            LazyColumn(Modifier.heightIn(max = 360.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(items, key = { it.optString("id") }) { item ->
                    Column {
                        RawText(whenText(item.optLong("dueAt")) + if (item.optBoolean("silent")) " · " + tr("quiet") else "", fontSize = 12.sp, color = colors.textSecondary)
                        RawText(item.optString("body"), maxLines = 3)
                        Row {
                            TextButton({ pickDateTime(app, item.optLong("dueAt")) { at -> app.call("editScheduled", obj("id" to item.optString("id"), "dueAt" to at)) } }) { Text("Change time", fontSize = 13.sp) }
                            TextButton({ app.call("sendScheduledNow", obj("id" to item.optString("id"))) }) { Text("Send now", fontSize = 13.sp) }
                            TextButton({ app.call("cancelScheduled", obj("id" to item.optString("id"))) }) { Text("Cancel", fontSize = 13.sp, color = colors.dangerText) }
                        }
                    }
                }
            }
        }
    }, confirmButton = { TextButton({ open = false }) { Text("Done") } })
}
