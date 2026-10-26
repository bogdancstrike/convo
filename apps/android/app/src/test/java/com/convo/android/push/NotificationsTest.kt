package com.convo.android.push

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.core.app.ApplicationProvider
import com.convo.android.FakeCore
import com.convo.android.MainActivity
import com.convo.android.Snapshots.basic
import com.convo.android.Snapshots.conversation
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

private const val ANA = "11111111-1111-4111-8111-111111111111"
private const val LOCKED = "22222222-2222-4222-8222-222222222222"

/**
 * Message notifications follow the person's preview setting, the organization's limit, chat locks
 * and the app lock; the lock-screen version never shows content.
 */
abstract class NotificationsBase(private val preview: String, private val policyMax: String? = null, private val notifications: Boolean = true) {
    init {
        ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("convo-locks", Context.MODE_PRIVATE).edit()
            .putStringSet("chats", setOf(LOCKED)).commit()
        val snapshot = basic(listOf(conversation(ANA, "Ana Pop"), conversation(LOCKED, "Secret Sam"))).apply {
            getJSONObject("settings").put("notifications", notifications).put("notificationPreview", preview)
            if (policyMax != null) put("policy", JSONObject().put("notifications", JSONObject().put("maxPreview", policyMax)))
        }
        FakeCore.install(snapshot)
    }

    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Before fun allowNotifications() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    }

    protected fun ready() = compose.waitUntil(10_000) { compose.onAllNodes(hasText("Ana Pop")).fetchSemanticsNodes().isNotEmpty() }
    protected fun manager() = shadowOf(ApplicationProvider.getApplicationContext<Context>().getSystemService(NotificationManager::class.java))
    protected fun alert(conversationId: String = ANA, body: String = "See you at 10", extra: JSONObject.() -> Unit = {}): Notification? {
        ready()
        FakeCore.current.emit("alert", JSONObject().put("conversationId", conversationId).put("title", "Ana Pop").put("body", body).apply(extra))
        compose.waitForIdle()
        return manager().allNotifications.lastOrNull()
    }
    protected fun Notification.title() = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()
    protected fun Notification.text() = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()
}

@RunWith(RobolectricTestRunner::class)
class FullPreviewNotificationsTest : NotificationsBase("full") {
    @Test fun showsSenderAndText() {
        val n = alert()!!
        assertEquals("Ana Pop", n.title()); assertEquals("See you at 10", n.text())
    }

    @Test fun theLockScreenVersionIsGeneric() {
        val public = alert()!!.publicVersion
        assertNotNull(public)
        assertEquals("Convo", public!!.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertFalse(public.extras.getCharSequence(Notification.EXTRA_TEXT).toString().contains("See you"))
    }

    @Test fun attachmentsWithoutTextSayFile() {
        val n = alert(body = "") { put("attachment", true) }!!
        assertEquals("📎 File", n.text())
    }

    @Test fun lockedChatsAreAlwaysGeneric() {
        val n = alert(LOCKED, "top secret")!!
        assertEquals("Convo", n.title()); assertEquals("New message", n.text())
    }

    @Test fun eachChatGetsItsOwnNotification() {
        alert(ANA)
        alert("33333333-3333-4333-8333-333333333333")
        assertEquals(2, manager().allNotifications.size)
    }

    @Test fun opensTheChat() {
        assertNotNull(alert()!!.contentIntent)
    }

    @Test fun eventRemindersSayWhenTheyStart() {
        ready()
        FakeCore.current.emit("reminder", JSONObject().put("conversationId", ANA).put("messageId", "e1").put("title", "Standup").put("start", System.currentTimeMillis() + 15 * 60_000))
        compose.waitForIdle()
        val n = manager().allNotifications.last()
        assertEquals("📅 Standup", n.title()); assertTrue(n.text()!!.startsWith("Starts in"))
    }
}

@RunWith(RobolectricTestRunner::class)
class SenderPreviewNotificationsTest : NotificationsBase("sender") {
    @Test fun showsTheSenderButNotTheText() {
        val n = alert()!!
        assertEquals("Ana Pop", n.title()); assertEquals("New message", n.text())
    }

    @Test fun mentionsAreCalledOut() {
        assertEquals("You were mentioned", alert { put("mention", true) }!!.text())
    }
}

@RunWith(RobolectricTestRunner::class)
class GenericPreviewNotificationsTest : NotificationsBase("generic") {
    @Test fun showsNothingButConvo() {
        val n = alert()!!
        assertEquals("Convo", n.title()); assertEquals("New message", n.text())
    }

    @Test fun genericRemindersHideTheTitle() {
        ready()
        FakeCore.current.emit("reminder", JSONObject().put("conversationId", ANA).put("messageId", "e2").put("title", "Board meeting").put("start", System.currentTimeMillis() + 60_000))
        compose.waitForIdle()
        val n = manager().allNotifications.last()
        assertEquals("Convo", n.title()); assertEquals("Upcoming event", n.text())
    }
}

@RunWith(RobolectricTestRunner::class)
class PolicyCappedNotificationsTest : NotificationsBase("full", policyMax = "sender") {
    @Test fun theOrganizationLimitWins() {
        val n = alert()!!
        assertEquals("Ana Pop", n.title()); assertEquals("New message", n.text())
    }
}

@RunWith(RobolectricTestRunner::class)
class NotificationsOffTest : NotificationsBase("full", notifications = false) {
    @Test fun nothingIsPosted() { assertNull(alert()) }
}

@RunWith(RobolectricTestRunner::class)
class PushRegistrationTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test fun endpointAndFlagsArePersisted() {
        PushRegistration.save(context, "https://ntfy.example/up123")
        assertEquals("https://ntfy.example/up123", PushRegistration.endpoint(context))
        PushRegistration.markSynced(context); assertTrue(PushRegistration.synced(context))
        PushRegistration.setNotificationsEnabled(context, true); assertTrue(PushRegistration.notificationsEnabled(context))
        PushRegistration.setRejected(context, true); assertTrue(PushRegistration.rejected(context))
        PushRegistration.save(context, null); assertNull(PushRegistration.endpoint(context))
    }

    @Test fun noDistributorOnAPlainDevice() { assertFalse(PushRegistration.distributorInstalled(context)) }

    @Test fun callWakeRingsWithoutContentAndCanBeCancelled() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        CallWake.show(context)
        val manager = shadowOf(context.getSystemService(NotificationManager::class.java))
        val n = manager.getNotification(CallWake.ID)
        assertNotNull(n)
        assertEquals("Incoming call", n.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertEquals(Notification.CATEGORY_CALL, n.category)
        assertNotNull(n.fullScreenIntent)
        CallWake.cancel(context)
        assertNull(manager.getNotification(CallWake.ID))
    }

    @Test fun callWakeNeedsThePermission() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        CallWake.show(context)
        assertNull(shadowOf(context.getSystemService(NotificationManager::class.java)).getNotification(CallWake.ID))
    }
}
