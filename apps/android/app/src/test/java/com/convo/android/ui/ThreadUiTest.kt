package com.convo.android.ui

import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.performTouchInput
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import com.convo.android.Snapshots
import com.convo.android.Snapshots.basic
import com.convo.android.Snapshots.conversation
import com.convo.android.Snapshots.message
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private const val PEER = "11111111-1111-4111-8111-111111111111"

/** The conversation screen: messages, composer and the message menu, as commands to the core. */
@RunWith(RobolectricTestRunner::class)
class ThreadUiTest {
    private val chats = listOf(conversation(PEER, "Ana Pop", preview = "Hello"))
    private val messages = listOf(
        message("m1", PEER, "Hello from Ana") { put("sort", 1_000L) },
        message("m2", Snapshots.ME, "Hi Ana", direction = "out") { put("sort", 2_000L); put("status", "read"); put("editableUntil", System.currentTimeMillis() + 600_000) },
        message("m3", Snapshots.ME, "Old news", direction = "out") { put("sort", 3_000L); put("editableUntil", System.currentTimeMillis() - 1) },
    )

    init {
        FakeCore.install(basic(chats)) {
            // The real core answers "open" with a snapshot of that chat's messages.
            handlers["open"] = { args -> emit("snapshot", basic(chats, messages, active = args.getString("id"))); null }
        }
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun core() = FakeCore.current

    private fun openChat() {
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("Ana Pop")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Ana Pop").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("Hello from Ana", substring = true)).fetchSemanticsNodes().isNotEmpty() }
    }

    /** Message bubbles pad their text so the time fits beside it; match the body as a prefix. */
    private fun bubble(text: String) = compose.onNodeWithText(text, substring = true)

    private fun longPress(text: String) {
        bubble(text).performTouchInput { longClick() }
        compose.waitForIdle()
    }

    private fun last(method: String): JSONObject = core().commands.last { it.first == method }.second

    @Test fun showsIncomingAndOutgoingMessages() {
        openChat()
        bubble("Hello from Ana").assertExists()
        bubble("Hi Ana").assertExists()
    }

    @Test fun headerShowsTheChatTitle() {
        openChat()
        assertTrue(compose.onAllNodes(hasText("Ana Pop")).fetchSemanticsNodes().isNotEmpty())
    }

    @Test fun typingAndSendingSendsTheText() {
        openChat()
        compose.onNode(hasSetTextAction()).performTextInput("See you soon")
        compose.onNodeWithContentDescription("Send message").performClick(); compose.waitForIdle()
        val args = last("send")
        assertEquals(PEER, args.getString("conversationId")); assertEquals("See you soon", args.getString("body"))
    }

    @Test fun emptyComposerOffersTheVoiceButtonNotSend() {
        openChat()
        assertTrue(compose.onAllNodes(androidx.compose.ui.test.hasContentDescription("Send message")).fetchSemanticsNodes().isEmpty())
    }

    @Test fun quickReactionReacts() {
        openChat(); longPress("Hello from Ana")
        compose.onNodeWithText("👍").performClick(); compose.waitForIdle()
        val args = last("react")
        assertEquals("👍", args.getString("emoji")); assertEquals("m1", args.getString("id")); assertEquals(PEER, args.getString("authorId"))
    }

    @Test fun moreReactionsOpensTheEmojiPicker() {
        openChat(); longPress("Hello from Ana")
        compose.onNodeWithContentDescription("More reactions").performClick(); compose.waitForIdle()
        assertTrue(core().commands.none { it.first == "react" })
    }

    @Test fun replyQuotesTheMessage() {
        openChat(); longPress("Hello from Ana")
        compose.onNodeWithText("Reply").performClick(); compose.waitForIdle()
        compose.onNode(hasSetTextAction()).performTextInput("Sure")
        compose.onNodeWithContentDescription("Send message").performClick(); compose.waitForIdle()
        val quote = last("send").getJSONObject("quote")
        assertEquals("m1", quote.getString("messageId")); assertEquals("Hello from Ana", quote.getString("excerpt"))
    }

    @Test fun starStarsTheMessage() {
        openChat(); longPress("Hello from Ana")
        compose.onNodeWithText("Star").performClick(); compose.waitForIdle()
        assertTrue(last("star").getBoolean("value"))
    }

    @Test fun ownMessagesCanBeEdited() {
        openChat(); longPress("Hi Ana")
        compose.onNodeWithText("Edit").assertExists()
    }

    @Test fun editingEndsWhenTheWindowCloses() {
        openChat(); longPress("Old news")
        assertTrue(compose.onAllNodes(hasText("Edit")).fetchSemanticsNodes().isEmpty())
    }

    @Test fun othersMessagesCannotBeEdited() {
        openChat(); longPress("Hello from Ana")
        assertTrue(compose.onAllNodes(hasText("Edit")).fetchSemanticsNodes().isEmpty())
    }

    @Test fun messageInfoIsAvailable() {
        openChat(); longPress("Hi Ana")
        compose.onNodeWithText("Message info").performClick(); compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText("Message info")).fetchSemanticsNodes().isNotEmpty())
    }

    @Test fun forwardOffersTheChats() {
        openChat(); longPress("Hello from Ana")
        compose.onNodeWithText("Forward").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Forward to").assertExists()
    }

    @Test fun selectEntersSelectionMode() {
        openChat(); longPress("Hello from Ana")
        compose.onNodeWithText("Select").performClick(); compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText("1 selected", substring = true)).fetchSemanticsNodes().isNotEmpty())
    }
}
