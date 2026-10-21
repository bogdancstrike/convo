@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package com.convo.android

import android.content.Intent
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.*
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

@Composable fun ConvoTheme(preference: String, content: @Composable () -> Unit) {
    val dark = preference == "dark" || (preference == "system" && isSystemInDarkTheme())
    val colors = if (dark) DarkConvoColors else LightConvoColors
    val scheme = (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = colors.actionFill, onPrimary = colors.actionText,
        secondary = colors.accentText, onSecondary = colors.actionText,
        secondaryContainer = colors.bubbleOut, onSecondaryContainer = colors.textPrimary,
        primaryContainer = colors.chipActive, onPrimaryContainer = colors.chipActiveText,
        background = colors.canvas, onBackground = colors.textPrimary,
        surface = colors.panel, onSurface = colors.textPrimary,
        surfaceVariant = colors.panelRaised, onSurfaceVariant = colors.textSecondary,
        outline = colors.border, outlineVariant = colors.border,
        error = colors.dangerText, surfaceTint = colors.panel,
        surfaceContainer = colors.rail, surfaceContainerHigh = colors.panelRaised,
        surfaceContainerHighest = colors.panelRaised, surfaceContainerLow = colors.panel,
        surfaceContainerLowest = colors.canvas,
    )
    CompositionLocalProvider(LocalConvoColors provides colors) {
        MaterialTheme(colorScheme = scheme, shapes = Shapes(
            extraSmall = RoundedCornerShape(8.dp), small = RoundedCornerShape(8.dp),
            medium = RoundedCornerShape(12.dp), large = RoundedCornerShape(18.dp),
            extraLarge = RoundedCornerShape(18.dp),
        ), content = content)
    }
}
@Composable fun ConvoApp(app: MainActivity) {
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(app.notice) { app.notice?.let { message -> snackbar.showSnackbar(tr(message), duration = SnackbarDuration.Short); if (app.notice == message) app.notice = null } }
    BackHandler(app.phase == "ready" && (app.route != "list" || app.selectedTab != "Chats")) { app.back() }
    var mediaOpen by remember { mutableStateOf(false) }
    var serverEdit by remember { mutableStateOf(false) }; var server by remember { mutableStateOf(app.serverAddress()) }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        if (app.phase != "ready") {
            Column(Modifier.fillMaxSize().padding(28.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Image(androidx.compose.ui.res.painterResource(R.drawable.convo_logo), "Convo", Modifier.size(64.dp))
                Text("Convo", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(16.dp))
                when (app.phase) {
                    "loading" -> { CircularProgressIndicator(); Text("Preparing your encrypted messages…", Modifier.padding(top = 18.dp)) }
                    "link", "linkEnded" -> {
                        Text("Link this phone", style = MaterialTheme.typography.titleLarge)
                        Text("On a trusted device, open Settings → Devices. Approve only if both devices show this code.", Modifier.padding(vertical = 16.dp))
                        if (app.phase == "link" && app.linkCode.isNotBlank()) LinkQr(app.linkCode)
                        Text(app.linkCode, style = MaterialTheme.typography.headlineMedium, color = MaterialTheme.colorScheme.primary)
                        Text("Uploaded encrypted history will follow your account after approval.", Modifier.padding(vertical = 16.dp))
                        TextButton(onClick = { app.call("newLink") }) { Text("Get a new code") }
                        var code by remember { mutableStateOf("") }; var recovering by remember { mutableStateOf(false) }
                        TextButton(onClick = { recovering = !recovering }) { Text("Lost every device? Use a recovery code") }
                        if (recovering) {
                            OutlinedTextField(code, { code = it }, label = { Text("Recovery code") }, modifier = Modifier.fillMaxWidth())
                            Text("Recovery signs out lost devices and restores uploaded encrypted history.", style = MaterialTheme.typography.bodySmall)
                            Button(onClick = { app.call("recover", obj("code" to code)) }, enabled = code.replace("-", "").trim().length == 64) { Text("Recover account") }
                        }
                    }
                    else -> {
                        Text("Private messaging for your organization", style = MaterialTheme.typography.titleLarge)
                        Text("Messages and attachments are encrypted on this device. This development app uses the bundled browser protocol engine; native storage certification is still in progress.", Modifier.padding(vertical = 20.dp))
                        Button(onClick = app::signIn) { Text("Sign in with your organization") }
                        TextButton(onClick = { serverEdit = true }) { Text(app.serverAddress()) }
                        if (app.phase == "error") Text("Could not initialize secure local storage. Retry after restarting the app.", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        } else {
            val title = when {
                app.route == "thread" -> app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == app.active }?.optString("title") ?: "Chat"
                app.route == "info" -> "Conversation info"
                app.route.startsWith("contact:") -> "Contact info"
                app.route == "new" -> "New chat"
                app.route == "new-group" -> "New group"
                app.route == "new-channel" -> "New channel"
                app.route == "new-community" -> "New community"
                app.route.startsWith("community:") -> "Community"
                app.route.startsWith("community-onboarding:") -> "Welcome & rules"
                app.route != "list" -> when (app.route) { "storage" -> "Storage and data"; "notifications" -> "Notifications"; "recovery" -> "History and recovery"; "profile" -> "Your profile"; "all-media" -> "All Media"; else -> app.route.replaceFirstChar { it.uppercase() } }
                else -> if (app.selectedTab == "Chats") "Convo" else app.selectedTab
            }
            Scaffold(snackbarHost = { SnackbarHost(snackbar) }, topBar = {
                TopAppBar(title = { Column {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) { if (app.route == "list" && app.selectedTab == "Chats") Image(androidx.compose.ui.res.painterResource(R.drawable.convo_logo), null, Modifier.size(30.dp)); Text(title, maxLines = 1, style = MaterialTheme.typography.titleLarge) }
                    if (app.route == "thread") LastSeenLabel(app, app.active ?: "")
                } }, navigationIcon = {
                    if (app.route != "list") IconButton(onClick = app::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") }
                }, actions = {
                    if (app.route == "list" && app.selectedTab in listOf("Chats", "Channels", "Unread")) IconButton(onClick = { mediaOpen = true }) { Icon(Icons.Outlined.PermMedia, "Media from all chats") }
                    if (app.route == "list" && app.selectedTab in listOf("Chats", "Channels", "Unread")) IconButton(onClick = { app.route = if (app.selectedTab == "Channels") "new-channel" else "new" }) { Icon(Icons.Outlined.AddComment, "New chat") }
                    if (app.route == "thread") {
                        val current = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == app.active }
                        if (current != null && current.optString("kind") != "note" && !current.optBoolean("left") && !current.optBoolean("adminOnly") && !current.optBoolean("blocked")) {
                            IconButton(onClick = { app.calls.start(current.optString("id"), true) }, enabled = app.calls.call == null) { Icon(Icons.Outlined.Videocam, "Video call") }
                            IconButton(onClick = { app.calls.start(current.optString("id"), false) }, enabled = app.calls.call == null) { Icon(Icons.Outlined.Call, "Voice call") }
                        }
                        IconButton(onClick = { app.threadSearch = !app.threadSearch }) { Icon(Icons.Outlined.Search, "Search this chat") }; IconButton(onClick = { app.route = "info" }) { Icon(Icons.Outlined.Info, "Conversation info") }; ChatMenu(app) }
                })
            }, bottomBar = {
                if (app.route == "list") NavigationBar {
                    listOf("Chats" to Icons.Outlined.ChatBubbleOutline, "Channels" to Icons.Outlined.Campaign, "Communities" to Icons.Outlined.Groups, "Calls" to Icons.Outlined.Call, "Settings" to Icons.Outlined.AccountCircle).forEach { (label, icon) ->
                        NavigationBarItem(app.selectedTab == label && !mediaOpen, onClick = { if (label == "Media") mediaOpen = true else { app.selectedTab = label; app.route = "list" } }, icon = { if (label == "Settings") PersonAvatar(app, app.snapshot.optString("accountId"), app.snapshot.optJSONObject("device")?.label() ?: "You", 24) else Icon(icon, label) }, label = { Text(if (label == "Settings") "Profile" else label) })
                    }
                }
            }) { padding -> Box(Modifier.padding(padding).fillMaxSize()) {
                Crossfade(targetState = app.route to app.selectedTab, animationSpec = tween(if (app.snapshot.optJSONObject("settings")?.optBoolean("animations", true) != false) 120 else 0), label = "page") { (route, tab) ->
                when {
                    route == "new" -> ContactsPicker(app, onPick = { account -> app.call("newChat", obj("id" to account.optString("accountId"))) { data -> (data as? JSONObject)?.optString("id")?.let(app::openChat) } })
                    route == "new-group" || route == "new-channel" -> GroupWizard(app, route == "new-channel")
                    (route == "thread" || route == "info" || route == "media" || route == "starred") && app.locks.locked(app.active) && app.locks.unlockedChat != app.active -> LockedChatGate(app, app.active!!)
                    route == "thread" -> NativeThread(app)
                    route == "info" -> ConversationInfo(app)
                    route.startsWith("contact:") -> ContactInfo(app, route.substringAfter(':'))
                    route == "all-media" -> MediaBrowser(app) { app.route = "list" }
                    route == "media" -> MediaBrowser(app, app.active) { app.route = "info" }
                    route == "starred" -> NativeThread(app, starredOnly = true)
                    route == "appearance" -> WallpaperPicker(app, perChat = true)
                    route == "new-community" -> NewCommunity(app)
                    route.startsWith("community:") -> CommunityDetail(app, route.substringAfter(':'))
                    route.startsWith("community-onboarding:") -> OnboardingEditor(app, route.substringAfter(':'))
                    tab == "Settings" -> NativeSettings(app)
                    tab == "Calls" -> CallsTab(app)
                    tab == "Communities" -> CommunitiesTab(app)
                    else -> ChatList(app, tab == "Channels", tab == "Unread")
                }
                }
            } }
        }
        if (mediaOpen && app.phase == "ready") MediaBrowser(app) { mediaOpen = false }
        app.error?.let { message -> AlertDialog(onDismissRequest = { app.error = null }, title = { Text("Convo") }, text = { Text(message) }, confirmButton = { TextButton(onClick = { app.error = null }) { Text("OK") } }) }
        if (serverEdit) AlertDialog(onDismissRequest = { serverEdit = false }, title = { Text("Server address") }, text = { OutlinedTextField(server, { server = it }, label = { Text("HTTPS address") }) }, confirmButton = { TextButton(onClick = { serverEdit = false; app.setServer(server) }) { Text("Save") } }, dismissButton = { TextButton(onClick = { serverEdit = false }) { Text("Cancel") } })
    }
}

@Composable fun PersonAvatar(app: MainActivity, id: String, name: String, size: Int = 44, group: Boolean = false) {
    val photo = app.snapshot.optJSONObject("profiles")?.optJSONObject(id)?.optString("photo")?.takeIf { it.startsWith("data:image/jpeg;base64,") }
    val bitmap = remember(photo) { try { photo?.substringAfter(',')?.let { android.util.Base64.decode(it, 0) }?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } } catch (_: Exception) { null } }
    val avatarColor = AvatarColors[kotlin.math.abs(id.hashCode().toLong()).rem(AvatarColors.size).toInt()]
    val words = name.removePrefix("@").trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    val initials = if (words.size > 1) "${words.first().first()}${words.last().first()}" else words.firstOrNull()?.take(1) ?: "?"
    Box(Modifier.size(size.dp).clip(CircleShape).background(avatarColor), contentAlignment = Alignment.Center) {
        if (bitmap != null && !group) Image(bitmap, null, Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
        else if (group) Icon(Icons.Outlined.Group, null, tint = Color.White) else Text(initials.uppercase(), color = Color.White, fontWeight = FontWeight.SemiBold)
    }
}
@Composable fun ActionRow(label: String, hint: String? = null, icon: ImageVector = Icons.Outlined.ChevronRight, danger: Boolean = false, onClick: () -> Unit) {
    ListItem(headlineContent = { Text(label, color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface) }, supportingContent = hint?.let { { Text(it) } }, leadingContent = { Icon(icon, null, tint = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary) }, modifier = Modifier.clickable(onClick = onClick).heightIn(min = 64.dp))
}
@Composable fun ChatList(app: MainActivity, channels: Boolean, unreadOnly: Boolean = false) {
    var query by remember { mutableStateOf("") }; var matches by remember { mutableStateOf(emptyList<String>()) }; var archived by remember { mutableStateOf(false) }
    // Locked chats are listed only after authenticating, never in ordinary lists or search.
    var showLocked by remember { mutableStateOf(false) }
    var unreadChip by remember { mutableStateOf(unreadOnly) }
    val locked = app.locks.lockedChats
    LaunchedEffect(query) { if (query.isBlank()) matches = emptyList() else { kotlinx.coroutines.delay(200); app.call("search", obj("query" to query)) { result -> matches = (result as? JSONArray)?.objects()?.map { it.optString("conversationId") }?.filter { it !in app.locks.lockedChats } ?: emptyList() } } }
    val conversations = app.snapshot.optJSONArray("conversations")?.objects().orEmpty().filter { (it.optString("id") in locked) == showLocked }.filter { showLocked || (if (unreadChip) it.optInt("unread") > 0 else it.optBoolean("adminOnly") == channels) && it.optBoolean("archived") == archived && (query.isBlank() || it.optString("title").contains(query, true) || it.optString("id") in matches) }
    Column {
        OutlinedTextField(query, { query = it }, modifier = Modifier.fillMaxWidth().padding(12.dp), singleLine = true, placeholder = { Text("Search or start a new chat") }, leadingIcon = { Icon(Icons.Outlined.Search, null) })
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(!archived && !showLocked, { archived = false; showLocked = false }, label = { Text("All") }); FilterChip(archived && !showLocked, { archived = true; showLocked = false }, label = { Text("Archived") }); FilterChip(unreadChip && !showLocked, { unreadChip = !unreadChip; showLocked = false }, label = { Text("Unread") })
            if (locked.isNotEmpty()) FilterChip(showLocked, { if (showLocked) showLocked = false else app.locks.authenticate("Show locked chats", "Confirm it’s you") { showLocked = true } },
                label = { Text("Locked chats") }, leadingIcon = { Icon(Icons.Outlined.Lock, null, Modifier.size(16.dp)) })
        }
        LaunchedEffect(app.locks.appUnlocked) { if (!app.locks.appUnlocked) showLocked = false }
        LazyColumn { items(conversations, key = { it.optString("id") }) { c ->
            Row(Modifier.fillMaxWidth().clickable { if (showLocked) app.locks.unlockedChat = c.optString("id"); app.openChat(c.optString("id")) }.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                PersonAvatar(app, c.optString("id"), c.optString("title"), group = c.optString("kind") == "group")
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(if (c.optString("kind") == "note") "Note to self" else c.optString("title"), fontWeight = FontWeight.SemiBold)
                    RawText(c.optString("preview").let { p -> if (p in setOf("📷 Photo", "🎤 Voice message", "📎 File")) tr(p) else p }, maxLines = 1, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (c.optBoolean("request")) SuggestionChip({}, label = { Text("Request") }, modifier = Modifier.padding(end = 4.dp))
                if (c.optBoolean("pinned")) Icon(Icons.Outlined.PushPin, "Pinned", Modifier.size(16.dp))
                if (c.optBoolean("mentioned") && c.optInt("unread") > 0) RawText("@ ", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                if (c.optInt("unread") > 0) Badge { Text(c.optInt("unread").toString()) }
                ConversationQuickMenu(app, c)
            }
        }
        if (conversations.isEmpty()) item { Text(if (unreadOnly) "You’re all caught up. New unread messages will appear here." else if (channels) "Create a channel to share announcements." else "Start a conversation with someone in your organization.", Modifier.padding(24.dp), color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}
@Composable fun LastSeenLabel(app: MainActivity, id: String) {
    var at by remember(id) { mutableStateOf("") }
    LaunchedEffect(id) { if (id.startsWith("g:")) return@LaunchedEffect; while (true) { app.call("lastSeen", obj("id" to id), quiet = true) { value -> at = (value as? JSONObject)?.optString("at")?.takeUnless { it == "null" } ?: "" }; kotlinx.coroutines.delay(10000) } }
    val seen = try { java.time.Instant.parse(at).atZone(java.time.ZoneId.systemDefault()) } catch (_: Exception) { null }
    if (seen != null) Text(if (seen.toLocalDate() == java.time.LocalDate.now()) "Last seen today: ${seen.format(java.time.format.DateTimeFormatter.ofPattern("HH:mm"))}" else "Last seen on ${seen.format(java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm"))}", style = MaterialTheme.typography.bodySmall)
}

@Composable fun ConversationQuickMenu(app: MainActivity, conversation: JSONObject) {
    var open by remember { mutableStateOf(false) }
    Box { IconButton(onClick = { open = true }) { Icon(Icons.Outlined.MoreVert, "Chat options") }
        DropdownMenu(open, { open = false }) { ConversationMenuItems(app, conversation) { open = false } }
    }
}
@Composable fun ChatMenu(app: MainActivity) {
    val c = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == app.active } ?: return
    var open by remember { mutableStateOf(false) }
    Box { IconButton(onClick = { open = true }) { Icon(Icons.Outlined.MoreVert, "Chat options") }; DropdownMenu(open, { open = false }) { ConversationMenuItems(app, c) { open = false } } }
}
@Composable fun ConversationMenuItems(app: MainActivity, c: JSONObject, close: () -> Unit) {
    var confirm by remember { mutableStateOf("") }
    listOf("Pin chat" to "pinned", "Archive chat" to "archived", "Mute notifications" to "muted").forEach { (label, key) -> DropdownMenuItem(text = { Text(if (c.optBoolean(key)) when(key) { "pinned" -> "Unpin chat"; "archived" -> "Unarchive chat"; else -> "Unmute notifications" } else label) }, onClick = { app.call("conversation", obj("id" to c.optString("id"), "patch" to obj(key to !c.optBoolean(key)))); close() }) }
    if (c.optString("kind") == "group" && !c.optBoolean("left")) DropdownMenuItem(text = { Text(if (c.optBoolean("adminOnly")) "Leave channel" else "Leave group", color = MaterialTheme.colorScheme.error) },
        leadingIcon = { Icon(Icons.Outlined.Logout, null, tint = MaterialTheme.colorScheme.error) }, onClick = { confirm = "leave" })
    if (c.optString("kind") == "group") DropdownMenuItem(text = { Text(if (c.optString("notify") == "mentions") "Notify for all messages" else "Notify only for mentions") }, leadingIcon = { Icon(Icons.Outlined.AlternateEmail, null) },
        onClick = { close(); app.call("conversation", obj("id" to c.optString("id"), "patch" to obj("notify" to if (c.optString("notify") == "mentions") JSONObject.NULL else "mentions"))) })
    if (c.optString("kind") == "direct") {
        val blocked = c.optBoolean("blocked")
        DropdownMenuItem(text = { Text(if (blocked) "Unblock" else "Block contact", color = if (blocked) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.error) }, leadingIcon = { Icon(Icons.Outlined.Block, null) },
            onClick = { if (blocked) { close(); app.call("block", obj("id" to c.optString("id"), "blocked" to false), success = "Contact unblocked") } else confirm = "block" })
    }
    val chatLocked = app.locks.locked(c.optString("id"))
    if (chatLocked || app.locks.passkey == true) DropdownMenuItem(text = { Text(if (chatLocked) "Stop requiring authentication" else "Require authentication to open") }, leadingIcon = { Icon(Icons.Outlined.Lock, null) }, onClick = {
        close(); app.locks.setChatLocked(c.optString("id"), !chatLocked) { app.notice = if (chatLocked) "Chat unlocked" else "Chat locked"; if (!chatLocked && app.route != "list") app.back() }
    })
    DropdownMenuItem(text = { Text("Clear chat", color = MaterialTheme.colorScheme.error) }, onClick = { confirm = "clear" })
    DropdownMenuItem(text = { Text("Delete chat", color = MaterialTheme.colorScheme.error) }, onClick = { confirm = "deleteChat" })
    if (confirm == "leave") AlertDialog(onDismissRequest = { confirm = "" }, title = { Text(if (c.optBoolean("adminOnly")) "Leave channel?" else "Leave group?") },
        text = { Text("You keep the history on your devices but stop receiving new messages.") },
        confirmButton = { TextButton({ confirm = ""; close(); app.call("leaveGroup", obj("id" to c.optString("id")), quiet = true) { if (it == null) app.error = tr("You are the only owner. Make another member owner first, then leave.") } }) { Text("Leave", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton({ confirm = "" }) { Text("Cancel") } })
    else if (confirm == "block") AlertDialog(onDismissRequest = { confirm = "" }, title = { Text("Block contact?") },
        text = { Text("Their messages and calls will no longer reach you, and they won’t be told.") },
        confirmButton = { TextButton({ confirm = ""; close(); app.call("block", obj("id" to c.optString("id"), "blocked" to true), success = "Contact blocked") }) { Text("Block", color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton({ confirm = "" }) { Text("Cancel") } })
    else     if (confirm.isNotBlank()) AlertDialog(onDismissRequest = { confirm = "" }, title = { Text(if (confirm == "clear") "Clear chat?" else "Delete chat?") }, text = { Text("This removes the local copy on this device. Other participants keep their messages.") }, confirmButton = { TextButton(onClick = { app.call(confirm, obj("id" to c.optString("id"))); confirm = ""; close(); if (c.optString("id") == app.active) app.back() }) { Text("Remove", color = MaterialTheme.colorScheme.error) } }, dismissButton = { TextButton(onClick = { confirm = "" }) { Text("Cancel") } })
}
