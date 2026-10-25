package com.convo.android.ui.thread

import com.convo.android.R
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.i18n.*
import com.convo.android.ui.components.*
import com.convo.android.ui.media.*
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.net.Uri
import android.view.WindowManager
import android.widget.VideoView
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import org.json.JSONObject
import java.io.File

/**
 * View-once photo/video (specs §30.4): WhatsApp's ① pill. Opening fetches the media straight from
 * the core into memory (never the media cache, gallery or history); closing the viewer consumes it
 * on this phone and the account's other devices. The viewer window is FLAG_SECURE, so Android
 * blocks screenshots and screen recording of it — still best effort (another camera works).
 */
@Composable fun ViewOnceTile(app: MainActivity, message: JSONObject, conversation: String, state: JSONObject) {
    val colors = LocalConvoColors.current
    val kind = state.optString("kind"); val status = state.optString("state")
    val label = if (kind == "video") "Video" else "Photo"
    var busy by remember { mutableStateOf(false) }
    var shown by remember { mutableStateOf<Pair<String, ByteArray>?>(null) }
    val unopened = status == "unopened"
    Row(Modifier.padding(2.dp).clip50().border(1.dp, colors.border, RoundedCornerShape(50)).background(colors.panel, RoundedCornerShape(50))
        .clickable(enabled = unopened && !busy) {
            busy = true
            app.call("openViewOnce", message.targetArgs(conversation)) { value ->
                busy = false
                val result = value as? JSONObject ?: return@call
                shown = result.optString("mime") to app.decode(result.optString("data"))
            }
        }.padding(start = 6.dp, end = 14.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(26.dp).clip(CircleShape).background(if (unopened) colors.accent else Color.Transparent).border(2.dp, if (unopened) colors.accent else colors.textSecondary, CircleShape), contentAlignment = Alignment.Center) {
            RawText("1", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (unopened) Color.White else colors.textSecondary)
        }
        Text(if (busy) "Opening…" else if (status == "opened") "Opened" else label, Modifier.padding(start = 10.dp), fontWeight = if (unopened) FontWeight.SemiBold else FontWeight.Normal,
            color = if (unopened) colors.accentText else colors.textSecondary)
    }
    shown?.let { (mime, bytes) ->
        ViewOnceViewer(mime, bytes) {
            shown = null
            app.call("consumeViewOnce", message.targetArgs(conversation), quiet = true)
        }
    }
}

private fun Modifier.clip50() = this.then(Modifier.clip(RoundedCornerShape(50)))

/** Black full-screen viewer with FLAG_SECURE; the video plays from a private temp file deleted on close. */
@Composable private fun ViewOnceViewer(mime: String, bytes: ByteArray, close: () -> Unit) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val bitmap: ImageBitmap? = remember(bytes) { if (mime.startsWith("image/")) mediaBitmap(bytes) else null }
    val temp = remember(bytes) { if (mime.startsWith("video/")) File(context.cacheDir, "convo-viewonce-${java.util.UUID.randomUUID()}").apply { writeBytes(bytes) } else null }
    DisposableEffect(temp) { onDispose { temp?.delete() } }
    // Secure both the activity (behind the dialog) and the dialog window while the media is shown;
    // the activity's own setting is restored afterwards (debug emulator builds allow screenshots).
    val activity = context as? android.app.Activity
    DisposableEffect(activity) {
        val wasSecure = activity?.window?.attributes?.flags?.and(WindowManager.LayoutParams.FLAG_SECURE) != 0
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { if (!wasSecure) activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
    Dialog(onDismissRequest = close, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, securePolicy = androidx.compose.ui.window.SecureFlagPolicy.SecureOn)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        DisposableEffect(window) {
            if (com.convo.android.BuildConfig.DEBUG) android.util.Log.d("ConvoViewOnce", "secure dialog window found=${window != null}")
            window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE); onDispose { }
        }
        Box(Modifier.fillMaxSize().background(Color.Black)) {
            bitmap?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
            temp?.let { file -> AndroidView(factory = { VideoView(it).apply { setVideoURI(Uri.fromFile(file)); setOnPreparedListener { start() }; setOnCompletionListener { close() } } }, modifier = Modifier.fillMaxSize()) }
            Row(Modifier.fillMaxWidth().statusBarsPadding().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(close) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Close", tint = Color.White) }
                Text("View once · this disappears when you close it", color = Color.White, fontSize = 14.sp)
            }
        }
    }
}
