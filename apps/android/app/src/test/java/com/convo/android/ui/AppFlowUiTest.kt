package com.convo.android.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import com.convo.android.Snapshots.basic
import com.convo.android.Snapshots.conversation
import com.convo.android.push.MessageNotifications
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

private const val ANA = "11111111-1111-4111-8111-111111111111"

/** Screens before the app is ready: preparing, signing in, linking this phone, recovery, errors. */
abstract class PhaseUiBase(phase: JSONObject) {
    init { FakeCore.install(basic(), phase) }
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    protected fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()
    protected fun waitFor(text: String) = compose.waitUntil(10_000) { has(text) }
}

@RunWith(RobolectricTestRunner::class)
class LoadingPhaseTest : PhaseUiBase(JSONObject().put("name", "loading")) {
    @Test fun showsPreparing() = waitFor("Preparing your encrypted messages…")
}

@RunWith(RobolectricTestRunner::class)
class WelcomePhaseTest : PhaseUiBase(JSONObject().put("name", "welcome")) {
    @Test fun offersSignInAndShowsTheServer() {
        waitFor("Sign in with your organization")
        assertTrue(has("Private messaging for your organization")); assertTrue(has("https://"))
    }

    @Test fun serverAddressesMustBePlainHttps() {
        waitFor("Sign in with your organization")
        compose.runOnUiThread { compose.activity.setServer("http://convo.example") }
        assertTrue(compose.activity.error!!.startsWith("Enter an HTTPS server address"))
        compose.runOnUiThread { compose.activity.error = null; compose.activity.setServer("https://user@convo.example") }
        assertTrue(compose.activity.error != null)
        compose.runOnUiThread { compose.activity.error = null; compose.activity.setServer("https://convo.example/path") }
        assertTrue(compose.activity.error != null)
    }
}

@RunWith(RobolectricTestRunner::class)
class ErrorPhaseTest : PhaseUiBase(JSONObject().put("name", "error")) {
    @Test fun explainsTheStorageError() = waitFor("Could not initialize secure local storage")
}

@RunWith(RobolectricTestRunner::class)
class LinkPhaseTest : PhaseUiBase(JSONObject().put("name", "link").put("code", "123-456")) {
    @Test fun showsTheComparisonCode() {
        waitFor("Link this phone"); assertTrue(has("123-456"))
    }

    @Test fun aNewCodeCanBeRequested() {
        waitFor("Get a new code")
        compose.onNodeWithText("Get a new code").performClick(); compose.waitForIdle()
        assertTrue(FakeCore.current.commands.any { it.first == "newLink" })
    }

    @Test fun recoveryNeedsAFullCode() {
        waitFor("Lost every device?")
        compose.onNodeWithText("Lost every device? Use a recovery code").performClick(); compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText("Recover account") and isEnabled()).fetchSemanticsNodes().isEmpty())
        compose.onNode(hasSetTextAction()).performTextInput("ab".repeat(32)); compose.waitForIdle()
        compose.onNodeWithText("Recover account").performClick(); compose.waitForIdle()
        assertEquals("ab".repeat(32), FakeCore.current.commands.last { it.first == "recover" }.second.getString("code"))
    }
}

/** Navigation, notification intents and call links once the app is ready. */
@RunWith(RobolectricTestRunner::class)
class NavigationUiTest {
    init { FakeCore.install(basic(listOf(conversation(ANA, "Ana Pop")))) }
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun app() = compose.activity
    private fun ready() = compose.waitUntil(10_000) { compose.onAllNodes(hasText("Ana Pop")).fetchSemanticsNodes().isNotEmpty() }
    /** Delivers an intent to the running activity, as Android does for a notification tap or a link. */
    private fun deliver(intent: Intent) {
        android.app.Activity::class.java.getDeclaredMethod("onNewIntent", Intent::class.java).let { MainActivity::class.java.getDeclaredMethod("onNewIntent", Intent::class.java) }
            .apply { isAccessible = true }.invoke(app(), intent)
    }

    @Test fun backWalksFromInfoToThreadToList() {
        ready()
        compose.runOnUiThread { app().openChat(ANA); app().route = "info" }
        compose.runOnUiThread { app().back() }; assertEquals("thread", app().route)
        compose.runOnUiThread { app().back() }; assertEquals("list", app().route); assertNull(app().active)
        assertTrue(FakeCore.current.commands.any { it.first == "close" })
    }

    @Test fun backLeavesSearchAndSelectionFirst() {
        ready()
        compose.runOnUiThread { app().openChat(ANA); app().threadSearch = true }
        compose.runOnUiThread { app().back() }; assertEquals("thread", app().route); assertTrue(!app().threadSearch)
        compose.runOnUiThread { app().selection = setOf("a/1") }
        compose.runOnUiThread { app().back() }; assertNull(app().selection); assertEquals("thread", app().route)
    }

