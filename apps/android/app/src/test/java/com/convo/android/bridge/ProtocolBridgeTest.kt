package com.convo.android.bridge

import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowLooper

private const val ORIGIN = "https://convo.example"

/**
 * The headless WebView that runs the shared core: it may load only the bundled core from a
 * synthetic page on the configured HTTPS origin and talk only to that origin's API; commands and
 * results cross the JavaScript bridge as JSON.
 */
@RunWith(RobolectricTestRunner::class)
class ProtocolBridgeTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val events = mutableListOf<Pair<String, JSONObject>>()
    /** A bridge whose WebView is attached to a window, as in the app (posted work runs only when attached). */
    private fun bridge(origin: String = ORIGIN): ProtocolBridge {
        val b = ProtocolBridge(context, origin) { type, value -> events += type to value }
        org.robolectric.Robolectric.buildActivity(android.app.Activity::class.java).setup().get().setContentView(b.webView)
        return b
    }

    private fun request(url: String) = object : WebResourceRequest {
        override fun getUrl(): Uri = Uri.parse(url)
        override fun isForMainFrame() = false
        override fun isRedirect() = false
        override fun hasGesture() = false
        override fun getMethod() = "GET"
        override fun getRequestHeaders(): Map<String, String> = emptyMap()
    }
    private fun intercept(b: ProtocolBridge, url: String) = shadowOf(b.webView).webViewClient.shouldInterceptRequest(b.webView, request(url))
    private fun emit(b: ProtocolBridge, json: String) {
        val target = shadowOf(b.webView).getJavascriptInterface("NativeConvo")
        target.javaClass.getMethod("emit", String::class.java).apply { isAccessible = true }.invoke(target, json)
        ShadowLooper.idleMainLooper()
    }

    @Test fun onlyPlainHttpsOriginsAreAccepted() {
        listOf("http://convo.example", "https://user@convo.example", "https://convo.example?x=1").forEach { origin ->
            assertThrows(IllegalArgumentException::class.java) { bridge(origin) }
        }
    }

    @Test fun loadsTheSyntheticCorePage() {
        assertEquals("$ORIGIN/__convo_native__/index.html", shadowOf(bridge().webView).lastLoadedUrl)
    }

    @Test fun theWebViewIsLockedDown() {
        val settings = bridge().webView.settings
        assertTrue(settings.javaScriptEnabled)
        assertFalse(settings.allowFileAccess); assertFalse(settings.allowContentAccess)
        assertEquals(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW, settings.mixedContentMode)
        assertFalse(settings.javaScriptCanOpenWindowsAutomatically)
    }

    @Test fun servesTheCorePageWithAStrictPolicy() {
        val page = intercept(bridge(), "$ORIGIN/__convo_native__/index.html")!!
        val html = page.data.readBytes().toString(Charsets.UTF_8)
        assertTrue(html.contains("default-src 'none'")); assertTrue(html.contains("script-src 'self'"))
        assertTrue(html.contains("connect-src $ORIGIN wss://convo.example"))
        assertTrue(html.contains("<script src=\"core.js\">"))
    }

    @Test fun apiAndAttachmentRequestsGoToTheNetwork() {
        val b = bridge()
        assertNull(intercept(b, "$ORIGIN/v1/accounts/me"))
        assertNull(intercept(b, "$ORIGIN/enclave-attachments/abc"))
    }

    @Test fun everythingElseIsBlocked() {
        val b = bridge()
        listOf("https://evil.example/v1/accounts/me", "http://convo.example/v1/x", "$ORIGIN/", "$ORIGIN/index.html", "$ORIGIN/__convo_native__/other.js", "https://convo.example:8443/v1/x")
            .forEach { url -> assertEquals(url, 403, intercept(b, url)!!.statusCode) }
    }

    @Test fun navigationAwayIsRefused() {
        val b = bridge()
        assertTrue(shadowOf(b.webView).webViewClient.shouldOverrideUrlLoading(b.webView, request("https://evil.example/")))
    }

    @Test fun commandsAreSentAsJsonAndResultsReachTheirCallback() {
        val b = bridge()
        var result: JSONObject? = null
        b.command("open", JSONObject().put("id", "chat-1")) { result = it }
        val js = shadowOf(b.webView).lastEvaluatedJavascript
        assertTrue(js.startsWith("window.ConvoCore && window.ConvoCore.command("))
        val payload = JSONObject(JSONObject("{\"p\":${js.substringAfter("command(").removeSuffix(")")}}").getString("p"))
        assertEquals("open", payload.getString("method")); assertEquals("chat-1", payload.getJSONObject("args").getString("id"))
        emit(b, JSONObject().put("type", "result").put("value", JSONObject().put("id", payload.getInt("id")).put("ok", true).put("value", 42)).toString())
        assertNotNull(result); assertEquals(42, result!!.getInt("value"))
    }

    @Test fun eachCommandGetsItsOwnId() {
        val b = bridge()
        b.command("a", JSONObject()) {}; val first = shadowOf(b.webView).lastEvaluatedJavascript
        b.command("b", JSONObject()) {}; val second = shadowOf(b.webView).lastEvaluatedJavascript
        assertTrue(first != second)
    }

    @Test fun eventsAreForwarded() {
        val b = bridge()
        emit(b, JSONObject().put("type", "phase").put("value", JSONObject().put("name", "ready")).toString())
        assertEquals("phase", events.single().first); assertEquals("ready", events.single().second.getString("name"))
    }

    @Test fun malformedMessagesAreDropped() {
        val b = bridge()
        emit(b, "not json"); emit(b, "{}"); emit(b, "{\"value\":{}}")
        assertTrue(events.isEmpty())
    }

    @Test fun aResultIsDeliveredOnlyOnce() {
        val b = bridge()
        var calls = 0
        b.command("x", JSONObject()) { calls++ }
        val result = JSONObject().put("type", "result").put("value", JSONObject().put("id", 1).put("ok", true)).toString()
        emit(b, result); emit(b, result)
        assertEquals(1, calls)
    }

    @Test fun destroyDetachesTheBridge() {
        val b = bridge()
        b.destroy()
        assertNull(shadowOf(b.webView).getJavascriptInterface("NativeConvo"))
    }
}
