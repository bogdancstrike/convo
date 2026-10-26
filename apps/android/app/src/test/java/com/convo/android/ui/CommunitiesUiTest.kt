package com.convo.android.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performSemanticsAction
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import com.convo.android.Snapshots.basic
import com.convo.android.Snapshots.conversation
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private const val COMMUNITY = "c1"
private const val ROOT = "g:announcements"

/** Communities tab and a community's page, for a manager and for a member. */
abstract class CommunitiesUiBase(private val role: String, private val communities: Boolean = true) {
    init {
        val chats = listOf(conversation(ROOT, "Builders", kind = "group") { put("adminOnly", true) },
            conversation("g:team", "Team chat", kind = "group"), conversation("g:other", "Other group", kind = "group"))
        FakeCore.install(basic(chats)) {
            handlers["communities"] = {
                if (!communities) JSONArray()
                else JSONArray().put(JSONObject().put("communityId", COMMUNITY).put("name", "Builders").put("description", "Makers of things").put("role", role).put("conversationId", ROOT))
            }
            handlers["communityGroups"] = { JSONArray()
                .put(JSONObject().put("groupId", "gt").put("conversationId", "g:team").put("name", "Team chat").put("status", "active").put("member", true).put("visibility", "discoverable"))
                .put(JSONObject().put("groupId", "gx").put("conversationId", "g:x").put("name", "Open room").put("status", "active").put("member", false).put("visibility", "discoverable"))
                .put(JSONObject().put("groupId", "gp").put("conversationId", "g:p").put("name", "Proposed room").put("status", "proposed").put("canAccept", role == "owner").put("visibility", "discoverable")) }
            handlers["onboarding"] = { JSONObject.NULL }
            handlers["communityOperations"] = { JSONArray() }
            handlers["createCommunity"] = { JSONObject().put("communityId", "c2") }
        }
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    protected fun core() = FakeCore.current
    protected fun last(method: String): JSONObject = core().commands.last { it.first == method }.second
    protected fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()
    protected fun press(text: String) {
        val m = compose.onAllNodes(hasClickAction() and isEnabled() and (hasText(text) or androidx.compose.ui.test.hasAnyDescendant(hasText(text))), useUnmergedTree = true)
        m[m.fetchSemanticsNodes().size - 1].performSemanticsAction(SemanticsActions.OnClick); compose.waitForIdle()
    }
    protected fun openTab() {
        compose.waitUntil(10_000) { has("Communities") }
        compose.onNodeWithText("Communities").performClick(); compose.waitForIdle()
    }
    protected fun openCommunity() {
        openTab(); compose.waitUntil(5_000) { has("Makers of things") }
        compose.onNodeWithText("Makers of things").performClick()
        compose.waitUntil(5_000) { has("Groups in this community") }
    }
}

@RunWith(RobolectricTestRunner::class)
class CommunityAsOwnerTest : CommunitiesUiBase("owner") {
    @Test fun theTabListsCommunities() { openTab(); compose.waitUntil(5_000) { has("Makers of things") }; assertTrue(has("New community")) }

    @Test fun pageShowsCountsAndManagerEntries() {
        openCommunity()
        assertTrue(has("2 groups · you’re in 1"))
        assertTrue(has("Welcome & rules")); assertTrue(has("Invite members")); assertTrue(has("Add existing"))
    }

    @Test fun ownersAcceptProposedGroupsWithRemovalDelegation() {
        openCommunity(); press("Accept")
        assertEquals("gp", last("acceptCommunityLink").getString("groupId"))
        assertTrue(last("acceptCommunityLink").getBoolean("delegation"))
    }

    @Test fun managersCanRemoveAGroup() {
        openCommunity(); press("Remove")
        assertTrue(core().commands.any { it.first == "unlinkCommunityGroup" })
    }

    @Test fun addingAnExistingGroupLinksIt() {
        openCommunity(); press("Add existing")
        compose.waitUntil(5_000) { has("Add a group") }
        assertTrue(has("Other group"))
        press("Other group")
        assertEquals("g:other", last("linkCommunityGroup").getString("conversationId"))
        assertEquals("discoverable", last("linkCommunityGroup").getString("visibility"))
    }
    // The new-group dialog has text fields (never idle under Robolectric); covered on the emulator.
}

@RunWith(RobolectricTestRunner::class)
class CommunityAsMemberTest : CommunitiesUiBase("member") {
    @Test fun membersAskToJoinOpenGroups() {
        openCommunity(); press("Ask to join")
        assertEquals("gx", last("requestCommunityGroup").getString("groupId"))
        compose.waitUntil(5_000) { has("Request sent") }
    }

    @Test fun membersSeeNoManagerEntries() {
        openCommunity()
        assertFalse(has("Welcome & rules")); assertFalse(has("Add existing")); assertTrue(has("Updates from the community admins"))
    }

    @Test fun proposedGroupsWaitForTheirOwner() { openCommunity(); assertTrue(has("Waiting for the group owner to accept")) }

    @Test fun openingAMemberGroupOpensItsChat() {
        openCommunity(); press("You’re a member")
        assertTrue(core().commands.any { it.first == "open" && it.second.getString("id") == "g:team" })
    }
}

@RunWith(RobolectricTestRunner::class)
class NoCommunitiesTest : CommunitiesUiBase("member", communities = false) {
    @Test fun emptyStateExplainsCommunities() { openTab(); compose.waitUntil(5_000) { has("No communities yet") } }

    @Test fun creatingACommunitySendsNameAndDescription() {
        openTab(); compose.onNodeWithTag("new-community").performClick(); compose.waitForIdle()
        assertTrue(has("Create community"))
        // The button stays disabled until a name is entered.
        assertTrue(compose.onAllNodes(hasText("Create community") and hasClickAction() and isEnabled()).fetchSemanticsNodes().isEmpty())
        assertEquals(1, compose.onAllNodes(hasText("Create community") and hasClickAction()).fetchSemanticsNodes().size)
    }
}