    @Test fun selectionIsCappedAt100() {
        ready()
        compose.runOnUiThread { app().selection = (1..100).map { "a/$it" }.toSet(); app().toggleSelected("a/101") }
        assertEquals(100, app().selection!!.size)
        compose.runOnUiThread { app().toggleSelected("a/1") }
        assertEquals(99, app().selection!!.size)
    }

    @Test fun aChatOpenedFromAnotherScreenReturnsThere() {
        ready()
        compose.runOnUiThread { app().selectedTab = "Communities"; app().route = "community:c1"; app().openChatFrom(ANA) }
        compose.runOnUiThread { app().back() }
        assertEquals("community:c1", app().route); assertEquals("Communities", app().selectedTab)
    }

    @Test fun settingsPagesGoBackToTheList() {
        ready()
        compose.runOnUiThread { app().selectedTab = "Settings"; app().route = "privacy"; app().back() }
        assertEquals("list", app().route)
    }

    @Test fun communityPagesGoBackStepByStep() {
        ready()
        compose.runOnUiThread { app().route = "community-onboarding:c1"; app().back() }; assertEquals("community:c1", app().route)
        compose.runOnUiThread { app().back() }; assertEquals("list", app().route)
        compose.runOnUiThread { app().route = "contact-media:x"; app().back() }; assertEquals("contact:x", app().route)
        compose.runOnUiThread { app().back() }; assertEquals("info", app().route)
    }

    @Test fun aNotificationTapOpensItsChat() {
        ready()
        compose.runOnUiThread { deliver(Intent().putExtra(MessageNotifications.EXTRA_CONVERSATION, ANA)) }
        assertEquals(ANA, app().active); assertEquals("thread", app().route)
    }

    @Test fun callLinksForThisServerJoinTheCall() {
        org.robolectric.Shadows.shadowOf(androidx.test.core.app.ApplicationProvider.getApplicationContext<android.app.Application>()).grantPermissions(android.Manifest.permission.RECORD_AUDIO)
        FakeCore.current.handlers["joinCallLink"] = { null }
        ready()
        val token = "A".repeat(43)
        compose.runOnUiThread { deliver(Intent(Intent.ACTION_VIEW, Uri.parse(app().serverAddress() + "/call/" + token))) }
        compose.waitForIdle()
        assertEquals(token, FakeCore.current.commands.lastOrNull { it.first == "joinCallLink" }?.second?.getString("token"))
    }

    @Test fun callLinksForOtherServersAreIgnored() {
        ready()
        compose.runOnUiThread { deliver(Intent(Intent.ACTION_VIEW, Uri.parse("https://evil.example/call/" + "A".repeat(43)))) }
        compose.waitForIdle()
        assertTrue(FakeCore.current.commands.none { it.first == "joinCallLink" })
    }

    @Test fun malformedCallLinksAreIgnored() {
        ready()
        compose.runOnUiThread { deliver(Intent(Intent.ACTION_VIEW, Uri.parse(app().serverAddress() + "/call/short"))) }
        compose.waitForIdle()
        assertTrue(FakeCore.current.commands.none { it.first == "joinCallLink" })
    }

    @Test fun coreErrorsBecomeReadableMessages() {
        ready()
        FakeCore.current.handlers["leaveGroup"] = { Throwable("FORBIDDEN_ROLE") }
        compose.runOnUiThread { app().call("leaveGroup", JSONObject()) }; compose.waitForIdle()
        assertEquals("Only a group owner or admin can do that.", app().error)
        FakeCore.current.handlers["x"] = { Throwable("something-else") }
        compose.runOnUiThread { app().call("x") }; compose.waitForIdle()
        assertTrue(app().error!!.startsWith("Could not complete that action."))
    }

    @Test fun slowModeErrorsSayHowLong() {
        ready()
        FakeCore.current.handlers["send"] = { Throwable("slow-mode:${System.currentTimeMillis() + 90_000}") }
        compose.runOnUiThread { app().call("send") }; compose.waitForIdle()
        assertTrue(app().error!!.startsWith("Slow mode: you can send again in"))
    }

    @Test fun quietCallsShowNoError() {
        ready()
        FakeCore.current.handlers["y"] = { Throwable("boom") }
        compose.runOnUiThread { app().error = null; app().call("y", quiet = true) }; compose.waitForIdle()
        assertNull(app().error)
    }

    @Test fun mediaHelpersRoundTrip() {
        ready()
        val bytes = byteArrayOf(0, 1, 2, -1, 127)
        assertTrue(bytes.contentEquals(app().decode(app().encode(bytes))))
        assertEquals(104857600L, app().attachmentLimit())
    }
}
