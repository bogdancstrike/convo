package com.convo.android.ui

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
private const val DAY = 86_400_000L

private fun options(vararg texts: String) = JSONArray().apply { texts.forEachIndexed { i, t -> put(JSONObject().put("id", "o$i").put("text", t)) } }
private fun ballot(vararg ids: String) = JSONObject().put("optionIds", JSONArray(ids.toList())).put("at", 1).put("id", "b")

/** Poll, quiz and event cards in a chat: what they show and the commands they send. */
abstract class CardUiBase(private val messages: List<JSONObject>, canModerate: Boolean = false) {
    init {
        val chats = listOf(conversation(PEER, "Ana Pop"))
        FakeCore.install(basic(chats)) {
            handlers["open"] = { args -> emit("snapshot", basic(chats, messages, active = args.getString("id"))); null }
            handlers["canClosePoll"] = { canModerate }
            handlers["canEditEvent"] = { canModerate }
            handlers["pollVoters"] = { JSONObject().put("o0", JSONArray().put("Ana Pop")) }
            handlers["eventResponders"] = { JSONObject().put("going", JSONArray().put("Ana Pop")) }
        }
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    protected fun core() = FakeCore.current
    protected fun last(method: String): JSONObject = core().commands.last { it.first == method }.second
    protected fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()
    /**
     * Activates the innermost clickable control showing exactly [text] (a substring could match a timestamp). Under Robolectric, injected touches
     * inside chat bubbles do not reach nested controls (verified working on a device), so this
     * invokes the control's click action — the same handler a tap runs.
     */
    protected fun tap(text: String) {
        val matches = compose.onAllNodes(hasClickAction() and isEnabled() and (hasText(text) or hasAnyDescendant(hasText(text))), useUnmergedTree = true)
        matches[matches.fetchSemanticsNodes().size - 1].performSemanticsAction(SemanticsActions.OnClick)
        compose.waitForIdle()
    }
    protected fun openChat(waitFor: String) {
        compose.waitUntil(10_000) { has("Ana Pop") }
        compose.onNodeWithText("Ana Pop").performClick()
        compose.waitUntil(10_000) { has(waitFor) }
    }
}

@RunWith(RobolectricTestRunner::class)
class OpenPollUiTest : CardUiBase(listOf(message("p1", PEER, "Lunch?") {
    put("poll", JSONObject().put("question", "Lunch?").put("options", options("Pizza", "Sushi")).put("multiple", false)
        .put("votes", JSONObject().put(PEER, ballot("o0"))))
})) {
    @Test fun showsTheQuestionOptionsAndCounts() {
        openChat("Pizza")
        assertTrue(has("Select one")); assertTrue(has("Sushi")); assertTrue(has("View votes (1)"))
    }

    @Test fun votingSendsTheBallot() {
        openChat("Sushi")
        tap("Sushi"); compose.waitForIdle()
        val args = last("votePoll")
        assertEquals("p1", args.getString("id")); assertEquals(JSONArray(listOf("o1")).toString(), args.getJSONArray("optionIds").toString())
    }

    @Test fun viewVotesListsVoters() {
        openChat("View votes")
        tap("View votes (1)"); compose.waitForIdle()
        compose.waitUntil(5_000) { has("Hide votes") }
        assertTrue(core().commands.any { it.first == "pollVoters" })
    }

    @Test fun onlyModeratorsSeeClosePoll() { openChat("Pizza"); assertTrue(!has("Close poll")) }
}

@RunWith(RobolectricTestRunner::class)
class OwnPollUiTest : CardUiBase(listOf(message("p2", Snapshots.ME, "Pick days", direction = "out") {
    put("poll", JSONObject().put("question", "Pick days").put("options", options("Mon", "Tue", "Wed")).put("multiple", true)
        .put("votes", JSONObject().put(Snapshots.ME, ballot("o0"))))
}), canModerate = true) {
    @Test fun multipleChoiceAddsToTheBallot() {
        openChat("Tue")
        assertTrue(has("Select one or more"))
        tap("Tue"); compose.waitForIdle()
        assertEquals(JSONArray(listOf("o0", "o1")).toString(), last("votePoll").getJSONArray("optionIds").toString())
    }

    @Test fun choosingAgainRemovesThatOption() {
        openChat("Mon")
        tap("Mon"); compose.waitForIdle()
        assertEquals("[]", last("votePoll").getJSONArray("optionIds").toString())
    }

    @Test fun theAuthorCanClose() {
        openChat("Close poll")
        tap("Close poll"); compose.waitForIdle()
        assertEquals("p2", last("closePoll").getString("id"))
    }
}

@RunWith(RobolectricTestRunner::class)
class ClosedPollUiTest : CardUiBase(listOf(message("p3", PEER, "Old poll") {
    put("poll", JSONObject().put("question", "Old poll").put("options", options("A", "B")).put("multiple", false)
        .put("votes", JSONObject()).put("closed", JSONObject().put("by", PEER).put("at", 1)))
})) {
    @Test fun closedPollsRefuseVotes() {
        openChat("Poll closed")
        tap("A"); compose.waitForIdle()
        assertTrue(core().commands.none { it.first == "votePoll" })
    }
}

@RunWith(RobolectricTestRunner::class)
class QuizUiTest : CardUiBase(listOf(
    message("q1", PEER, "2+2?") { put("poll", JSONObject().put("question", "2+2?").put("options", options("3", "4")).put("multiple", false).put("correctOptionId", "o1").put("explanation", "Arithmetic.").put("votes", JSONObject())) },
    message("q2", PEER, "Capital?") { put("sort", 3_000L); put("poll", JSONObject().put("question", "Capital?").put("options", options("Paris", "Rome")).put("multiple", false).put("correctOptionId", "o0").put("explanation", "France.")
        .put("votes", JSONObject().put(Snapshots.ME, ballot("o1")))) },
)) {
    @Test fun unansweredQuizzesHideTheAnswer() { openChat("2+2?"); assertTrue(has("Quiz · one try")); assertTrue(!has("Arithmetic.")) }
    @Test fun answeringSendsOneChoice() {
        openChat("2+2?")
        tap("4"); compose.waitForIdle()
        assertEquals("q1", last("votePoll").getString("id"))
    }
    @Test fun aWrongAnswerIsFinalAndExplained() {
        openChat("Capital?")
        assertTrue(has("Not quite")); assertTrue(has("France.")); assertTrue(has("0 of 1 answered correctly"))
        tap("Paris"); compose.waitForIdle()
        assertTrue(core().commands.none { it.first == "votePoll" && it.second.getString("id") == "q2" })
    }
}

@RunWith(RobolectricTestRunner::class)
class EventUiTest : CardUiBase(listOf(
    message("e1", PEER, "Standup") { put("event", JSONObject().put("title", "Standup").put("start", System.currentTimeMillis() + DAY).put("location", "Room 1").put("description", "Daily sync").put("revision", 0)
        .put("rsvps", JSONObject().put(PEER, JSONObject().put("response", "going")))) },
), canModerate = true) {
    @Test fun showsTitlePlaceDescriptionAndCounts() {
        openChat("Standup")
        assertTrue(has("Room 1")); assertTrue(has("Daily sync")); assertTrue(has("Going 1"))
    }

    @Test fun rsvpIsSent() {
        openChat("Standup")
        tap("Maybe 0"); compose.waitForIdle()
        assertEquals("maybe", last("rsvp").getString("response")); assertEquals("e1", last("rsvp").getString("id"))
    }


    @Test fun responsesAreListed() {
        openChat("Standup")
        tap("Responses"); compose.waitForIdle()
        compose.waitUntil(5_000) { has("Going: Ana Pop") }
    }

    @Test fun organisersCanCancel() {
        openChat("Cancel event")
        tap("Cancel event"); compose.waitForIdle()
        assertTrue(last("updateEvent").getBoolean("cancelled"))
        assertEquals("Standup", last("updateEvent").getString("title"))
    }
}

@RunWith(RobolectricTestRunner::class)
class PastEventUiTest : CardUiBase(listOf(
    message("e2", PEER, "Old party") { put("event", JSONObject().put("title", "Old party").put("start", System.currentTimeMillis() - 2 * DAY).put("revision", 0).put("rsvps", JSONObject())) },
)) {
    @Test fun pastEventsAreMarkedEnded() { openChat("Old party"); assertTrue(has("This event has ended")) }

    @Test fun pastEventsTakeNoMoreResponses() {
        openChat("Old party")
        // The RSVP chips (not the whole bubble, which is clickable too) are disabled.
        val chips = hasClickAction() and hasAnyDescendant(hasText("Going", substring = true)) and androidx.compose.ui.test.hasAnyDescendant(hasText("Old party")).not()
        assertEquals(3, compose.onAllNodes(hasClickAction() and (hasAnyDescendant(hasText("Going", substring = true)) or hasAnyDescendant(hasText("Maybe", substring = true)) or hasAnyDescendant(hasText("Can’t go", substring = true))) and hasAnyDescendant(hasText("Old party")).not(), useUnmergedTree = true).fetchSemanticsNodes().size)
        assertTrue(compose.onAllNodes(chips and isEnabled(), useUnmergedTree = true).fetchSemanticsNodes().isEmpty())
    }
}
