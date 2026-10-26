package com.convo.android.ui

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performSemanticsAction
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

private const val ANA = "11111111-1111-4111-8111-111111111111"
private const val GROUP = "g:groupid"

/** Shared set-up: a direct chat with Ana and a group the user owns; the info page is opened in-app. */
abstract class InfoExtrasBase(private val kt: String = "verified", setup: FakeCore.() -> Unit = {}) {
    init {
        FakeCore.install(basic(listOf(conversation(ANA, "Ana Pop"), conversation(GROUP, "Night shift", kind = "group")))
            .put("profiles", JSONObject().put(ANA, JSONObject().put("status", "Out of office")))) {
            handlers["account"] = { args -> JSONObject().put("accountId", args.getString("id")).put("username", "ana").put("displayName", "Ana Pop").put("phone", "+40 700 000 000") }
            handlers["keyTransparency"] = { JSONObject().put("status", kt) }
            handlers["identity"] = { JSONObject().put("digits", "12345 67890 12345 67890") }
            handlers["group"] = { JSONObject().put("members", JSONArray().put(JSONObject().put("accountId", Snapshots.ME).put("role", "owner")).put(JSONObject().put("accountId", ANA).put("role", "member"))) }
            setup()
        }
    }
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    protected fun core() = FakeCore.current
    protected fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()
    protected fun last(method: String): JSONObject = core().commands.last { it.first == method }.second
    protected fun info(id: String, title: String) {
        compose.waitUntil(10_000) { has(title) }
        compose.runOnUiThread { compose.activity.openChat(id); compose.activity.route = "info" }
        compose.waitForIdle()
    }
    protected fun scrollTo(text: String) { compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(text, substring = true)); compose.waitForIdle() }
    protected fun press(text: String) {
        val m = compose.onAllNodes(hasClickAction() and isEnabled() and (hasText(text) or hasAnyDescendant(hasText(text))), useUnmergedTree = true)
        m[m.fetchSemanticsNodes().size - 1].performSemanticsAction(SemanticsActions.OnClick); compose.waitForIdle()
    }
}

@RunWith(RobolectricTestRunner::class)
class ContactInfoTest : InfoExtrasBase() {
    @Test fun showsStatusUsernameAndPhone() {
        info(ANA, "Ana Pop")
        compose.waitUntil(5_000) { has("@ana") }
        assertTrue(has("Out of office")); assertTrue(has("+40 700 000 000"))
    }

    @Test fun safetyNumberCanBeCompared() {
        info(ANA, "Ana Pop"); scrollTo("Encryption")
        press("Encryption")
        compose.waitUntil(5_000) { has("Verify safety number") }
        assertTrue(has("12345 67890 12345 67890"))
    }

    @Test fun verifiedKeysAreShown() {
        info(ANA, "Ana Pop"); scrollTo("Key transparency")
        compose.waitUntil(5_000) { has("Keys match the public key log") }
    }

    @Test fun theContactPageListsGroupsInCommon() {
        compose.waitUntil(10_000) { has("Ana Pop") }
        compose.runOnUiThread { compose.activity.openChat(GROUP); compose.activity.route = "contact:$ANA" }
        compose.waitUntil(5_000) { has("1 groups in common") || has("groups in common") }
        compose.onNodeWithText("Message").performClick(); compose.waitForIdle()
        assertEquals(ANA, last("newChat").getString("id"))
    }
}

@RunWith(RobolectricTestRunner::class)
class KeyMismatchInfoTest : InfoExtrasBase("mismatch") {
    @Test fun aMismatchIsAWarning() {
        info(ANA, "Ana Pop"); scrollTo("Key transparency")
        compose.waitUntil(5_000) { has("Keys don’t match the key log") }
    }
}

@RunWith(RobolectricTestRunner::class)
class KeyLogErrorInfoTest : InfoExtrasBase("log-error") {
    @Test fun aBrokenLogIsReported() {
        info(ANA, "Ana Pop"); scrollTo("Key transparency")
        compose.waitUntil(5_000) { has("The key log could not be trusted") }
    }
}

