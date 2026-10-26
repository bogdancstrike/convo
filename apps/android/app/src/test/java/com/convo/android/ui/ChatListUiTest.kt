package com.convo.android.ui

import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import com.convo.android.Snapshots.basic
import com.convo.android.Snapshots.conversation
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private const val DIRECT = "11111111-1111-4111-8111-111111111111"
private const val GROUP = "g:groupid"
private const val CHANNEL = "g:channelid"

/** Chat list (WhatsApp-style): rows, the per-chat ⋮ menu and the commands it sends to the core. */
@RunWith(RobolectricTestRunner::class)
class ChatListUiTest {
    init {
        FakeCore.install(basic(listOf(
            // Distinct times: the list is newest first, so rows are direct, group, channel.
            conversation(DIRECT, "Ana Pop", preview = "See you at 10", unread = 2) { put("lastActivity", 3_000L) },
            conversation(GROUP, "Night shift", kind = "group", preview = "ok") { put("previewAuthorName", "Bob"); put("lastActivity", 2_000L) },
            conversation(CHANNEL, "Announcements", kind = "group") { put("adminOnly", true); put("lastActivity", 1_000L) },
        )))
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun ready() = compose.waitUntil(10_000) { compose.onAllNodes(hasText("Ana Pop")).fetchSemanticsNodes().isNotEmpty() }
    private fun core() = FakeCore.current

    /** Opens the ⋮ menu of the row at [index] (newest first: direct, group, channel). */
    private fun menu(index: Int) {
        ready()
        compose.onAllNodesWithContentDescription("Chat options")[index].performClick()
        compose.waitForIdle()
    }

    private fun lastPatch(): Pair<String, org.json.JSONObject> {
        val (method, args) = core().commands.last { it.first == "conversation" }
        return method to args
    }

    @Test fun rowsShowTitlesPreviewsAndUnreadBadges() {
        ready()
        compose.onNodeWithText("See you at 10").assertExists()
        compose.onNodeWithText("2").assertExists()
        compose.onNodeWithText("Announcements").assertExists()
    }

    @Test fun pinSendsAPatch() {
        menu(0); compose.onNodeWithText("Pin chat").performClick(); compose.waitForIdle()
        val (_, args) = lastPatch()
        assertEquals(DIRECT, args.getString("id")); assertTrue(args.getJSONObject("patch").getBoolean("pinned"))
    }

    @Test fun archiveSendsAPatch() {
        menu(0); compose.onNodeWithText("Archive chat").performClick(); compose.waitForIdle()
        assertTrue(lastPatch().second.getJSONObject("patch").getBoolean("archived"))
    }

    @Test fun muteSendsAPatch() {
        menu(0); compose.onNodeWithText("Mute notifications").performClick(); compose.waitForIdle()
        assertTrue(lastPatch().second.getJSONObject("patch").getBoolean("muted"))
    }

    @Test fun blockAsksFirstAndThenBlocks() {
        menu(0); compose.onNodeWithText("Block contact").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Block contact?").assertExists()
        compose.onNodeWithText("Block").performClick(); compose.waitForIdle()
        val (_, args) = core().commands.last { it.first == "block" }
        assertEquals(DIRECT, args.getString("id")); assertTrue(args.getBoolean("blocked"))
    }

    @Test fun blockCanBeCancelled() {
        menu(0); compose.onNodeWithText("Block contact").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Cancel").performClick(); compose.waitForIdle()
        assertTrue(core().commands.none { it.first == "block" })
    }

    @Test fun groupMenuOffersLeaveAndMentionsMode() {
        menu(1)
        compose.onNodeWithText("Leave group").assertExists()
        compose.onNodeWithText("Notify only for mentions").performClick(); compose.waitForIdle()
        assertEquals("mentions", lastPatch().second.getJSONObject("patch").getString("notify"))
    }

    @Test fun leavingAGroupIsConfirmed() {
        menu(1); compose.onNodeWithText("Leave group").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Leave group?").assertExists()
    }

    @Test fun channelMenuSaysChannel() {
        menu(2)
        compose.onNodeWithText("Leave channel").assertExists()
    }

    @Test fun directChatsHaveNoLeaveEntry() {
        menu(0)
        assertTrue(compose.onAllNodes(hasText("Leave group")).fetchSemanticsNodes().isEmpty())
    }

    @Test fun clearAndDeleteAreConfirmed() {
        menu(0); compose.onNodeWithText("Clear chat").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Clear chat?").assertExists()
    }

    @Test fun lockEntryNeedsAPasskey() {
        menu(0)
        assertTrue("no lock without a confirmed passkey", compose.onAllNodes(hasText("Require authentication to open")).fetchSemanticsNodes().isEmpty())
    }

    @Test fun snoozeOpensTheSnoozeDialog() {
        menu(0); compose.onNodeWithText("Snooze notifications…").performClick(); compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText("Snooze", substring = true)).fetchSemanticsNodes().isNotEmpty())
    }

    @Test fun openingAChatAsksTheCoreForIt() {
        ready()
        compose.onNodeWithText("Ana Pop").performClick(); compose.waitForIdle()
        assertTrue(core().commands.any { it.first == "open" && it.second.getString("id") == DIRECT })
    }

    @Test fun unreadFilterKeepsOnlyUnreadChats() {
        ready()
        compose.onNodeWithText("Unread").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Ana Pop").assertExists()
        assertTrue(compose.onAllNodes(hasText("Night shift")).fetchSemanticsNodes().isEmpty())
    }

    @Test fun groupsFilterKeepsOnlyGroups() {
        ready()
        compose.onNodeWithText("Groups").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Night shift").assertExists()
        assertTrue(compose.onAllNodes(hasText("Ana Pop")).fetchSemanticsNodes().isEmpty())
    }
}
