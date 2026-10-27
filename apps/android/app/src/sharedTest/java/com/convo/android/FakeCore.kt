package com.convo.android

import android.os.Handler
import android.os.Looper
import android.view.View
import com.convo.android.bridge.CoreTransport
import com.convo.android.bridge.CoreTransports
import org.json.JSONArray
import org.json.JSONObject

/**
 * Stand-in for the shared encryption core in JVM UI tests: answers commands from [handlers]
 * (default: ok with null) and emits events like the real core (phase, snapshot, …).
 */
class FakeCore(private val receive: (String, JSONObject) -> Unit) : CoreTransport {
    override val view: View? = null
    val commands = mutableListOf<Pair<String, JSONObject>>()
    val handlers = mutableMapOf<String, (JSONObject) -> Any?>()
    private val main = Handler(Looper.getMainLooper())

    override fun command(method: String, args: JSONObject, callback: (JSONObject) -> Unit) {
        commands += method to args
        val value = handlers[method]?.invoke(args)
        val result = if (value is Throwable) JSONObject().put("ok", false).put("error", value.message ?: "operation-failed")
                     else JSONObject().put("ok", true).put("value", value ?: JSONObject.NULL)
        main.post { callback(result) }
    }

    fun emit(type: String, value: JSONObject) = main.post { receive(type, value) }
    override fun destroy() {}

    companion object {
        /** The instance created for the activity under test. */
        lateinit var current: FakeCore

        /**
         * Installs the fake for the next activity, starting it in [phase] (default "ready") with [snapshot], as a returning
         * user: first-run notices (background delivery, notification offer) are already behind them.
         */
        fun install(snapshot: JSONObject = Snapshots.basic(), phase: JSONObject = JSONObject().put("name", "ready"), setup: FakeCore.() -> Unit = {}) {
            androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
                .getSharedPreferences("MainActivity", android.content.Context.MODE_PRIVATE).edit()
                .putBoolean("backgroundDefaultApplied", true).putBoolean("notificationsOffered", true).commit()
            CoreTransports.factory = { _, _, receive ->
                FakeCore(receive).also { core ->
                    current = core
                    core.setup()
                    core.emit("phase", phase)
                    core.emit("snapshot", snapshot)
                }
            }
        }
    }
}

/** Snapshot builders shaped like the core's `snapshot` event. */
object Snapshots {
    const val ME = "00000000-0000-4000-8000-000000000001"

    fun conversation(id: String, title: String, kind: String = "direct", unread: Int = 0, preview: String = "", extra: JSONObject.() -> Unit = {}) =
        JSONObject().put("id", id).put("title", title).put("kind", kind).put("unread", unread).put("preview", preview)
            .put("lastActivity", System.currentTimeMillis()).apply(extra)

    fun message(id: String, author: String, body: String, direction: String = "in", extra: JSONObject.() -> Unit = {}) =
        JSONObject().put("id", id).put("authorId", author).put("body", body).put("direction", direction)
            .put("sentAt", System.currentTimeMillis()).put("sort", System.currentTimeMillis()).put("status", "delivered").put("reactions", JSONObject()).apply(extra)

    fun basic(conversations: List<JSONObject> = listOf(conversation("11111111-1111-4111-8111-111111111111", "Ana Pop", preview = "See you at 10")),
              messages: List<JSONObject> = emptyList(), active: String? = null): JSONObject =
        JSONObject().put("accountId", ME).put("device", JSONObject().put("accountId", ME).put("deviceId", 1))
            .put("conversations", JSONArray(conversations)).put("settings", JSONObject().put("animations", false))
            .put("policy", JSONObject()).put("profiles", JSONObject()).put("history", "synced").put("connection", "online")
            .put("limits", JSONObject().put("attachmentMaxBytes", 104857600)).put("messages", JSONArray(messages))
            .apply { if (active != null) put("active", active) }
}
