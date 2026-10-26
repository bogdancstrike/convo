package com.convo.android.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.RadioButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role

/**
 * A checkbox and its label as one control: the whole row toggles, and accessibility services read
 * the label with the state. (A bare Checkbox next to a Text is announced without a name.)
 */
@Composable fun CheckboxRow(checked: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, label: @Composable RowScope.() -> Unit) {
    Row(modifier.toggleable(checked, enabled = enabled, role = Role.Checkbox, onValueChange = onChange), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, null, enabled = enabled)
        label()
    }
}

/** A radio button and its label as one control (see [CheckboxRow]). */
@Composable fun RadioRow(selected: Boolean, onSelect: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, label: @Composable RowScope.() -> Unit) {
    Row(modifier.selectable(selected, enabled = enabled, role = Role.RadioButton, onClick = onSelect), verticalAlignment = Alignment.CenterVertically) {
        RadioButton(selected, null, enabled = enabled)
        label()
    }
}
