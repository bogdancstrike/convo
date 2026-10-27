package com.convo.android

import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
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

private const val ANA = "11111111-1111-4111-8111-111111111111"
private const val GROUP = "g:groupid"

/**
 * Dialogs with text fields, on a device (under Robolectric a text field inside a dialog window never
 * idles): poll and quiz creation, group name and description, reports and invite links.
 */
@RunWith(AndroidJUnit4::class)
class DialogsDeviceTest {
    private val chats = listOf(conversation(ANA, "Ana Pop"), conversation(GROUP, "Night shift", kind = "group"))
    private val messages = listOf(message("m1", ANA, "spam link here"), message("m2", ANA, "more spam") { put("sort", System.currentTimeMillis() + 1) })

    init {
        FakeCore.install(basic(chats)) {
            handlers["open"] = { args -> emit("snapshot", basic(chats, messages, active = args.getString("id"))); null }
            handlers["group"] = { JSONObject().put("members", JSONArray().put(JSONObject().put("accountId", Snapshots.ME).put("role", "owner")).put(JSONObject().put("accountId", ANA).put("role", "member"))) }
            handlers["account"] = { JSONObject().put("accountId", ANA).put("username", "ana").put("displayName", "Ana Pop") }
            handlers["reportRecipients"] = { JSONArray().put(JSONObject().put("accountId", "sec-1").put("displayName", "Security Desk")) }
            handlers["sendPoll"] = { JSONObject() }
            handlers["sendQuiz"] = { JSONObject() }
            handlers["sendReport"] = { JSONObject() }
            handlers["requestToJoin"] = { JSONObject() }
        }
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun core() = FakeCore.current
    private fun last(method: String): JSONObject = core().commands.last { it.first == method }.second
    private fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()
    private fun openChat(title: String) {
        compose.waitUntil(15_000) { has(title) }
        compose.onNodeWithText(title).performClick()
        compose.waitUntil(15_000) { has("spam link here") }
    }
    private fun type(field: String, text: String) { compose.onNode(hasSetTextAction() and hasText(field, substring = true)).performTextInput(text); compose.waitForIdle() }

    @Test fun aPollIsCreatedFromTheAttachSheet() {
        openChat("Ana Pop")
        compose.onNodeWithContentDescription("Attach file").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Poll").performClick(); compose.waitUntil(5_000) { has("Create poll") }
        type("Question", "Lunch?")
        compose.onAllNodesWithText("Add option")[0].performTextInput("Pizza")
        compose.onAllNodesWithText("Add option")[0].performTextInput("Sushi")
        compose.onNodeWithText("Send").performClick(); compose.waitForIdle()
        val poll = last("sendPoll")
        assertEquals("Lunch?", poll.getString("question")); assertEquals(JSONArray(listOf("Pizza", "Sushi")).toString(), poll.getJSONArray("options").toString())
    }

    @Test fun aQuizNeedsTheCorrectAnswer() {
        openChat("Ana Pop")
        compose.onNodeWithContentDescription("Attach file").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Poll").performClick(); compose.waitUntil(5_000) { has("Create poll") }
        type("Question", "2+2?")
        compose.onAllNodesWithText("Add option")[0].performTextInput("3")
        compose.onAllNodesWithText("Add option")[0].performTextInput("4")
        compose.onNodeWithText("Quiz mode").performClick(); compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText("Send") and androidx.compose.ui.test.isEnabled() and androidx.compose.ui.test.hasClickAction()).fetchSemanticsNodes().isEmpty())
        compose.onAllNodes(androidx.compose.ui.test.isSelectable())[1].performClick(); compose.waitForIdle()
        compose.onNodeWithText("Send").performClick(); compose.waitForIdle()
        assertEquals(1, last("sendQuiz").getInt("correctIndex"))
    }

    @Test fun reportsSendOnlyTheChosenMessages() {
        openChat("Ana Pop")
        compose.onNodeWithContentDescription("Chat options").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Report").performClick(); compose.waitUntil(5_000) { has("Security Desk") }
        compose.onNodeWithText("more spam").performClick(); compose.waitForIdle()
        type("What happened?", "phishing")
        compose.onNodeWithText("Send report (1)").performClick()
        compose.waitUntil(5_000) { has("Report sent to Security Desk") }
        val report = last("sendReport")
        assertEquals("sec-1", report.getString("recipient")); assertEquals("phishing", report.getString("reason"))
        assertEquals(1, report.getJSONArray("keys").length()); assertEquals(ANA, report.getString("reported"))
    }

    @Test fun ownersEditTheGroupNameAndDescription() {
        compose.waitUntil(15_000) { has("Night shift") }
        compose.runOnUiThread { compose.activity.openChat(GROUP); compose.activity.route = "info" }
        compose.waitUntil(10_000) { has("Edit name and description") }
        compose.onNodeWithText("Edit name and description").performClick(); compose.waitForIdle()
        type("About", "Late crew")
        compose.onNodeWithText("Save").performClick(); compose.waitForIdle()
        val update = last("updateGroupInfo")
        assertEquals("Night shift", update.getString("name")); assertEquals("Late crew", update.getString("description"))
    }

    @Test fun joiningWithAnInviteLinkChecksTheLink() {
        compose.waitUntil(15_000) { has("Ana Pop") }
        compose.onNodeWithContentDescription("New chat").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Join with invite link").performClick(); compose.waitUntil(5_000) { has("Join a group") }
        type("Invite link", "https://convo.example/#/join/" + "a".repeat(32))
        compose.onNodeWithText("Ask to join").performClick(); compose.waitForIdle()
        assertEquals("a".repeat(32), last("requestToJoin").getString("token"))
    }

    @Test fun aMalformedInviteLinkIsRefused() {
        compose.waitUntil(15_000) { has("Ana Pop") }
        compose.onNodeWithContentDescription("New chat").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Join with invite link").performClick(); compose.waitUntil(5_000) { has("Join a group") }
        type("Invite link", "https://convo.example/#/join/short")
        compose.onNodeWithText("Ask to join").performClick(); compose.waitForIdle()
        assertTrue(core().commands.none { it.first == "requestToJoin" })
        assertEquals("This invite link is no longer valid.", compose.activity.error)
    }
}
