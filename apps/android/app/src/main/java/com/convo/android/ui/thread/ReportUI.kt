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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Abuse report (specs AC-SEC-09): pick a security contact, explicitly select the messages to share
 * (none pre-selected), read who will receive them, and send them end-to-end encrypted to that one
 * person. Cancelling sends nothing; the server never sees the report; retry re-sends the same one.
 */
@Composable fun ReportDialog(app: MainActivity, conversation: JSONObject, close: () -> Unit) {
    val colors = LocalConvoColors.current
    val reportId = remember { java.util.UUID.randomUUID().toString().replace("-", "") }
    var recipients by remember { mutableStateOf<List<JSONObject>?>(null) }
    var recipient by remember { mutableStateOf<JSONObject?>(null) }
    val selected = remember { mutableStateListOf<String>() }
    var reason by remember { mutableStateOf("") }
    var state by remember { mutableStateOf("edit") }
    var pickRecipient by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { app.call("reportRecipients", quiet = true) { v -> recipients = (v as? JSONArray)?.objects().orEmpty(); if (recipients?.size == 1) recipient = recipients!!.first() } }
    val messages = app.snapshot.optJSONArray("messages")?.objects().orEmpty()
        .filter { !it.has("notice") && !it.optBoolean("deleted") && (it.optString("body").isNotBlank() || (it.optJSONArray("attachments")?.length() ?: 0) > 0) }.takeLast(100)
    fun key(m: JSONObject) = "${m.optString("authorId")}/${m.optString("id")}"
    val time = SimpleDateFormat("d MMM HH:mm", Locale.getDefault())
    AlertDialog(onDismissRequest = close, title = { Text("Report") }, text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                state == "sent" -> RawText(tr("Report sent to {name}.").replace("{name}", recipient?.optString("displayName") ?: ""))
                recipients?.isEmpty() == true -> Text("Your organization has not set up a security contact for reports yet. Ask your administrator.")
                else -> {
                    OutlinedButton({ pickRecipient = true }, Modifier.fillMaxWidth()) { RawText(recipient?.optString("displayName") ?: tr("Choose a security contact")) }
                    DropdownMenu(pickRecipient, { pickRecipient = false }) { recipients.orEmpty().forEach { r -> DropdownMenuItem(text = { RawText(r.optString("displayName")) }, onClick = { recipient = r; pickRecipient = false }) } }
                    Text("Messages to include", style = MaterialTheme.typography.labelLarge)
                    LazyColumn(Modifier.heightIn(max = 260.dp)) {
                        items(messages, key = { key(it) }) { m ->
                            val k = key(m)
                            Row(Modifier.fillMaxWidth().clickable { if (k in selected) selected.remove(k) else if (selected.size < 50) selected.add(k) }.padding(vertical = 4.dp), verticalAlignment = Alignment.Top) {
                                Checkbox(k in selected, null)
                                Column(Modifier.padding(start = 6.dp)) {
                                    RawText(time.format(Date(m.optLong("sentAt"))) + if (m.optString("direction") == "out") " · " + tr("You") else "", fontSize = 12.sp, color = colors.textSecondary)
                                    RawText(m.optString("body").ifBlank { "📎 " + (m.optJSONArray("attachments")?.objects()?.joinToString { it.optString("fileName") } ?: "") }, maxLines = 3, fontSize = 14.sp)
                                }
                            }
                        }
                    }
                    OutlinedTextField(reason, { reason = it.take(1000) }, label = { Text("What happened? (optional)") }, modifier = Modifier.fillMaxWidth())
                    RawText(if (recipient != null) tr("{count} selected messages, with sender names and times, will be sent end-to-end encrypted to {name}, who will be able to read them. Nothing else from this chat is shared, and the server never sees the report.")
                        .replace("{count}", "${selected.size}").replace("{name}", recipient!!.optString("displayName"))
                        else tr("Choose who receives the report. Only the messages you select are shared, and only with that person."),
                        Modifier.background(colors.canvas, RoundedCornerShape(8.dp)).padding(10.dp), fontSize = 13.sp)
                    if (state == "failed") Text("The report could not be sent. Check your connection and try again.", color = colors.dangerText, fontSize = 13.sp)
                }
            }
        }
    }, confirmButton = {
        if (state != "sent" && recipients?.isNotEmpty() == true) Button({
            state = "sending"
            app.call("sendReport", obj("recipient" to recipient!!.optString("accountId"), "reportId" to reportId, "reason" to reason, "conversationId" to conversation.optString("id"),
                "keys" to JSONArray(selected.toList()), "reported" to if (conversation.optString("kind") == "direct") conversation.optString("id") else null), quiet = true) { state = if (it != null) "sent" else "failed" }
        }, enabled = recipient != null && selected.isNotEmpty() && state != "sending", colors = ButtonDefaults.buttonColors(containerColor = colors.dangerText)) {
            RawText(if (state == "failed") tr("Try again") else tr("Send report ({count})").replace("{count}", "${selected.size}"))
        }
    }, dismissButton = { TextButton(close) { Text(if (state == "sent") "Done" else "Cancel") } })
}

/** A received report, as the security contact sees it. */
@Composable fun ReportCard(message: JSONObject) {
    val colors = LocalConvoColors.current
    val r = message.optJSONObject("report") ?: return
    val time = SimpleDateFormat("d MMM HH:mm", Locale.getDefault())
    Column(Modifier.widthIn(min = 240.dp, max = 300.dp).padding(horizontal = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("⚠️ Abuse report", fontWeight = FontWeight.Bold, color = colors.dangerText)
        RawText(tr("From chat “{chat}”").replace("{chat}", r.optJSONObject("chat")?.optString("title") ?: "") +
            (r.optJSONObject("reported")?.let { " · " + tr("about {name}").replace("{name}", it.optString("name")) } ?: ""), fontSize = 12.sp, color = colors.textSecondary)
        r.optString("reason").takeIf { it.isNotBlank() }?.let { RawText("“$it”", fontStyle = FontStyle.Italic) }
        r.optJSONArray("items")?.objects()?.forEachIndexed { i, item ->
            Column(Modifier.padding(top = 4.dp)) {
                RawText("${i + 1}. ${item.optString("authorName")} · ${time.format(Date(item.optLong("sentAt")))}", fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                item.optString("text").takeIf { it.isNotBlank() }?.let { RawText(it, fontSize = 14.sp) }
                item.optJSONArray("files")?.takeIf { it.length() > 0 }?.let { f -> RawText("📎 " + (0 until f.length()).joinToString { f.optString(it) }, fontSize = 12.sp, color = colors.textSecondary) }
            }
        }
    }
}
