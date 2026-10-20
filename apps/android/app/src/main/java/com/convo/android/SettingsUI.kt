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

@Composable fun NativeSettings(app: MainActivity) {
    val settings = app.snapshot.optJSONObject("settings") ?: JSONObject()
    var logout by remember { mutableStateOf(false) }
    val page = app.route
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when (page) {
            "list" -> {
                item { val device = app.snapshot.optJSONObject("device") ?: JSONObject(); Row(Modifier.fillMaxWidth().clickable { app.route = "profile" }.padding(12.dp), verticalAlignment = Alignment.CenterVertically) { PersonAvatar(app, app.snapshot.optString("accountId"), device.label(), 64); Column(Modifier.padding(start = 16.dp)) { Text(device.label(), style = MaterialTheme.typography.titleLarge); Text("@${device.optString("username")}") } } }
                items(listOf("Your profile" to "profile", "History and recovery" to "recovery", "Chats" to "chats", "Privacy" to "privacy", "Devices" to "devices")) { (label, route) -> Card { ActionRow(label, icon = when(route) { "profile" -> Icons.Outlined.AccountCircle; "chats" -> Icons.Outlined.Palette; "devices" -> Icons.Outlined.Devices; "privacy" -> Icons.Outlined.Lock; else -> Icons.Outlined.Shield }) { app.route = route } } }
                item { ActionRow("Log out", icon = Icons.Outlined.Logout, danger = true) { logout = true } }
            }
            "profile" -> item { ProfileEditor(app) }
            "recovery" -> item { RecoveryEditor(app) }
            "chats" -> {
                item { Text("Chat background", style = MaterialTheme.typography.titleMedium); WallpaperPicker(app) }
                item { PrivacySwitch("Animations", "Short transitions. Device reduced-motion settings are respected.", settings.optBoolean("animations", true)) { app.call("settings", obj("patch" to obj("animations" to it))) } }
                item { Text("Theme"); Row { listOf("system", "light", "dark").forEach { value -> FilterChip(settings.optString("theme") == value, { app.call("settings", obj("patch" to obj("theme" to value))) }, label = { Text(value.replaceFirstChar { it.uppercase() }) }, modifier = Modifier.padding(end = 8.dp)) } } }
                item { Text("Language"); Row { listOf("en" to "English", "ro" to "Română").forEach { (key, label) -> FilterChip(settings.optString("locale") == key, { app.call("settings", obj("patch" to obj("locale" to key))) }, label = { Text(label) }, modifier = Modifier.padding(end = 8.dp)) } } }
            }
            "privacy" -> item { PrivacyEditor(app, settings) }
            "devices" -> item { DevicesEditor(app) }
            "security" -> {
                item { Text("This development client uses the bundled encrypted protocol engine. The app-private encrypted store and device keys remain on this phone. Production native storage certification is in progress.") }
                item { ActionRow("History and recovery", icon = Icons.Outlined.Shield) { app.route = "recovery" } }
                item { ActionRow("Log out", icon = Icons.Outlined.Logout, danger = true) { logout = true } }
            }
        }
        item { Text("Your personal messages are end-to-end encrypted", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(12.dp)) }
    }
    if (logout) Confirm("Log out of this phone?", "Encrypted history must finish syncing. Keep a recovery code or another trusted device before removing this device.", "Log out", { logout = false }) { logout = false; app.call("logout") }
}
@Composable fun ProfileEditor(app: MainActivity) {
    val id = app.snapshot.optString("accountId"); val profile = app.snapshot.optJSONObject("profiles")?.optJSONObject(id)
    var status by remember(profile?.optString("status")) { mutableStateOf(profile?.optString("status") ?: "") }
    var remove by remember { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        PersonAvatar(app, id, app.snapshot.optJSONObject("device")?.label() ?: "You", 96)
        Row { Button(onClick = { app.pickFile({ data, _, mime -> app.call("profile", obj("patch" to obj("photo" to data), "mime" to mime)) }, "image/*") }) { Text(if (profile?.has("photo") == true) "Change photo" else "Upload photo") }; if (profile?.has("photo") == true) TextButton({ remove = true }) { Text("Remove photo", color = MaterialTheme.colorScheme.error) } }
        Text("Your photo and status are shared end-to-end encrypted with people you chat with.")
        OutlinedTextField(status, { status = it.take(280) }, label = { Text("Status") }, supportingText = { Text("${status.length}/280") }, modifier = Modifier.fillMaxWidth())
        Row { Button(onClick = { app.call("profile", obj("patch" to obj("status" to status.trim()))) }) { Text("Save") }; TextButton({ status = ""; app.call("profile", obj("patch" to obj("status" to ""))) }) { Text("Clear status") } }
    }
    if (remove) Confirm("Remove profile photo?", "Your contacts will see your initials.", "Remove", { remove = false }) { remove = false; app.call("profile", obj("patch" to JSONObject(), "removePhoto" to true)) }
}
@Composable fun RecoveryEditor(app: MainActivity) {
    var configured by remember { mutableStateOf(false) }; var code by remember { mutableStateOf("") }; var replace by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { app.call("recoveryStatus") { configured = (it as? JSONObject)?.optBoolean("configured") ?: false } }
    fun create() { app.call("recoveryCode") { code = it as? String ?: ""; configured = true } }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("History and recovery", style = MaterialTheme.typography.titleLarge)
        Text("Uploaded encrypted history follows your account on trusted devices. Save a recovery code outside this phone in case every device is lost.")
        Text("History: ${app.snapshot.optString("history")}", color = MaterialTheme.colorScheme.primary)
        OutlinedButton({ app.call("sync") }) { Text("Sync now") }
        Text(if (configured) "Recovery code is set up" else "No recovery code saved yet")
        if (code.isNotBlank()) {
            androidx.compose.foundation.text.selection.SelectionContainer { Text(code, style = MaterialTheme.typography.titleLarge) }
            Text("Anyone with this code and your organization sign-in can recover the account. Keep it private.")
            Button({ app.export("convo-recovery-code.txt", "text/plain", "Convo recovery code\n$code\nKeep this private and offline.\n".toByteArray()) }) { Text("Save recovery code") }
            TextButton({ code = "" }) { Text("I saved my code") }
        } else Button({ if (configured) replace = true else create() }) { Text(if (configured) "Replace recovery code" else "Create recovery code") }
    }
    if (replace) Confirm("Replace recovery code?", "The old code will stop working.", "Replace", { replace = false }) { replace = false; create() }
}
@Composable fun PrivacyEditor(app: MainActivity, settings: JSONObject) {
    var lastSeen by remember { mutableStateOf(false) }; var loaded by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { app.call("privacy") { lastSeen = (it as? JSONObject)?.optBoolean("shareLastSeen") ?: false; loaded = true } }
    Column(verticalArrangement = Arrangement.spacedBy(18.dp)) {
        PrivacySwitch("Share last seen", "Allow signed-in people in your organization to see when you last used Convo. Hidden by default; applies to all your devices.", lastSeen, loaded) { value -> app.call("setPrivacy", obj("enabled" to value)) { lastSeen = value } }
        listOf(Triple("confirmExternalLinks", "Confirm before opening links", "Show the destination before leaving Convo."), Triple("readReceipts", "Send read receipts", "Off by default. Delivery status is always shown."), Triple("typingIndicators", "Typing indicators", "Off by default. Direct chats only.")).forEach { (key, title, hint) -> PrivacySwitch(title, hint, settings.optBoolean(key)) { app.call("settings", obj("patch" to obj(key to it))) } }
    }
}
@Composable fun PrivacySwitch(title: String, hint: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f).padding(end = 12.dp)) { Text(title); Text(hint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; Switch(checked, onChange, enabled = enabled) }
}
@Composable fun DevicesEditor(app: MainActivity) {
    var devices by remember { mutableStateOf<List<JSONObject>>(emptyList()) }; var requests by remember { mutableStateOf<List<JSONObject>>(emptyList()) }; var confirm by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(Unit) { while (true) { app.call("devices") { devices = (it as? JSONArray)?.objects().orEmpty() }; app.call("linkRequests") { requests = (it as? JSONArray)?.objects().orEmpty() }; kotlinx.coroutines.delay(3000) } }
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Link a new device", style = MaterialTheme.typography.titleLarge)
        Text("Sign in on the new device. Approve only if its comparison code matches.")
        requests.forEach { r -> Card { Column(Modifier.padding(16.dp)) { Text(r.optString("label")); Text(r.optString("code"), style = MaterialTheme.typography.headlineMedium); Row { TextButton({ app.call("declineLink", obj("request" to r)) }) { Text("Decline") }; Button({ confirm = r }) { Text("Compare codes") } } } } }
        devices.forEach { d -> ActionRow(if (d.optBoolean("current")) "This device" else "${d.optString("platform")} · #${d.optInt("deviceId")}", d.optString("createdAt"), Icons.Outlined.Devices) { if (!d.optBoolean("current")) confirm = d } }
    }
    confirm?.let { value -> val linking = value.has("provisioningId"); Confirm(if (linking) "Do both devices show this code?" else "Unlink device?", if (linking) value.optString("code") else "This device will stop receiving new messages.", if (linking) "Codes match — approve" else "Unlink", { confirm = null }) { confirm = null; app.call(if (linking) "approveLink" else "unlink", if (linking) obj("request" to value) else obj("id" to value.optInt("deviceId"))) } }
}
@Composable fun WallpaperPicker(app: MainActivity, perChat: Boolean = false) {
    val current = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == app.active }
    val selected = if (perChat && current?.has("wallpaper") == true) current.optString("wallpaper") else app.snapshot.optJSONObject("settings")?.optString("wallpaper")
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        listOf("dots", "plain", "ocean", "botanical").chunked(2).forEach { pair -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) { pair.forEach { value ->
            OutlinedCard(onClick = { app.call(if (perChat) "conversation" else "settings", if (perChat) obj("id" to app.active, "patch" to obj("wallpaper" to value)) else obj("patch" to obj("wallpaper" to value))) }, modifier = Modifier.weight(1f), border = androidx.compose.foundation.BorderStroke(if (selected == value) 2.dp else 1.dp, if (selected == value) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant)) { ChatWallpaper(value, Modifier.fillMaxWidth().height(70.dp)) { Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterEnd) { Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = androidx.compose.foundation.shape.RoundedCornerShape(8.dp), modifier = Modifier.padding(12.dp)) { Text("Hello!", Modifier.padding(8.dp)) } } }; Text(value.replaceFirstChar { it.uppercase() }, Modifier.padding(10.dp)) }
        } } }
    }
}
@Composable fun Confirm(title: String, body: String, action: String, dismiss: () -> Unit, accepted: () -> Unit) = AlertDialog(onDismissRequest = dismiss, title = { Text(title) }, text = { Text(body) }, confirmButton = { TextButton(onClick = accepted) { Text(action) } }, dismissButton = { TextButton(onClick = dismiss) { Text("Cancel") } })
