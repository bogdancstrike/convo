@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package com.convo.android.app

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.bridge.*
import com.convo.android.calls.*
import com.convo.android.i18n.*
import com.convo.android.push.*
import com.convo.android.ui.communities.*
import com.convo.android.ui.chats.*
import com.convo.android.ui.components.*
import com.convo.android.ui.contacts.*
import com.convo.android.ui.info.*
import com.convo.android.ui.linking.*
import com.convo.android.ui.locks.*
import com.convo.android.ui.media.*
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
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
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
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
    // System bars follow the app surface (WhatsApp: light header ⇒ light status bar with dark icons).
    val view = androidx.compose.ui.platform.LocalView.current
    if (!view.isInEditMode) SideEffect {
        val window = (view.context as? android.app.Activity)?.window ?: return@SideEffect
        @Suppress("DEPRECATION") window.statusBarColor = colors.panel.toArgb()
        @Suppress("DEPRECATION") window.navigationBarColor = colors.panel.toArgb()
        androidx.core.view.WindowCompat.getInsetsController(window, view).apply { isAppearanceLightStatusBars = !dark; isAppearanceLightNavigationBars = !dark }
    }
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
                app.route == "info" -> app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == app.active }.let { c -> when {
                    c?.optString("kind") == "direct" -> "Contact info"; c?.optBoolean("adminOnly") == true -> "Channel info"; c?.optString("kind") == "group" -> "Group info"; else -> "Conversation info" } }
                app.route.startsWith("contact:") -> "Contact info"
                app.route == "new" -> "New chat"
                app.route == "new-call" -> "New call"
                app.route == "new-group" -> "New group"
                app.route == "new-channel" -> "New channel"
                app.route == "new-community" -> "New community"
                app.route.startsWith("community:") -> "Community"
                app.route.startsWith("community-onboarding:") -> "Welcome & rules"
                app.route != "list" -> when (app.route) { "storage" -> "Storage and data"; "notifications" -> "Notifications"; "recovery" -> "History and recovery"; "profile" -> "Your profile"; "all-media" -> "All Media"; else -> app.route.replaceFirstChar { it.uppercase() } }
                else -> if (app.selectedTab == "Chats") "Convo" else app.selectedTab
            }
            val colors = LocalConvoColors.current
            val home = app.route == "list"
            Scaffold(snackbarHost = { SnackbarHost(snackbar) }, containerColor = colors.panel, topBar = {
                TopAppBar(windowInsets = TopAppBarDefaults.windowInsets, colors = TopAppBarDefaults.topAppBarColors(containerColor = colors.panel, scrolledContainerColor = colors.panel), title = { Column {
                    if (home) Text(title, maxLines = 1, fontWeight = FontWeight.Bold, fontSize = if (app.selectedTab == "Chats") 24.sp else 22.sp, color = if (app.selectedTab == "Chats") colors.accentText else colors.textPrimary)
                    else if (app.route == "thread") {
                        // WhatsApp header: avatar, name and status line; tapping it opens the info page.
                        val current = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == app.active }
                        Row(Modifier.clip(RoundedCornerShape(8.dp)).clickable { app.route = "info" }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            PersonAvatar(app, app.active ?: "", if (current?.optString("kind") == "note") tr("Note to self") else title, 40, group = current?.optString("kind") == "group")
                            Column(Modifier.padding(start = 10.dp)) {
                                RawText(if (current?.optString("kind") == "note") tr("Note to self") else title, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                                LastSeenLabel(app, app.active ?: "")
                            }
                        }
                    }
                    else Text(title, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                } }, navigationIcon = {
                    if (app.route != "list") IconButton(onClick = app::back) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") }
                }, actions = {
                    if (app.route == "list" && app.selectedTab in listOf("Chats", "Channels", "Unread")) IconButton(onClick = { mediaOpen = true }) { Icon(Icons.Outlined.PermMedia, "Media from all chats") }
                    if (home && app.selectedTab in listOf("Chats", "Channels")) HomeMenu(app)
                    if (app.route == "thread") {
                        val current = app.snapshot.optJSONArray("conversations")?.objects()?.find { it.optString("id") == app.active }
                        if (current != null && current.optString("kind") != "note" && !current.optBoolean("left") && !current.optBoolean("adminOnly") && !current.optBoolean("blocked")) {
                            IconButton(onClick = { app.calls.start(current.optString("id"), true) }, enabled = app.calls.call == null) { Icon(Icons.Outlined.Videocam, "Video call") }
                            IconButton(onClick = { app.calls.start(current.optString("id"), false) }, enabled = app.calls.call == null) { Icon(Icons.Outlined.Call, "Voice call") }
                        }
                        ChatMenu(app) }
                })
            }, bottomBar = {
                if (home) Column {
                  HorizontalDivider(color = colors.border, thickness = 0.5.dp)
                  NavigationBar(containerColor = colors.panel, tonalElevation = 0.dp) {
                    val conversations = app.snapshot.optJSONArray("conversations")?.objects().orEmpty().filter { !it.optBoolean("archived") && it.optString("id") !in app.locks.lockedChats }
                    val unreadChats = conversations.count { !it.optBoolean("adminOnly") && it.optInt("unread") > 0 }
                    val unreadChannels = conversations.count { it.optBoolean("adminOnly") && it.optInt("unread") > 0 }
                    listOf("Chats" to Icons.Outlined.ChatBubbleOutline, "Channels" to Icons.Outlined.Campaign, "Communities" to Icons.Outlined.Groups, "Calls" to Icons.Outlined.Call, "Settings" to Icons.Outlined.AccountCircle).forEach { (label, icon) ->
                        val count = when (label) { "Chats" -> unreadChats; "Channels" -> unreadChannels; else -> 0 }
                        NavigationBarItem(app.selectedTab == label && !mediaOpen, onClick = { app.selectedTab = label; app.route = "list" },
                            colors = NavigationBarItemDefaults.colors(indicatorColor = colors.chipActive, selectedIconColor = colors.chipActiveText, selectedTextColor = colors.textPrimary, unselectedIconColor = colors.textSecondary, unselectedTextColor = colors.textSecondary),
                            icon = { BadgedBox(badge = { if (count > 0) Badge(containerColor = colors.badge, contentColor = colors.badgeText) { RawText(count.toString()) } }) {
                                if (label == "Settings") PersonAvatar(app, app.snapshot.optString("accountId"), app.snapshot.optJSONObject("device")?.label() ?: "You", 24) else Icon(icon, label) } }, label = {
                            // One line at any width: "Communities" must not wrap under its icon.
                            Text(if (label == "Settings") "Profile" else label, maxLines = 1, softWrap = false,
                                style = MaterialTheme.typography.labelSmall.copy(letterSpacing = (-0.1).sp))
                        })
                    }
                  }
                }
            }, floatingActionButton = {
                if (home && app.selectedTab in listOf("Chats", "Channels", "Calls")) FloatingActionButton(onClick = { app.route = when (app.selectedTab) { "Channels" -> "new-channel"; "Calls" -> "new-call"; else -> "new" } },
                    containerColor = colors.actionFill, contentColor = colors.actionText, shape = RoundedCornerShape(16.dp)) {
                    when (app.selectedTab) {
                        "Channels" -> Icon(Icons.Outlined.Campaign, "New channel")
                        "Calls" -> Icon(Icons.Outlined.AddIcCall, "New call")
                        else -> Icon(Icons.Outlined.AddComment, "New chat")
                    }
                }
            }) { padding -> Box(Modifier.padding(padding).fillMaxSize()) {
                Crossfade(targetState = app.route to app.selectedTab, animationSpec = tween(if (app.snapshot.optJSONObject("settings")?.optBoolean("animations", true) != false) 120 else 0), label = "page") { (route, tab) ->
                when {
                    route == "new" -> ContactsPicker(app, onPick = { account -> app.call("newChat", obj("id" to account.optString("accountId"))) { data -> (data as? JSONObject)?.optString("id")?.let(app::openChat) } })
                    // New call (WhatsApp): pick a person, open the chat and ring them.
                    route == "new-call" -> ContactsPicker(app, onPick = { account -> app.call("newChat", obj("id" to account.optString("accountId"))) { data ->
                        (data as? JSONObject)?.optString("id")?.let { id -> app.openChat(id); if (app.calls.call == null) app.calls.start(id, false) } } })
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
        app.snoozeFor?.let { SnoozeDialog(app, it) }
        app.error?.let { message -> AlertDialog(onDismissRequest = { app.error = null }, title = { Text("Convo") }, text = { Text(message) }, confirmButton = { TextButton(onClick = { app.error = null }) { Text("OK") } }) }
        if (serverEdit) AlertDialog(onDismissRequest = { serverEdit = false }, title = { Text("Server address") }, text = { OutlinedTextField(server, { server = it }, label = { Text("HTTPS address") }) }, confirmButton = { TextButton(onClick = { serverEdit = false; app.setServer(server) }) { Text("Save") } }, dismissButton = { TextButton(onClick = { serverEdit = false }) { Text("Cancel") } })
    }
}


/** Header overflow (WhatsApp ⋮): new group/channel/community, and settings. */
@Composable fun HomeMenu(app: MainActivity) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) { Icon(Icons.Outlined.MoreVert, "More options") }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(text = { Text("New group") }, leadingIcon = { Icon(Icons.Outlined.GroupAdd, null) }, onClick = { open = false; app.route = "new-group" })
            DropdownMenuItem(text = { Text("New channel") }, leadingIcon = { Icon(Icons.Outlined.Campaign, null) }, onClick = { open = false; app.route = "new-channel" })
            DropdownMenuItem(text = { Text("New community") }, leadingIcon = { Icon(Icons.Outlined.Groups, null) }, onClick = { open = false; app.route = "new-community" })
            DropdownMenuItem(text = { Text("Settings") }, leadingIcon = { Icon(Icons.Outlined.Settings, null) }, onClick = { open = false; app.selectedTab = "Settings"; app.route = "list" })
        }
    }
}
