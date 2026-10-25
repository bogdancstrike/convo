package com.convo.android.ui.info

import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.bridge.*
import com.convo.android.i18n.*
import com.convo.android.ui.chats.PillChip
import com.convo.android.ui.theme.*
import com.convo.android.i18n.Text
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Slow-mode intervals offered (seconds; 0 = off), mirroring the shared core (core/memberPolicy.ts). */
val SLOW_MODE_STEPS = listOf(0, 10, 30, 60, 300, 900, 3600)

/** "30 s", "5 min", "1 h". */
fun formatInterval(seconds: Long): String = when {
    seconds % 3600 == 0L -> tr("{count} h").replace("{count}", "${seconds / 3600}")
    seconds % 60 == 0L -> tr("{count} min").replace("{count}", "${seconds / 60}")
    else -> tr("{count} s").replace("{count}", "$seconds")
}

/**
 * Group info: slow mode for owners/admins (specs §30.4). Posting restrictions are in each member's
 * menu; the shared core enforces both when sending and on receipt.
 */
@Composable fun SlowModeSection(app: MainActivity, conversation: String, current: Int) {
    val colors = LocalConvoColors.current
    Column(Modifier.fillMaxWidth().background(colors.panel).padding(horizontal = 20.dp, vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("Slow mode", style = MaterialTheme.typography.titleSmall)
        Text("Members can send one message per interval. Owners and admins are not limited.", style = MaterialTheme.typography.bodySmall, color = colors.textSecondary)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SLOW_MODE_STEPS.forEach { s ->
                PillChip(if (s == 0) tr("Off") else formatInterval(s.toLong()), current == s) { app.call("setMemberPolicy", obj("conversationId" to conversation, "slowModeSeconds" to s)) }
            }
        }
    }
}
