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
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * An event inside its bubble (FR-EXT-01): date tile, title, time in this phone's zone (and the
 * creator's when different), location, Going / Maybe / Can't go with counts, responders, Add to
 * calendar (.ics) and Edit / Cancel for the creator or a group admin. Rules live in the shared core.
 */
@Composable fun EventCard(app: MainActivity, message: JSONObject, conversation: String) {
    val colors = LocalConvoColors.current
    val event = message.optJSONObject("event") ?: return
    val rsvps = event.optJSONObject("rsvps") ?: JSONObject()
    val cancelled = event.has("cancelled") && !event.isNull("cancelled")
    val start = event.optLong("start"); val end = if (event.has("end")) event.optLong("end") else 0L
    val closed = cancelled || System.currentTimeMillis() > (if (end > 0) end else start)
    val me = app.snapshot.optString("accountId")
    val mine = rsvps.optJSONObject(me)?.optString("response")
    val counts = listOf("going", "maybe", "no").associateWith { r -> rsvps.keys().asSequence().count { rsvps.optJSONObject(it)?.optString("response") == r } }
    var canEdit by remember(message.optString("id")) { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var names by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(message.optString("id")) { app.call("canEditEvent", message.targetArgs(conversation), quiet = true) { canEdit = it == true } }
    LaunchedEffect(names != null, rsvps.length()) { if (names != null) app.call("eventResponders", message.targetArgs(conversation), quiet = true) { names = it as? JSONObject ?: JSONObject() } }
    val local = ZoneId.systemDefault()
    val zone = runCatching { ZoneId.of(event.optString("zone")) }.getOrDefault(local)
    fun when_(z: ZoneId): String {
        val s = Instant.ofEpochMilli(start).atZone(z)
        val text = s.format(DateTimeFormatter.ofPattern("EEE, d MMM · HH:mm"))
        return if (end > 0) "$text – ${Instant.ofEpochMilli(end).atZone(z).format(DateTimeFormatter.ofPattern("HH:mm"))}" else text
    }
    val day = Instant.ofEpochMilli(start).atZone(local)
    Column(Modifier.widthIn(min = 250.dp, max = 300.dp).padding(horizontal = 4.dp, vertical = 2.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.width(50.dp).border(1.dp, colors.border, RoundedCornerShape(8.dp)).background(colors.panel, RoundedCornerShape(8.dp)).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                RawText(day.format(DateTimeFormatter.ofPattern("MMM")).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = colors.dangerText)
                RawText("${day.dayOfMonth}", fontSize = 20.sp, fontWeight = FontWeight.Bold)
            }
            Column(Modifier.padding(start = 10.dp)) {
                RawText(event.optString("title"), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, textDecoration = if (cancelled) TextDecoration.LineThrough else null, color = if (cancelled) colors.textSecondary else colors.textPrimary)
                Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Schedule, null, Modifier.size(14.dp), tint = colors.textSecondary); RawText(" ${when_(local)}", fontSize = 13.sp) }
                if (zone.id != local.id) RawText(tr("{time} in {zone}").replace("{time}", when_(zone)).replace("{zone}", zone.id), fontSize = 12.sp, color = colors.textSecondary)
                event.optString("location").takeIf { it.isNotBlank() }?.let { Row(verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Outlined.Place, null, Modifier.size(14.dp), tint = colors.textSecondary); RawText(" $it", fontSize = 13.sp) } }
            }
        }
        event.optString("description").takeIf { it.isNotBlank() }?.let { RawText(it, fontSize = 14.sp) }
        if (cancelled) Text("This event was cancelled", color = colors.dangerText, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        else if (closed) Text("This event has ended", color = colors.textSecondary, fontSize = 13.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("going" to "Going", "maybe" to "Maybe", "no" to "Can’t go").forEach { (key, label) ->
                val chosen = mine == key
                FilterChip(chosen, { app.call("rsvp", message.targetArgs(conversation).put("response", key), quiet = true) }, enabled = !closed,
                    label = { RawText("${tr(label)} ${counts[key]}", fontSize = 13.sp, maxLines = 1) }, modifier = Modifier.weight(1f))
            }
        }
        names?.let { n -> listOf("going" to "Going", "maybe" to "Maybe", "no" to "Can’t go").forEach { (key, label) ->
            n.optJSONArray(key)?.takeIf { it.length() > 0 }?.let { a -> RawText("${tr(label)}: " + (0 until a.length()).joinToString(", ") { tr(a.optString(it)) }, fontSize = 12.sp, color = colors.textSecondary) }
        } }
        HorizontalDivider(color = colors.border)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton({ names = if (names == null) JSONObject() else null }) { Text(if (names != null) "Hide responses" else "Responses", color = colors.accentText, fontSize = 13.sp) }
            TextButton({ app.call("eventIcs", message.targetArgs(conversation)) { ics -> (ics as? String)?.takeIf { it.isNotBlank() }?.let { app.export("${event.optString("title").take(60).ifBlank { "event" }}.ics", "text/calendar", it.toByteArray()) } } }) { Text("Add to calendar", color = colors.accentText, fontSize = 13.sp) }
        }
        if (canEdit && !cancelled) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            TextButton({ editing = true }) { Text("Edit event", color = colors.accentText, fontSize = 13.sp) }
            TextButton({ app.call("updateEvent", message.targetArgs(conversation).also { copyEvent(event, it) }.put("cancelled", true), quiet = true) }) { Text("Cancel event", color = colors.dangerText, fontSize = 13.sp) }
        }
    }
    if (editing) EventComposer(app, conversation, editing = message) { editing = false }
}

