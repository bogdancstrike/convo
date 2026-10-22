package com.convo.android.ui.thread

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
import com.convo.android.ui.media.*
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONObject

/**
 * Explicit announcement acknowledgement (specs §30.6), same rules as the web client: members
 * respond deliberately and see who receives it; reviewers see counts derived on this device.
 */
@Composable fun AckBox(app: MainActivity, message: JSONObject) {
    val request = message.optJSONObject("ackRequest") ?: return
    val me = app.snapshot.optString("accountId")
    val reviewers = request.optJSONArray("reviewers")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
    val audience = request.optJSONArray("audience")?.let { a -> (0 until a.length()).map { a.optString(it) } }.orEmpty()
    val names = message.optJSONObject("ackNames")
    fun name(id: String) = names?.optString(id)?.takeIf { it.isNotBlank() } ?: "…"
    val revision = message.optInt("revision", 0)
    val acks = message.optJSONObject("acks")
    val responded = audience.filter { acks?.optJSONObject(it)?.optInt("revision", -1) == revision }
    var showList by remember { mutableStateOf(false) }
    val now = System.currentTimeMillis()
    val due = request.optLong("due", 0L).takeIf { it > 0 }
    val expires = request.optLong("expires", 0L).takeIf { it > 0 }
    val closed = expires != null && now > expires
    val overdue = due != null && now > due
    fun whenText(ms: Long) = java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.MEDIUM, java.text.DateFormat.SHORT).format(java.util.Date(ms))
    Column(Modifier.padding(top = 6.dp).fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(Icons.Outlined.Check, null, Modifier.size(16.dp)); Text("Acknowledgement requested", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
        }
        if (closed) Text("Closed — responses are no longer accepted", style = MaterialTheme.typography.bodySmall)
        else {
            if (due != null) RawText(tr(if (overdue) "Was due {when}" else "Due {when}").replace("{when}", whenText(due)), style = MaterialTheme.typography.bodySmall,
                color = if (overdue) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
            if (expires != null) RawText(tr("Closes {when}").replace("{when}", whenText(expires)), style = MaterialTheme.typography.bodySmall)
        }
        if (me in audience) {
            val mine = message.optJSONObject("myAck")
            val current = mine != null && mine.optInt("revision", -1) == revision
            if (mine != null && !current) Text("Updated — please acknowledge again", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
            if (current) Text(if ((mine!!.optJSONArray("pending")?.length() ?: 0) > 0) "Pending sync — your acknowledgement will be sent when you’re online" else "Acknowledgement sent", fontWeight = FontWeight.SemiBold)
            else if (!closed) Button(onClick = { app.call("acknowledge", obj("conversationId" to message.optString("conversationId"), "id" to message.optString("id"), "authorId" to message.optString("authorId"))) }) { Text("I acknowledge this announcement") }
            RawText(tr("Your response goes only to: {names}").replace("{names}", reviewers.joinToString(", ") { name(it) }), style = MaterialTheme.typography.bodySmall)
        }
        if (me in reviewers) {
            TextButton(onClick = { showList = !showList }) { RawText(tr("Acknowledged {done} of {total}").replace("{done}", "${responded.size}").replace("{total}", "${audience.size}")) }
            if (showList) audience.forEach { id ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    RawText(name(id), style = MaterialTheme.typography.bodySmall)
                    val late = acks?.optJSONObject(id)?.optBoolean("late") == true
                    Text(when { id in responded && late -> "Acknowledged late"; id in responded -> "Acknowledged"; acks?.has(id) == true -> "Acknowledged an earlier version"
                        overdue -> "Past due — no response received"; else -> "No response received" }, style = MaterialTheme.typography.bodySmall,
                        color = if (id !in responded && overdue) MaterialTheme.colorScheme.error else androidx.compose.ui.graphics.Color.Unspecified)
                }
            }
        }
        if (me !in audience && me !in reviewers) Text("Members who were in the community when this was posted are asked to acknowledge it.", style = MaterialTheme.typography.bodySmall)
    }
}

/** Deadline in days from sending (0 = none), for an acknowledgement request in the composer. */
@Composable fun AckDeadlinePicker(label: String, days: Int, options: List<Int>, noneLabel: String, onChange: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    fun text(d: Int) = when (d) { 0 -> tr(noneLabel); 1 -> tr("In 1 day"); 7 -> tr("In 1 week"); 30 -> tr("In 30 days"); else -> tr("In 3 days") }
    Box {
        TextButton({ open = true }) { RawText("${tr(label)}: ${text(days)}", style = MaterialTheme.typography.bodySmall) }
        DropdownMenu(open, { open = false }) {
            options.forEach { d -> DropdownMenuItem(text = { RawText(text(d)) }, onClick = { onChange(d); open = false }) }
        }
    }
}
