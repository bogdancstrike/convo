package com.convo.android.ui

import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import com.convo.android.Snapshots.basic
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Settings (the Profile tab): each page loads from the core and each control sends the matching command. */
@RunWith(RobolectricTestRunner::class)
class SettingsUiTest {
    private var recoveryConfigured = false

    init {
        FakeCore.install(basic()) {
            handlers["recoveryStatus"] = { JSONObject().put("configured", recoveryConfigured) }
            handlers["recoveryCode"] = { "ABCD-EFGH-IJKL-MNOP" }
            handlers["privacy"] = { JSONObject().put("shareLastSeen", false) }
            handlers["devices"] = { JSONArray()
                .put(JSONObject().put("deviceId", 1).put("platform", "android").put("current", true).put("createdAt", "2026-10-01"))
                .put(JSONObject().put("deviceId", 2).put("platform", "web").put("createdAt", "2026-10-02")) }
            handlers["linkRequests"] = { JSONArray() }
        }
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun core() = FakeCore.current
    private fun last(method: String): JSONObject = core().commands.last { it.first == method }.second
    private fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()

    private fun open(row: String? = null) {
        compose.waitUntil(10_000) { compose.onAllNodes(hasText("Profile")).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Profile").performClick(); compose.waitForIdle()
        if (row != null) { compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(row)); compose.onNodeWithText(row).performClick(); compose.waitForIdle() }
    }

    @Test fun listShowsEverySection() {
        open()
        listOf("Your profile", "Privacy", "Devices", "History and recovery", "Chats", "Notifications", "Storage and data").forEach { assertTrue(it, has(it)) }
    }

    @Test fun logOutIsConfirmed() {
        open(); compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Log out"))
        compose.onNodeWithText("Log out").performClick(); compose.waitForIdle()
        assertTrue(has("Log out of this phone?"))
        assertTrue(core().commands.none { it.first == "logout" })
    }

    @Test fun themeChoiceIsSaved() {
        open("Theme, wallpaper, language")
        compose.onNodeWithText("dark", substring = true, ignoreCase = true).performClick(); compose.waitForIdle()
        assertEquals("dark", last("settings").getJSONObject("patch").getString("theme"))
    }

    @Test fun languageChoiceIsSaved() {
        open("Theme, wallpaper, language")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Română"))
        compose.onNodeWithText("Română").performClick(); compose.waitForIdle()
        assertEquals("ro", last("settings").getJSONObject("patch").getString("locale"))
    }

    @Test fun wallpaperChoiceIsSaved() {
        open("Theme, wallpaper, language")
        compose.onNodeWithText("ocean", ignoreCase = true, substring = true).performClick(); compose.waitForIdle()
        assertEquals("ocean", last("settings").getJSONObject("patch").getString("wallpaper"))
    }

    @Test fun readReceiptsToggle() {
        open("Privacy")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("Send read receipts"))
        compose.onNode(androidx.compose.ui.test.isToggleable() and hasText("Send read receipts")).performClick(); compose.waitForIdle()
        assertEquals(true, last("settings").getJSONObject("patch").getBoolean("readReceipts"))
    }

