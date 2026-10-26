package com.convo.android.ui

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** The whole app renders on the JVM with a fake core: the chat list shows the snapshot's chats. */
@RunWith(RobolectricTestRunner::class)
class AppSmokeTest {
    init { FakeCore.install() }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun chatListShowsConversations() {
        compose.waitUntil(10_000) { compose.onAllNodes(androidx.compose.ui.test.hasText("Ana Pop")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Ana Pop").assertExists()
        compose.onNodeWithText("See you at 10").assertExists()
    }
}
