package com.convo.android.ui.components

import com.convo.android.i18n.Icon
import com.convo.android.ui.theme.LocalConvoColors
import androidx.compose.foundation.layout.size
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.draw.clip

/** The composer's round send / record button (WhatsApp): filled with the action colour. */
@Composable fun RoundActionButton(icon: ImageVector, description: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = LocalConvoColors.current
    FilledIconButton(onClick, modifier.size(48.dp), colors = IconButtonDefaults.filledIconButtonColors(containerColor = colors.actionFill, contentColor = colors.actionText)) {
        Icon(icon, description, Modifier.size(22.dp))
    }
}

/** New-chat style action (WhatsApp): accent disc with a white icon, label and optional hint. */
@Composable fun CircleAction(icon: ImageVector, label: String, hint: String? = null, onClick: () -> Unit) {
    val colors = LocalConvoColors.current
    androidx.compose.foundation.layout.Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
        androidx.compose.foundation.layout.Box(Modifier.size(48.dp).clip(CircleShape).background(colors.actionFill), contentAlignment = androidx.compose.ui.Alignment.Center) {
            Icon(icon, null, Modifier.size(24.dp), tint = colors.actionText)
        }
        androidx.compose.foundation.layout.Column(Modifier.weight(1f).padding(start = 16.dp)) {
            com.convo.android.i18n.Text(label, color = colors.textPrimary, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            if (hint != null) com.convo.android.i18n.Text(hint, color = colors.textSecondary, fontSize = 13.sp)
        }
    }
}

/** Small uppercase-free section caption inside lists ("Contacts on Convo"). */
@Composable fun ListCaption(text: String, modifier: Modifier = Modifier) {
    com.convo.android.i18n.Text(text, modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp), color = LocalConvoColors.current.textSecondary, fontSize = 14.sp, fontWeight = FontWeight.Medium)
}