@RunWith(RobolectricTestRunner::class)
class OwnKeysInfoTest : InfoExtrasBase("unwitnessed") {
    @Test fun devicesPageShowsTheOwnKeyLogState() {
        compose.waitUntil(10_000) { has("Ana Pop") }
        compose.runOnUiThread { compose.activity.selectedTab = "Settings"; compose.activity.route = "devices" }
        compose.waitUntil(5_000) { has("Your keys in the key log") }
        assertTrue(has("not yet witnessed"))
    }
}

@RunWith(RobolectricTestRunner::class)
class InviteLinksInfoTest : InfoExtrasBase(setup = {
    handlers["createInvite"] = { JSONObject().put("url", "https://convo.example/#/join/" + "x".repeat(32)) }
    handlers["joinRequests"] = { JSONArray().put(JSONObject().put("accountId", "req-1").put("label", "Rita Request")) }
    handlers["groupBans"] = { JSONArray().put(JSONObject().put("accountId", "ban-1").put("label", "Bob Banned")) }
}) {
    @Test fun ownersCreateAndResetInviteLinks() {
        info(GROUP, "Night shift"); scrollTo("Create invite link")
        press("Create invite link")
        compose.waitUntil(5_000) { has("#/join/") }
        press("Reset links")
        assertTrue(core().commands.any { it.first == "revokeInvites" })
    }

    @Test fun joinRequestsAreApprovedOrDeclined() {
        info(GROUP, "Night shift"); scrollTo("Rita Request")
        press("Approve")
        assertEquals("req-1", last("addMembers").getJSONArray("members").getString(0))
    }

    @Test fun bannedPeopleCanBeUnbanned() {
        info(GROUP, "Night shift"); scrollTo("Bob Banned")
        assertTrue(has("Banned (1)"))
        press("Unban")
        assertEquals("ban-1", last("unbanMember").getString("accountId"))
    }
}

@RunWith(RobolectricTestRunner::class)
class CommunityWelcomeTest {
    init {
        val root = "g:root"
        FakeCore.install(basic(listOf(conversation(root, "Makers", kind = "group") { put("adminOnly", true) }))) {
            handlers["communities"] = { JSONArray().put(JSONObject().put("communityId", "c1").put("name", "Makers").put("role", "member").put("conversationId", root)) }
            handlers["communityGroups"] = { JSONArray() }
            handlers["communityOperations"] = { JSONArray() }
            handlers["onboarding"] = { JSONObject().put("reviewer", false).put("pkg", JSONObject().put("welcome", "Hello makers!")
                .put("rules", JSONObject().put("version", 3).put("text", "Be kind.").put("ackRequired", true))
                .put("checklist", JSONArray().put(JSONObject().put("id", "ack-rules").put("required", true)).put(JSONObject().put("id", "intro").put("label", "Introduce yourself").put("required", false)))) }
        }
    }
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()

    @Test fun newMembersSeeTheWelcomeAndAcknowledgeTheRules() {
        compose.waitUntil(10_000) { has("Communities") }
        compose.runOnUiThread { compose.activity.selectedTab = "Communities"; compose.activity.route = "community:c1" }
        compose.waitUntil(5_000) { has("Welcome to Makers") }
        assertTrue(has("Hello makers!")); assertTrue(has("Community rules (version 3)")); assertTrue(has("Be kind."))
        val ack = compose.onAllNodes(hasClickAction() and hasAnyDescendant(hasText("I acknowledge the rules (version 3)")), useUnmergedTree = true)
        ack[ack.fetchSemanticsNodes().size - 1].performSemanticsAction(SemanticsActions.OnClick); compose.waitForIdle()
        assertEquals("c1", FakeCore.current.commands.last { it.first == "acknowledgeRules" }.second.getString("id"))
    }
}
