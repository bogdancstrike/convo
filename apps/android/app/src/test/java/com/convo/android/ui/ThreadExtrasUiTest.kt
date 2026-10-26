package com.convo.android.ui

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import com.convo.android.Snapshots
import com.convo.android.Snapshots.message
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private const val AUTHOR = "11111111-1111-4111-8111-111111111111"
private const val HOUR = 3_600_000L

private fun ackRequest(due: Long? = null, expires: Long? = null) = JSONObject()
    .put("audience", JSONArray().put(Snapshots.ME)).put("reviewers", JSONArray().put(AUTHOR))
    .apply { due?.let { put("due", it) }; expires?.let { put("expires", it) } }

/** "Acknowledge this announcement": pending, sent, updated, overdue and closed. */
@RunWith(RobolectricTestRunner::class)
class AckRequestUiTest : CardUiBase(listOf(
    message("a1", AUTHOR, "New safety rules") { put("ackRequest", ackRequest(due = System.currentTimeMillis() + 24 * HOUR)); put("ackNames", JSONObject().put(AUTHOR, "Ana Pop")) },
)) {
    @Test fun askedPeopleCanAcknowledge() {
        openChat("New safety rules")
        assertTrue(has("Acknowledgement requested")); assertTrue(has("Due ")); assertTrue(has("Your response goes only to: Ana Pop"))
        tap("I acknowledge this announcement")
        val args = last("acknowledge"); assertEquals("a1", args.getString("id")); assertEquals(AUTHOR, args.getString("authorId"))
    }
}

@RunWith(RobolectricTestRunner::class)
class AckSentUiTest : CardUiBase(listOf(
    message("a2", AUTHOR, "Read the handbook") { put("ackRequest", ackRequest()); put("myAck", JSONObject().put("revision", 0).put("at", 1).put("pending", JSONArray())) },
)) {
    @Test fun aSentAcknowledgementCanBeWithdrawnAfterConfirming() {
        openChat("Read the handbook")
        assertTrue(has("Acknowledgement sent"))
        tap("Withdraw")
        assertTrue(has("Withdraw your acknowledgement?"))
        assertTrue(core().commands.none { it.first == "withdrawAcknowledgement" })
    }
}

@RunWith(RobolectricTestRunner::class)
class AckUpdatedUiTest : CardUiBase(listOf(
    message("a3", AUTHOR, "Policy v2") { put("revision", 2); put("ackRequest", ackRequest(due = System.currentTimeMillis() - HOUR)); put("myAck", JSONObject().put("revision", 1).put("at", 1).put("pending", JSONArray())) },
)) {
    @Test fun anEditAsksAgainAndShowsOverdue() {
        openChat("Policy v2")
        assertTrue(has("Updated — please acknowledge again")); assertTrue(has("Was due "))
        assertTrue(has("I acknowledge this announcement"))
    }
}

@RunWith(RobolectricTestRunner::class)
class AckClosedUiTest : CardUiBase(listOf(
    message("a4", AUTHOR, "Old notice") { put("ackRequest", ackRequest(expires = System.currentTimeMillis() - HOUR)) },
)) {
    @Test fun closedRequestsTakeNoResponses() {
        openChat("Old notice")
        assertTrue(has("Closed — responses are no longer accepted"))
        assertTrue(compose.onAllNodes(hasText("I acknowledge this announcement")).fetchSemanticsNodes().isEmpty())
    }
}

/** View-once media: a tile that opens once, then shows "Opened". */
@RunWith(RobolectricTestRunner::class)
class ViewOnceUiTest : CardUiBase(listOf(
    message("v1", AUTHOR, "") { put("viewOnce", JSONObject().put("kind", "photo").put("state", "unopened")) },
    message("v2", AUTHOR, "") { put("sort", 3_000L); put("viewOnce", JSONObject().put("kind", "video").put("state", "opened")) },
)) {
    @Test fun anUnopenedPhotoOpensThroughTheCore() {
        core().handlers["openViewOnce"] = { null }
        openChat("Photo")
        tap("Photo")
        assertEquals("v1", last("openViewOnce").getString("id"))
    }

    @Test fun anOpenedOneCannotBeOpenedAgain() {
        openChat("Opened")
        assertTrue(compose.onAllNodes(androidx.compose.ui.test.hasClickAction() and androidx.compose.ui.test.isEnabled() and hasText("Opened"), useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
    }
}

/** Abuse reports received by a security contact. */
@RunWith(RobolectricTestRunner::class)
class ReportCardUiTest : CardUiBase(listOf(
    message("r1", AUTHOR, "⚠️ Abuse report") { put("report", JSONObject().put("chat", JSONObject().put("title", "Night shift")).put("reported", JSONObject().put("name", "Mallory")).put("reason", "spam links").put("messages", JSONArray())) },
)) {
    @Test fun showsWhereAndAboutWhom() {
        openChat("Abuse report")
        assertTrue(has("From chat “Night shift”")); assertTrue(has("about Mallory"))
    }
}

/** Sticker sheet: bundled packs send stickers into the chat. */
@RunWith(RobolectricTestRunner::class)
class StickerSheetUiTest : CardUiBase(listOf(message("m1", AUTHOR, "hi"))) {
    @Test fun choosingAStickerSendsIt() {
        core().handlers["stickerPacks"] = { JSONArray().put(JSONObject().put("id", "basics").put("title", "Basics").put("stickers", JSONArray().put(JSONObject().put("id", "thumbs-up").put("alt", "Thumbs up").put("emoji", "👍")))) }
        core().handlers["stickerCollection"] = { JSONObject().put("favorites", JSONArray()).put("custom", JSONArray()) }
        openChat("hi")
        compose.onNodeWithContentDescription("Stickers").performClick(); compose.waitForIdle()
        compose.waitUntil(5_000) { compose.onAllNodes(androidx.compose.ui.test.hasContentDescription("Thumbs up", substring = true), useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty() }
        // The tile merges its image's description, so TalkBack announces the sticker on the button.
        compose.onAllNodes(androidx.compose.ui.test.hasContentDescription("Thumbs up", substring = true) and androidx.compose.ui.test.hasClickAction())[0]
            .performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.OnClick); compose.waitForIdle()
        val send = last("sendSticker"); assertEquals("basics", send.getString("pack")); assertEquals("thumbs-up", send.getString("id"))
    }
}
