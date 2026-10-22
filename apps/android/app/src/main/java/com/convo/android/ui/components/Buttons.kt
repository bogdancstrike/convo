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

/** The composer's round send / record button (WhatsApp): filled with the action colour. */
@Composable fun RoundActionButton(icon: ImageVector, description: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val colors = LocalConvoColors.current
    FilledIconButton(onClick, modifier.size(48.dp), colors = IconButtonDefaults.filledIconButtonColors(containerColor = colors.actionFill, contentColor = colors.actionText)) {
        Icon(icon, description, Modifier.size(22.dp))
    }
}
