package com.convo.android

import com.convo.android.ui.chats.folderMatches
import com.convo.android.ui.contacts.label
import com.convo.android.ui.thread.targetArgs
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

class JsonHelpersTest {
    @Test fun objMapsNullsToJsonNull() {
        val o = obj("a" to 1, "b" to null, "c" to "x")
        assertEquals(1, o.getInt("a")); assertTrue(o.isNull("b")); assertEquals("x", o.getString("c"))
    }

    @Test fun objectsSkipsNonObjects() {
        val a = JSONArray().put(JSONObject().put("i", 1)).put("text").put(3).put(JSONObject().put("i", 2))
        assertEquals(listOf(1, 2), a.objects().map { it.getInt("i") })
        assertEquals(emptyList<JSONObject>(), JSONArray().objects())
    }

    @Test fun labelPrefersDisplayNameThenUsernameThenTitle() {
        assertEquals("Ana Pop", JSONObject().put("displayName", "Ana Pop").put("username", "ana").label())
        assertEquals("ana", JSONObject().put("displayName", "").put("username", "ana").label())
        assertEquals("ana", JSONObject().put("displayName", "null").put("username", "ana").label())
        assertEquals("Team", JSONObject().put("title", "Team").label())
    }

    @Test fun targetArgsIdentifyAMessage() {
        val m = JSONObject().put("id", "m1").put("authorId", "a1")
        val args = m.targetArgs("c1")
        assertEquals("c1", args.getString("conversationId")); assertEquals("m1", args.getString("id")); assertEquals("a1", args.getString("authorId"))
    }
}

/** Mirrors core/folders.ts: explicit chats or included types, optionally unread only. */
@RunWith(Parameterized::class)
class FolderMatchesTest(private val name: String, private val folder: JSONObject, private val chat: JSONObject, private val expected: Boolean) {
    companion object {
        private fun folder(types: List<String> = emptyList(), chats: List<String> = emptyList(), unread: Boolean = false) =
            JSONObject().put("types", JSONArray(types)).put("chats", JSONArray(chats)).put("unreadOnly", unread)
        private fun chat(id: String, kind: String, adminOnly: Boolean = false, unread: Int = 0) =
            JSONObject().put("id", id).put("kind", kind).put("adminOnly", adminOnly).put("unread", unread)

        @JvmStatic @Parameterized.Parameters(name = "{0}")
        fun cases() = listOf(
            arrayOf<Any>("direct type", folder(listOf("direct")), chat("d", "direct"), true),
            arrayOf<Any>("group type excludes direct", folder(listOf("group")), chat("d", "direct"), false),
            arrayOf<Any>("group type", folder(listOf("group")), chat("g", "group"), true),
            arrayOf<Any>("channel is not a group", folder(listOf("group")), chat("c", "group", adminOnly = true), false),
            arrayOf<Any>("channel type", folder(listOf("channel")), chat("c", "group", adminOnly = true), true),
            arrayOf<Any>("note has no type", folder(listOf("direct", "group", "channel")), chat("n", "note"), false),
            arrayOf<Any>("explicit chat", folder(chats = listOf("n")), chat("n", "note"), true),
            arrayOf<Any>("explicit other chat", folder(chats = listOf("x")), chat("n", "note"), false),
            arrayOf<Any>("empty folder", folder(), chat("d", "direct"), false),
            arrayOf<Any>("unread only without unread", folder(listOf("direct"), unread = true), chat("d", "direct", unread = 0), false),
            arrayOf<Any>("unread only with unread", folder(listOf("direct"), unread = true), chat("d", "direct", unread = 3), true),
            arrayOf<Any>("explicit chat but read", folder(chats = listOf("d"), unread = true), chat("d", "direct"), false),
            arrayOf<Any>("missing arrays", JSONObject(), chat("d", "direct"), false),
        )
    }
    @Test fun matches() = assertEquals(expected, folderMatches(folder, chat))
}