private fun copyEvent(event: JSONObject, into: JSONObject) {
    listOf("title", "start", "end", "zone", "location", "description").forEach { k -> if (event.has(k) && !event.isNull(k)) into.put(k, event.get(k)) }
}

/**
 * Create or edit an event with the system date and time pickers. Times are entered in this phone's
 * zone, stored as UTC, and shown to every member in their own zone.
 */
@Composable fun EventComposer(app: MainActivity, conversation: String, editing: JSONObject? = null, close: () -> Unit) {
    val current = editing?.optJSONObject("event")
    val zone = ZoneId.systemDefault()
    val nextHour = (System.currentTimeMillis() / 3_600_000 + 1) * 3_600_000
    var title by remember { mutableStateOf(current?.optString("title") ?: "") }
    var start by remember { mutableLongStateOf(current?.optLong("start") ?: nextHour) }
    var end by remember { mutableLongStateOf(if (current?.has("end") == true) current.optLong("end") else 0L) }
    var location by remember { mutableStateOf(current?.optString("location") ?: "") }
    var description by remember { mutableStateOf(current?.optString("description") ?: "") }
    val formatter = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)
    /** Date picker, then time picker, in this phone's zone. */
    fun pick(initial: Long, set: (Long) -> Unit) {
        val at = Instant.ofEpochMilli(initial).atZone(zone)
        android.app.DatePickerDialog(app, { _, y, m, d ->
            android.app.TimePickerDialog(app, { _, h, min -> set(at.withYear(y).withMonth(m + 1).withDayOfMonth(d).withHour(h).withMinute(min).withSecond(0).toInstant().toEpochMilli()) },
                at.hour, at.minute, android.text.format.DateFormat.is24HourFormat(app)).show()
        }, at.year, at.monthValue - 1, at.dayOfMonth).show()
    }
    AlertDialog(onDismissRequest = close, title = { Text(if (editing != null) "Edit event" else "Create event") }, text = {
        Column(Modifier.heightIn(max = 480.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(title, { title = it.take(120) }, label = { Text("Event name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedButton({ pick(start) { start = it; if (end in 1..it) end = 0 } }, Modifier.fillMaxWidth()) { RawText(tr("Starts") + ": " + Instant.ofEpochMilli(start).atZone(zone).format(formatter)) }
            OutlinedButton({ pick(if (end > 0) end else start + 3_600_000) { end = it } }, Modifier.fillMaxWidth()) { RawText(if (end > 0) tr("Ends") + ": " + Instant.ofEpochMilli(end).atZone(zone).format(formatter) else tr("Add end time")) }
            OutlinedTextField(location, { location = it.take(300) }, label = { Text("Location or link (optional)") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(description, { description = it.take(1000) }, label = { Text("Description (optional)") }, minLines = 2, modifier = Modifier.fillMaxWidth())
        }
    }, confirmButton = {
        Button({
            val args = obj("title" to title, "start" to start, "zone" to zone.id, "location" to location, "description" to description).apply { if (end > start) put("end", end) }
            if (editing != null) app.call("updateEvent", editing.targetArgs(conversation).also { t -> args.keys().forEach { k -> t.put(k, args.get(k)) } }) { if (it != null) close() }
            else app.call("createEvent", args.put("conversationId", conversation)) { if (it != null) close() }
        }, enabled = title.isNotBlank()) { Text(if (editing != null) "Save" else "Send") }
    }, dismissButton = { TextButton(close) { Text("Cancel") } })
}
