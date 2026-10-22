@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
package com.convo.android.ui.components

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.bridge.*
import com.convo.android.calls.*
import com.convo.android.i18n.*
import com.convo.android.push.*
import com.convo.android.ui.communities.*
import com.convo.android.ui.chats.*
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONArray
import org.json.JSONObject

@Composable fun PersonAvatar(app: MainActivity, id: String, name: String, size: Int = 44, group: Boolean = false) {
    val photo = app.snapshot.optJSONObject("profiles")?.optJSONObject(id)?.optString("photo")?.takeIf { it.startsWith("data:image/jpeg;base64,") }
    val bitmap = remember(photo) { try { photo?.substringAfter(',')?.let { android.util.Base64.decode(it, 0) }?.let { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() } } catch (_: Exception) { null } }
    val avatarColor = AvatarColors[kotlin.math.abs(id.hashCode().toLong()).rem(AvatarColors.size).toInt()]
    val words = name.removePrefix("@").trim().split(Regex("\\s+")).filter { it.isNotBlank() }
    val initials = if (words.size > 1) "${words.first().first()}${words.last().first()}" else words.firstOrNull()?.take(1) ?: "?"
    Box(Modifier.size(size.dp).clip(CircleShape).background(avatarColor), contentAlignment = Alignment.Center) {
        if (bitmap != null && !group) Image(bitmap, null, Modifier.fillMaxSize(), contentScale = androidx.compose.ui.layout.ContentScale.Crop)
        else if (group) Icon(Icons.Outlined.Group, null, Modifier.size((size * 0.55).dp), tint = Color.White) else RawText(initials.uppercase(), color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = (size * 0.36).sp)
    }
}
@Composable fun ActionRow(label: String, hint: String? = null, icon: ImageVector = Icons.Outlined.ChevronRight, danger: Boolean = false, onClick: () -> Unit) {
    val colors = LocalConvoColors.current
    // WhatsApp settings row: grey icon column, 16 sp label, optional secondary line.
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).heightIn(min = 56.dp).padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, Modifier.size(24.dp), tint = if (danger) colors.dangerText else colors.textSecondary)
        Column(Modifier.weight(1f).padding(start = 24.dp)) {
            Text(label, color = if (danger) colors.dangerText else colors.textPrimary, fontSize = 16.sp)
            if (hint != null) Text(hint, color = colors.textSecondary, fontSize = 13.5.sp)
        }
    }
}

/** A white card on the canvas (WhatsApp/web info and settings sections), optional small title. */
@Composable fun InfoSection(title: String? = null, content: @Composable ColumnScope.() -> Unit) {
    val colors = LocalConvoColors.current
    Column(Modifier.fillMaxWidth().padding(top = 8.dp).background(colors.panel).padding(vertical = 6.dp)) {
        if (title != null) Text(title, Modifier.padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 4.dp), color = colors.textSecondary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
        content()
    }
}

/** Square-ish quick action under the info hero (Audio · Video · Search). */
@Composable fun QuickAction(icon: ImageVector, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    val colors = LocalConvoColors.current
    Column(modifier.clip(RoundedCornerShape(12.dp)).border(1.dp, colors.border, RoundedCornerShape(12.dp)).clickable(enabled = enabled, onClick = onClick).padding(vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally) {
        Icon(icon, label, Modifier.size(24.dp), tint = if (enabled) colors.accentText else colors.textSecondary)
        Text(label, Modifier.padding(top = 6.dp), color = colors.textPrimary, fontSize = 13.sp)
    }
}