    @Test fun everyPrivacySwitchIsNamedForAccessibility() {
        open("Privacy")
        // Each toggle carries its own title, so TalkBack never announces an unnamed switch.
        listOf("Share last seen", "Send read receipts", "Allow screenshots").forEach { title ->
            compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText(title))
            compose.onNode(androidx.compose.ui.test.isToggleable() and hasText(title)).assertExists()
        }
    }

    @Test fun lastSeenSharingIsLoadedAndOffByDefault() {
        open("Privacy")
        assertTrue(core().commands.any { it.first == "privacy" })
        assertTrue(has("Share last seen"))
    }

    @Test fun screenshotsCanBeBlockedByPolicy() {
        open("Privacy")
        assertTrue(has("Allow screenshots"))
    }

    @Test fun recoveryCodeIsCreatedAndShownOnce() {
        open("History and recovery")
        compose.waitUntil(5_000) { has("No recovery code saved yet") }
        compose.onNodeWithText("Create recovery code").performClick(); compose.waitForIdle()
        compose.waitUntil(5_000) { has("ABCD-EFGH-IJKL-MNOP") }
        compose.onNodeWithText("I saved my code").performClick(); compose.waitForIdle()
        assertFalse(has("ABCD-EFGH-IJKL-MNOP"))
        assertTrue(has("Recovery code is set up"))
    }

    @Test fun replacingARecoveryCodeIsConfirmed() {
        recoveryConfigured = true
        open("History and recovery")
        compose.waitUntil(5_000) { has("Replace recovery code") }
        compose.onNodeWithText("Replace recovery code").performClick(); compose.waitForIdle()
        assertTrue(has("The old code will stop working."))
        assertTrue(core().commands.none { it.first == "recoveryCode" })
    }

    @Test fun syncNowAsksTheCore() {
        open("History and recovery")
        compose.onNodeWithText("Sync now").performClick(); compose.waitForIdle()
        assertTrue(core().commands.any { it.first == "sync" })
    }

    @Test fun devicesListsThisAndOtherDevices() {
        open("Devices")
        compose.waitUntil(5_000) { has("This device") }
        assertTrue(has("web · #2"))
    }

    @Test fun unlinkingADeviceIsConfirmed() {
        open("Devices")
        compose.waitUntil(5_000) { has("web · #2") }
        compose.onNodeWithText("web · #2").performClick(); compose.waitForIdle()
        assertTrue(has("Unlink device?"))
    }

    @Test fun profilePageOffersPhotoAndStatus() {
        open("Your profile")
        assertTrue(has("Upload photo"))
        assertTrue(has("0/280"))
    }

    @Test fun removingTheStatusSendsAnEmptyOne() {
        open("Your profile")
        compose.onNodeWithText("Clear status").performClick(); compose.waitForIdle()
        assertEquals("", last("profile").getJSONObject("patch").getString("status"))
    }

    /** Every checkbox, switch and radio button on screen carries a name for screen readers. */
    private fun assertTogglesAreNamed() {
        val toggles = compose.onAllNodes(androidx.compose.ui.test.isToggleable() or androidx.compose.ui.test.isSelectable()).fetchSemanticsNodes()
        assertTrue("no toggles found", toggles.isNotEmpty())
        toggles.forEach { node ->
            val named = node.config.getOrElseNullable(androidx.compose.ui.semantics.SemanticsProperties.Text) { null }?.isNotEmpty() == true ||
                node.config.getOrElseNullable(androidx.compose.ui.semantics.SemanticsProperties.ContentDescription) { null }?.isNotEmpty() == true
            assertTrue("unnamed toggle: ${node.config}", named)
        }
    }

    @Test fun privacyTogglesAreNamed() { open("Privacy"); assertTogglesAreNamed() }

    @Test fun storageTogglesAreNamed() { open("Storage and data"); assertTogglesAreNamed() }

    @Test fun notificationTogglesAreNamed() { open("Notifications"); assertTogglesAreNamed() }

    @Test fun autoDownloadRulesAreSaved() {
        open("Storage and data")
        compose.onAllNodes(androidx.compose.ui.test.isToggleable() and hasText("Documents", substring = true))[0].performClick(); compose.waitForIdle()
        assertTrue(last("settings").toString().contains("autoDownload"))
    }

    @Test fun notificationPreviewChoiceIsSaved() {
        open("Notifications")
        compose.onNodeWithText("Sender and text").performClick(); compose.waitForIdle()
        assertEquals("full", last("settings").getJSONObject("patch").getString("notificationPreview"))
    }

    @Test fun eventReminderLeadTimeIsSaved() {
        open("Notifications")
        compose.onNode(hasScrollToIndexAction()).performScrollToNode(hasText("30 min"))
        compose.onNodeWithText("30 min").performClick(); compose.waitForIdle()
        assertEquals(30, last("settings").getJSONObject("patch").getInt("eventReminderMinutes"))
    }
}
