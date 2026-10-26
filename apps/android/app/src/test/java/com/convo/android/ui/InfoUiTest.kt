package com.convo.android.ui

import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import com.convo.android.Snapshots
import com.convo.android.Snapshots.basic
import com.convo.android.Snapshots.conversation
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private const val GROUP = "g:groupid"
private const val BOB = "00000000-0000-4000-8000-00000000000b"
private const val CARA = "00000000-0000-4000-8000-00000000000c"

/** Group and contact info pages: what is shown for each role and the commands each control sends. */
abstract class InfoUiBase(private val myRole: String, private val adminOnly: Boolean = false) {
    init {
        val chat = conversation(GROUP, if (adminOnly) "Announcements" else "Night shift", kind = "group") { if (adminOnly) put("adminOnly", true) }
        FakeCore.install(basic(listOf(chat))) {
            handlers["group"] = { JSONObject().put("members", JSONArray()
                .put(JSONObject().put("accountId", Snapshots.ME).put("role", myRole))
                .put(JSONObject().put("accountId", BOB).put("role", "admin"))
                .put(JSONObject().put("accountId", CARA).put("role", "member"))) }
            handlers["account"] = { args -> JSONObject().put("accountId", args.getString("id")).put("username", if (args.getString("id") == BOB) "bob" else "cara")
                .put("displayName", if (args.getString("id") == BOB) "Bob Ionescu" else "Cara Pop") }
            handlers["memberLabels"] = { JSONArray()
                .put(JSONObject().put("accountId", BOB).put("label", "Bob Ionescu"))
                .put(JSONObject().put("accountId", CARA).put("label", "Cara Pop")) }
        }
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    protected fun core() = FakeCore.current

    protected fun openInfo() {
        val title = if (adminOnly) "Announcements" else "Night shift"
        compose.waitUntil(10_000) { compose.onAllNodes(hasText(title)).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(title).performClick(); compose.waitForIdle()
        compose.onNodeWithContentDescription("Chat options").performClick(); compose.waitForIdle()
        compose.onNodeWithText(if (adminOnly) "Channel info" else "Group info").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("3 members", substring = true)).fetchSemanticsNodes().isNotEmpty() }
    }
    protected fun scrollTo(text: String) { compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(text, substring = true)); compose.waitForIdle() }
    protected fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()
    protected fun last(method: String): JSONObject = core().commands.last { it.first == method }.second
}

@RunWith(RobolectricTestRunner::class)
class GroupInfoAsOwnerTest : InfoUiBase("owner") {
    @Test fun headerCountsMembers() { openInfo(); assertTrue(has("Group · 3 members")) }

    @Test fun disappearingTimerIsSentForTheChat() {
        openInfo(); scrollTo("Disappearing messages")
        compose.onNodeWithText("24 hours").performClick(); compose.waitForIdle()
        assertEquals(86_400, last("setDisappearing").getInt("seconds"))
        assertEquals(GROUP, last("setDisappearing").getString("id"))
    }

    @Test fun muteTogglesTheConversation() {
        openInfo(); scrollTo("Mute notifications")
        compose.onNodeWithText("Mute notifications").performClick(); compose.waitForIdle()
        assertTrue(last("conversation").getJSONObject("patch").getBoolean("muted"))
    }

    @Test fun ownersSeeTheEditEntry() { openInfo(); scrollTo("Edit name and description"); assertTrue(has("Edit name and description")) }

    @Test fun ownersCanAddParticipants() { openInfo(); scrollTo("Add participant"); assertTrue(has("Add participant")) }

    @Test fun makeAdminSendsARoleChange() {
        openInfo(); scrollTo("Cara Pop")
        compose.onAllNodesWithContentDescription("Participant options").let { it[it.fetchSemanticsNodes().size - 1] }.performClick(); compose.waitForIdle()
        compose.onNodeWithText("Make admin").performClick(); compose.waitForIdle()
        assertEquals(CARA, last("role").getString("member"))
    }

    @Test fun restrictingAMemberUpdatesTheMemberPolicy() {
        openInfo(); scrollTo("Cara Pop")
        compose.onAllNodesWithContentDescription("Participant options").let { it[it.fetchSemanticsNodes().size - 1] }.performClick(); compose.waitForIdle()
        compose.onNodeWithText("Restrict from sending").performClick(); compose.waitForIdle()
        assertEquals(CARA, last("setMemberPolicy").getJSONArray("restricted").getString(0))
    }

    @Test fun removingAParticipantIsConfirmed() {
        openInfo(); scrollTo("Cara Pop")
        compose.onAllNodesWithContentDescription("Participant options").let { it[it.fetchSemanticsNodes().size - 1] }.performClick(); compose.waitForIdle()
        compose.onNodeWithText("Remove").performClick(); compose.waitForIdle()
        assertTrue(has("Remove participant?"))
    }

    @Test fun adminsFilterHidesPlainMembers() {
        openInfo(); scrollTo("Search members")
        compose.onNodeWithText("Admins").performClick(); compose.waitForIdle()
        assertTrue(has("2 of 3 members"))
    }
}

@RunWith(RobolectricTestRunner::class)
class GroupInfoAsMemberTest : InfoUiBase("member") {
    @Test fun membersCannotChangeTheTimer() { openInfo(); scrollTo("Disappearing messages"); assertTrue(has("Only group admins can change this.")) }
    @Test fun membersCannotAddParticipants() { openInfo(); assertTrue(!has("Add participant")) }
    @Test fun membersSeeNoParticipantMenus() {
        openInfo(); scrollTo("Cara Pop")
        assertTrue(compose.onAllNodesWithContentDescription("Participant options").fetchSemanticsNodes().isEmpty())
    }
    @Test fun membersCanStillLeave() { openInfo(); scrollTo("Leave group"); assertTrue(has("Leave group")) }
}

@RunWith(RobolectricTestRunner::class)
class ChannelInfoTest : InfoUiBase("owner", adminOnly = true) {
    @Test fun channelsAreLabelled() { openInfo(); assertTrue(has("Channel · 3 members")) }
    @Test fun channelsHaveNoSlowModeOrBots() { openInfo(); scrollTo("Leave channel"); assertTrue(!has("Slow mode")) }
    @Test fun channelsCannotBeCalled() { openInfo(); assertTrue(compose.onAllNodes(hasText("Voice call")).fetchSemanticsNodes().isEmpty()) }
}
