package com.convo.android.ui

import android.Manifest
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import com.convo.android.Snapshots.basic
import com.convo.android.Snapshots.conversation
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

private const val PEER = "11111111-1111-4111-8111-111111111111"
private const val GROUP = "g:groupid"

/**
 * Call signalling on Android without media: incoming invites, answering, declining, remote hang-ups,
 * busy handling, failures, call links and the call history. No join is ever returned, so LiveKit is
 * never reached.
 */
@RunWith(RobolectricTestRunner::class)
class CallsUiTest {
    init {
        FakeCore.install(basic(listOf(conversation(PEER, "Ana Pop"), conversation(GROUP, "Night shift", kind = "group")))) {
            handlers["callLog"] = { JSONArray()
                .put(JSONObject().put("callId", "k1").put("conversationId", PEER).put("direction", "in").put("status", "missed").put("video", false).put("startedAt", System.currentTimeMillis()))
                .put(JSONObject().put("callId", "k2").put("conversationId", GROUP).put("direction", "out").put("status", "answered").put("video", true).put("startedAt", System.currentTimeMillis() - 86_400_000L)) }
        }
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Before fun grantMediaPermissions() {
        shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).grantPermissions(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
    }

    private fun core() = FakeCore.current
    private fun calls() = compose.activity.calls
    private fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()
    private fun ready() = compose.waitUntil(10_000) { has("Ana Pop") }
    private fun incoming(callId: String = "c1", conversationId: String = PEER, video: Boolean = false) {
        core().emit("call", JSONObject().put("type", "incoming").put("invite", JSONObject().put("callId", callId).put("conversationId", conversationId).put("video", video).put("at", System.currentTimeMillis())))
        compose.waitForIdle()
    }
    private fun remote(action: String, callId: String = "c1", fromSelf: Boolean = false) {
        core().emit("call", JSONObject().put("type", "signal").put("callId", callId).put("action", action).put("fromSelf", fromSelf)); compose.waitForIdle()
    }

    @Test fun anIncomingCallRings() {
        ready(); incoming(video = true)
        assertEquals("incoming", calls().call?.phase); assertTrue(calls().call!!.video)
    }

    @Test fun decliningTellsTheCaller() {
        ready(); incoming()
        compose.runOnUiThread { calls().decline() }; compose.waitForIdle()
        assertEquals("c1", core().commands.last { it.first == "declineCall" }.second.getString("callId"))
    }

    @Test fun aSecondCallWhileBusyIsDeclinedAsBusy() {
        ready(); incoming("c1"); incoming("c2")
        val busy = core().commands.last { it.first == "declineCall" }.second
        assertEquals("c2", busy.getString("callId")); assertTrue(busy.getBoolean("busy"))
        assertEquals("c1", calls().call?.callId)
    }

    @Test fun answeringOnAnotherDeviceStopsRinging() {
        ready(); incoming(); remote("answer", fromSelf = true)
        assertTrue(calls().call?.phase != "incoming")
    }

    @Test fun theCallerCancelling() { ready(); incoming(); remote("cancel"); assertEquals("ended", calls().call?.phase ?: "ended") }

    @Test fun signalsForOtherCallsAreIgnored() { ready(); incoming("c1"); remote("cancel", callId = "other"); assertEquals("incoming", calls().call?.phase) }

    @Test fun answeringAsksTheCoreToJoin() {
        core().handlers["answerCall"] = { null }
        ready(); incoming()
        compose.runOnUiThread { calls().accept() }; compose.waitForIdle()
        assertTrue(core().commands.any { it.first == "answerCall" && it.second.getString("callId") == "c1" })
        // Without a join the call fails cleanly instead of hanging in "connecting".
        assertTrue(calls().call == null || calls().call?.phase == "ended")
    }

    @Test fun startingACallThatCannotBeSetUpFails() {
        core().handlers["startCall"] = { null }
        ready(); compose.runOnUiThread { calls().start(PEER, false) }; compose.waitForIdle()
        val start = core().commands.last { it.first == "startCall" }.second
        assertEquals(PEER, start.getString("conversationId")); assertEquals(false, start.getBoolean("video"))
        assertTrue(calls().call == null || calls().call?.phase == "ended")
    }

    @Test fun onlyOneCallAtATime() {
        ready(); incoming()
        compose.runOnUiThread { calls().start(PEER, false) }; compose.waitForIdle()
        assertTrue(core().commands.none { it.first == "startCall" })
    }

    @Test fun anUnavailableCallLinkFails() {
        core().handlers["joinCallLink"] = { null }
        ready(); compose.runOnUiThread { calls().joinLink("token") }; compose.waitForIdle()
        assertEquals("token", core().commands.last { it.first == "joinCallLink" }.second.getString("token"))
        assertTrue(calls().call == null || calls().call?.phase == "ended")
    }

    @Test fun aCallLinkWithoutTheKeyFails() {
        core().handlers["joinCallLink"] = { JSONObject().put("keyUnavailable", true) }
        ready(); compose.runOnUiThread { calls().joinLink("token") }; compose.waitForIdle()
        assertTrue(calls().call == null || calls().call?.phase == "ended")
    }

    @Test fun releaseClearsTheCall() {
        ready(); incoming()
        compose.runOnUiThread { calls().release() }; compose.waitForIdle()
        assertNull(calls().call)
    }

    @Test fun historyListsCallsWithStatus() {
        ready(); compose.onNodeWithText("Calls").performClick()
        compose.waitUntil(5_000) { has("Clear call history") }
        assertTrue(has("Missed")); assertTrue(has("Answered"))
    }

    @Test fun clearingTheHistory() {
        ready(); compose.onNodeWithText("Calls").performClick()
        compose.waitUntil(5_000) { has("Clear call history") }
        compose.onNodeWithText("Clear call history").performClick(); compose.waitForIdle()
        assertTrue(core().commands.any { it.first == "clearCallLog" })
    }

    @Test fun emptyHistoryOffersANewCall() {
        core().handlers["callLog"] = { JSONArray() }
        ready(); compose.onNodeWithText("Calls").performClick()
        compose.waitUntil(5_000) { has("No calls yet") }
    }
}
