package com.convo.android

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
    Column(Modifier.padding(top = 6.dp).fillMaxWidth().border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(10.dp)).padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Icon(Icons.Outlined.Check, null, Modifier.size(16.dp)); Text("Acknowledgement requested", fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodySmall)
        }
        if (me in audience) {
            val mine = message.optJSONObject("myAck")
            val current = mine != null && mine.optInt("revision", -1) == revision
            if (mine != null && !current) Text("Updated — please acknowledge again", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
            if (current) Text(if ((mine!!.optJSONArray("pending")?.length() ?: 0) > 0) "Pending sync — your acknowledgement will be sent when you’re online" else "Acknowledgement sent", fontWeight = FontWeight.SemiBold)
            else Button(onClick = { app.call("acknowledge", obj("conversationId" to message.optString("conversationId"), "id" to message.optString("id"), "authorId" to message.optString("authorId"))) }) { Text("I acknowledge this announcement") }
            RawText(tr("Your response goes only to: {names}").replace("{names}", reviewers.joinToString(", ") { name(it) }), style = MaterialTheme.typography.bodySmall)
        }
        if (me in reviewers) {
            TextButton(onClick = { showList = !showList }) { RawText(tr("Acknowledged {done} of {total}").replace("{done}", "${responded.size}").replace("{total}", "${audience.size}")) }
            if (showList) audience.forEach { id ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    RawText(name(id), style = MaterialTheme.typography.bodySmall)
                    Text(when { id in responded -> "Acknowledged"; acks?.has(id) == true -> "Acknowledged an earlier version"; else -> "No response received" }, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
        if (me !in audience && me !in reviewers) Text("Members who were in the community when this was posted are asked to acknowledge it.", style = MaterialTheme.typography.bodySmall)
    }
}
