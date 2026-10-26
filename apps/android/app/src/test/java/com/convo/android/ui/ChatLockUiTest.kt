package com.convo.android.ui

import android.content.Context
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import com.convo.android.Snapshots
import com.convo.android.Snapshots.basic
import com.convo.android.Snapshots.conversation
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private const val DIRECT = "11111111-1111-4111-8111-111111111111"
private const val GROUP = "g:groupid"
private const val CHANNEL = "g:channelid"
private const val SECRET = "22222222-2222-4222-8222-222222222222"

/**
 * "Require authentication" per chat with passwordless on: offered for every kind of chat from the
 * chat ⋮ menu and the info page, only with a registered passkey; locked chats stay out of the list.
 */
@RunWith(RobolectricTestRunner::class)
class ChatLockUiTest {
    init {
        ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("convo-locks", Context.MODE_PRIVATE).edit()
            .putStringSet("chats", setOf(SECRET)).commit()
        FakeCore.install(basic(listOf(
            // Newest first: direct, note, group, channel; the locked chat is newest of all.
            conversation(SECRET, "Hidden Person", preview = "classified") { put("lastActivity", 9_000L) },
            conversation(DIRECT, "Ana Pop") { put("lastActivity", 4_000L) },
            conversation(Snapshots.ME, "Note to self", kind = "note") { put("lastActivity", 3_000L) },
            conversation(GROUP, "Night shift", kind = "group") { put("lastActivity", 2_000L) },
            conversation(CHANNEL, "Announcements", kind = "group") { put("adminOnly", true); put("lastActivity", 1_000L) },
        ))) {
            handlers["credentials"] = { JSONObject().put("state", "available").put("passkey", true).put("otp", false) }
        }
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun ready() = compose.waitUntil(10_000) { compose.onAllNodes(hasText("Ana Pop")).fetchSemanticsNodes().isNotEmpty() }
    private fun menu(index: Int) {
        ready()
        compose.onAllNodesWithContentDescription("Chat options")[index].performClick()
        compose.waitForIdle()
    }
    private fun offered() = compose.onAllNodes(hasText("Require authentication to open")).fetchSemanticsNodes().isNotEmpty()

    @Test fun directChatsCanRequireAuthentication() { menu(0); assertTrue(offered()) }
    @Test fun noteToSelfCanRequireAuthentication() { menu(1); assertTrue(offered()) }
    @Test fun groupsCanRequireAuthentication() { menu(2); assertTrue(offered()) }
    @Test fun channelsCanRequireAuthentication() { menu(3); assertTrue(offered()) }

    @Test fun lockedChatsAreLeftOutOfTheChatList() {
        ready()
        assertTrue(compose.onAllNodes(hasText("Hidden Person")).fetchSemanticsNodes().isEmpty())
        assertTrue(compose.onAllNodes(hasText("classified", substring = true)).fetchSemanticsNodes().isEmpty())
        assertEquals("one ⋮ per visible chat", 4, compose.onAllNodesWithContentDescription("Chat options").fetchSemanticsNodes().size)
    }

    @Test fun lockingAsksForTheDeviceCheckFirst() {
        // No biometric hardware under Robolectric: the lock is refused with an explanation, never applied silently.
        menu(0); compose.onNodeWithText("Require authentication to open").performClick(); compose.waitForIdle()
        compose.onAllNodesWithContentDescription("Chat options")[0].performClick(); compose.waitForIdle()
        assertTrue("still unlocked", offered())
    }

    @Test fun theInfoPageOffersTheSameSwitch() {
        ready()
        compose.onNodeWithText("Ana Pop").performClick(); compose.waitForIdle()
        compose.onNodeWithContentDescription("Chat options").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Contact info").performClick(); compose.waitForIdle()
        compose.waitUntil(5_000) { offered() }
    }
}
