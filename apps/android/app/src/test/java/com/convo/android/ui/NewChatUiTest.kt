package com.convo.android.ui

import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
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
private const val DAN = "44444444-4444-4444-8444-444444444444"
private const val BOT = "55555555-5555-4555-8555-555555555555"

private fun account(id: String, username: String, name: String, extra: JSONObject.() -> Unit = {}) =
    JSONObject().put("accountId", id).put("username", username).put("displayName", name).apply(extra)

/** New chat: the picker, directory search, note to self, and the group wizard. */
@RunWith(RobolectricTestRunner::class)
class NewChatUiTest {
    init {
        FakeCore.install(basic(listOf(conversation(ANA, "Ana Pop")))) {
            handlers["account"] = { args -> if (args.getString("id") == ANA) account(ANA, "ana", "Ana Pop") else JSONObject.NULL }
            handlers["directory"] = { args ->
                val q = args.getString("query")
                JSONArray(listOf(account(DAN, "dan", "Dan Popa"), account(BOT, "helpbot", "Help Bot") { put("integration", JSONObject().put("kind", "bot").put("retention", "Deleted after 30 days.")) })
                    .filter { it.getString("displayName").contains(q, ignoreCase = true) || it.getString("username").contains(q, ignoreCase = true) })
            }
            handlers["newChat"] = { args -> JSONObject().put("id", args.getString("id")) }
            handlers["createGroup"] = { JSONObject().put("id", "g:new") }
        }
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun core() = FakeCore.current
    private fun has(text: String) = compose.onAllNodes(hasText(text, substring = true)).fetchSemanticsNodes().isNotEmpty()
    private fun last(method: String): JSONObject = core().commands.last { it.first == method }.second

    private fun openPicker() {
        compose.waitUntil(10_000) { has("Ana Pop") }
        compose.onNode(hasContentDescription("New chat")).performClick(); compose.waitForIdle()
        compose.waitUntil(5_000) { has("Note to self") }
    }
    private fun search(text: String) {
        compose.onNode(hasSetTextAction()).performTextInput(text)
        compose.mainClock.advanceTimeBy(400); compose.waitForIdle()
    }

    @Test fun pickerOffersShortcutsAndContacts() {
        openPicker()
        listOf("New group", "New community", "Note to self", "Join with invite link", "Find phone contacts").forEach { assertTrue(it, has(it)) }
        compose.waitUntil(5_000) { has("@ana") }
    }

    @Test fun noteToSelfOpensTheOwnChat() {
        openPicker(); compose.onNodeWithText("Note to self").performClick(); compose.waitForIdle()
        assertEquals(Snapshots.ME, last("newChat").getString("id"))
        assertTrue(core().commands.any { it.first == "open" && it.second.getString("id") == Snapshots.ME })
    }

    @Test fun searchingAsksTheDirectory() {
        openPicker(); search("dan")
        compose.waitUntil(5_000) { has("Dan Popa") }
        assertEquals("dan", last("directory").getString("query"))
        assertTrue(has("Directory results"))
    }

    @Test fun choosingAPersonStartsTheChat() {
        openPicker(); search("dan")
        compose.waitUntil(5_000) { has("Dan Popa") }
        compose.onNodeWithText("Dan Popa").performClick(); compose.waitForIdle()
        assertEquals(DAN, last("newChat").getString("id"))
    }

    @Test fun noMatchesSaysSo() {
        openPicker(); search("zzzz")
        compose.waitUntil(5_000) { has("No matching people") }
    }

    @Test fun integrationAccountsAreLabelled() {
        openPicker(); search("help")
        compose.waitUntil(5_000) { has("Help Bot") }
        assertTrue(has("Bot"))
    }

    @Test fun groupWizardCreatesTheGroup() {
        openPicker(); compose.onNodeWithText("New group").performClick(); compose.waitForIdle()
        compose.waitUntil(5_000) { has("1  People") }
        search("dan"); compose.waitUntil(5_000) { has("Dan Popa") }
        compose.onNodeWithText("Dan Popa").performClick(); compose.waitForIdle()
        compose.onNodeWithText("Next (1)").performClick(); compose.waitForIdle()
        compose.onNode(hasSetTextAction()).performTextInput("Weekend crew"); compose.waitForIdle()
        compose.onNodeWithText("Review").performClick(); compose.waitForIdle()
        assertTrue(has("2 participants · You will be the owner"))
        compose.onNode(hasText("Create", substring = true) and androidx.compose.ui.test.hasClickAction()).performClick(); compose.waitForIdle()
        val create = last("createGroup")
        assertEquals("Weekend crew", create.getString("name")); assertEquals(DAN, create.getJSONArray("members").getString(0)); assertEquals(false, create.getBoolean("channel"))
    }

    @Test fun addingABotToAGroupIsConfirmed() {
        openPicker(); compose.onNodeWithText("New group").performClick(); compose.waitForIdle()
        search("help"); compose.waitUntil(5_000) { has("Help Bot") }
        compose.onNodeWithText("Help Bot").performClick(); compose.waitForIdle()
        assertTrue(has("Add a bot?")); assertTrue(has("will receive every message in this group"))
    }

    @Test fun theWizardNeedsPeopleFirst() {
        openPicker(); compose.onNodeWithText("New group").performClick(); compose.waitForIdle()
        assertTrue(compose.onAllNodes(hasText("Next (0)") and androidx.compose.ui.test.isEnabled()).fetchSemanticsNodes().isEmpty())
    }
}
