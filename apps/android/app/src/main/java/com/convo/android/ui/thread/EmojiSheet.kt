package com.convo.android.ui.thread

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.emoji2.emojipicker.EmojiPickerView

/** Every emoji (categories, recent, skin tones) in a bottom sheet — the "+" after quick reactions. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun EmojiSheet(close: () -> Unit, pick: (String) -> Unit) {
    ModalBottomSheet(onDismissRequest = close) {
        AndroidView(factory = { context -> EmojiPickerView(context).apply { emojiGridColumns = 8; setOnEmojiPickedListener { pick(it.emoji) } } },
            modifier = Modifier.fillMaxWidth().height(380.dp).padding(bottom = 16.dp))
    }
}
