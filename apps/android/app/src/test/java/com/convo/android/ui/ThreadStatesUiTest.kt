package com.convo.android.ui

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import com.convo.android.Snapshots
import com.convo.android.Snapshots.basic
import com.convo.android.Snapshots.conversation
import com.convo.android.Snapshots.message
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private const val PEER = "11111111-1111-4111-8111-111111111111"

/** A chat in a given state, opened from the list. */
abstract class ThreadStateBase(chat: JSONObject, messages: List<JSONObject>, connection: String = "online", setup: FakeCore.() -> Unit = {}) {
    init {
        val chats = listOf(chat)
        FakeCore.install(basic(chats).put("connection", connection)) {
            handlers["open"] = { args -> emit("snapshot", basic(chats, messages, active = args.getString("id")).put("connection", connection)); null }
            setup()
        }
    }
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    protected fun core() = FakeCore.current
    protected fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()
    protected fun open(title: String, waitFor: String) {
        compose.waitUntil(10_000) { has(title) }
        compose.onNodeWithText(title).performClick()
        compose.waitUntil(10_000) { has(waitFor) }
    }
    protected fun tap(text: String) {
        val m = compose.onAllNodes(androidx.compose.ui.test.hasClickAction() and androidx.compose.ui.test.isEnabled() and (hasText(text) or androidx.compose.ui.test.hasAnyDescendant(hasText(text))), useUnmergedTree = true)
        m[m.fetchSemanticsNodes().size - 1].performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick); compose.waitForIdle()
    }
}

@RunWith(RobolectricTestRunner::class)
class OfflineThreadTest : ThreadStateBase(conversation(PEER, "Ana Pop"), listOf(message("m1", PEER, "hi")), connection = "offline") {
    @Test fun saysMessagesWaitForTheConnection() { open("Ana Pop", "hi"); assertTrue(has("Waiting for connection. Messages will send when you reconnect.")) }
}

@RunWith(RobolectricTestRunner::class)
class IdentityChangedThreadTest : ThreadStateBase(conversation(PEER, "Ana Pop") { put("identityChangedAt", 1_000L) }, listOf(message("m1", PEER, "new phone"))) {
    @Test fun asksToReviewTheNewIdentity() {
        open("Ana Pop", "new phone")
        assertTrue(has("Ana Pop’s security identity changed"))
        compose.onNodeWithText("Dismiss").performClick(); compose.waitForIdle()
        assertEquals(PEER, core().commands.last { it.first == "acknowledgeIdentityChange" }.second.getString("id"))
    }

    @Test fun reviewOpensTheContactInfo() {
        open("Ana Pop", "new phone")
        compose.onNodeWithText("Review").performClick(); compose.waitForIdle()
        assertEquals("info", compose.activity.route)
    }
}

@RunWith(RobolectricTestRunner::class)
class UntrustedGroupThreadTest : ThreadStateBase(conversation("g:grp", "Night shift", kind = "group"), listOf(message("m1", PEER, "hello group")), setup = {
    handlers["group"] = { JSONObject().put("members", JSONArray()).put("untrustedDevices", JSONArray().put(JSONObject().put("accountId", PEER).put("deviceId", 3))) }
}) {
    @Test fun sendingPausesWithAnExplanation() {
        open("Night shift", "hello group")
        compose.waitUntil(5_000) { has("never vouched for") }
    }
}

@RunWith(RobolectricTestRunner::class)
class PinnedThreadTest : ThreadStateBase(
    conversation(PEER, "Ana Pop") { put("pinnedMessages", JSONArray().put(JSONObject().put("authorId", PEER).put("id", "m1").put("at", 1)).put(JSONObject().put("authorId", Snapshots.ME).put("id", "m2").put("at", 2))) },
    listOf(message("m1", PEER, "Door code 4711") { put("sort", 1_000L) }, message("m2", Snapshots.ME, "Wifi: convo-guest", direction = "out") { put("sort", 2_000L) }),
) {
    @Test fun pinnedMessagesCycleInTheBanner() {
        open("Ana Pop", "Door code")
        assertTrue(has("Pinned 1 of 2"))
        tap("Pinned 1 of 2")
        assertTrue(has("Pinned 2 of 2"))
    }
}

@RunWith(RobolectricTestRunner::class)
class QuotedThreadTest : ThreadStateBase(conversation(PEER, "Ana Pop"), listOf(
    message("m1", PEER, "Where is the meeting?") { put("sort", 1_000L) },
    message("m2", Snapshots.ME, "Room 4", direction = "out") { put("sort", 2_000L); put("quote", JSONObject().put("authorId", PEER).put("messageId", "m1").put("excerpt", "Where is the meeting?")) },
    message("m3", Snapshots.ME, "See above", direction = "out") { put("sort", 3_000L); put("quote", JSONObject().put("authorId", PEER).put("messageId", "gone").put("excerpt", "")) },
), setup = { handlers["account"] = { JSONObject().put("accountId", PEER).put("username", "ana").put("displayName", "Ana Pop") } }) {
    @Test fun aQuoteShowsItsAuthorAndExcerpt() {
        open("Ana Pop", "Room 4")
        assertTrue(compose.onAllNodes(hasText("Where is the meeting?", substring = true)).fetchSemanticsNodes().size >= 2)
    }

    @Test fun aQuoteOfAMissingMessageSaysSo() {
        open("Ana Pop", "See above")
        assertTrue(has("Original message unavailable"))
        // The quote box is the innermost clickable around its excerpt.
        tap("Original message unavailable")
        compose.waitForIdle()
        assertEquals("Original message unavailable", compose.activity.notice)
    }
}

@RunWith(RobolectricTestRunner::class)
class AttachmentThreadTest : ThreadStateBase(conversation(PEER, "Ana Pop"), listOf(
    message("m1", PEER, "") { put("attachments", JSONArray().put(JSONObject().put("attachmentId", "att1").put("fileName", "report.pdf").put("contentType", "application/pdf").put("size", 2048))) },
), setup = { handlers["download"] = { JSONObject().put("data", "JVBERi0xLjQK") } }) {
    @Test fun documentsShowNameAndOpenInTheViewer() {
        open("Ana Pop", "report.pdf")
        compose.onNode(androidx.compose.ui.test.hasClickAction() and androidx.compose.ui.test.hasAnyChild(androidx.compose.ui.test.hasContentDescription("View or download report.pdf")), useUnmergedTree = true)
            .performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick); compose.waitForIdle()
        compose.waitUntil(5_000) { core().commands.any { it.first == "download" } }
        assertEquals(0, core().commands.last { it.first == "download" }.second.getInt("index"))
        compose.waitUntil(5_000) { has("This file is ready to save.") }
    }
}
