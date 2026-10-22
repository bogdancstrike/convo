package com.convo.android.ui.components

import com.convo.android.i18n.Icon
import com.convo.android.i18n.Text
import com.convo.android.ui.theme.LocalConvoColors
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Empty tab/list (web `.empty` and feature intros): tinted icon disc, title, explanation, action. */
@Composable fun EmptyState(icon: ImageVector, title: String, body: String, modifier: Modifier = Modifier, action: String? = null, onAction: () -> Unit = {}) {
    val colors = LocalConvoColors.current
    Column(modifier.fillMaxWidth().padding(horizontal = 36.dp, vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(96.dp).clip(CircleShape).background(colors.chipActive), contentAlignment = Alignment.Center) {
            Icon(icon, null, Modifier.size(44.dp), tint = colors.accentText)
        }
        Text(title, Modifier.padding(top = 20.dp), color = colors.textPrimary, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(body, Modifier.padding(top = 8.dp), color = colors.textSecondary, fontSize = 15.sp, textAlign = TextAlign.Center)
        if (action != null) Button(onAction, Modifier.padding(top = 20.dp), colors = ButtonDefaults.buttonColors(containerColor = colors.actionFill, contentColor = colors.actionText)) { Text(action) }
    }
}
