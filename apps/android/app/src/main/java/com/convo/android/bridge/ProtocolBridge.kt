package com.convo.android.bridge

import com.convo.android.R
import com.convo.android.BuildConfig
import com.convo.android.*
import com.convo.android.app.*
import com.convo.android.calls.*
import com.convo.android.i18n.*
import com.convo.android.push.*
import com.convo.android.ui.communities.*
import com.convo.android.ui.chats.*
import com.convo.android.ui.components.*
import com.convo.android.ui.contacts.*
import com.convo.android.ui.info.*
import com.convo.android.ui.linking.*
import com.convo.android.ui.locks.*
import com.convo.android.ui.media.*
import com.convo.android.ui.settings.*
import com.convo.android.ui.theme.*
import com.convo.android.ui.thread.*
import com.convo.android.i18n.Text
import com.convo.android.i18n.Icon
import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.net.http.SslError
import android.webkit.*
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.net.ssl.*
import net.openid.appauth.connectivity.ConnectionBuilder

/** Exact development certificate trust; no trust-all verifier and no release override. */
class DevelopmentTls(private val context: Context) : ConnectionBuilder {
    /** Debug builds pin the development certificate for the deployment hostname only. */
    /** localhost is the local Compose stack, reached from the emulator through `adb reverse tcp:8443 tcp:8443`. */
    private val hosts = setOf(android.net.Uri.parse(DEFAULT_SERVER).host!!, "localhost")
    private fun developmentEndpoint(uri: Uri) = uri.scheme == "https" && uri.host in hosts && uri.port in setOf(-1, 443, 8443)
    private val certificate: X509Certificate? by lazy {
        if (!BuildConfig.DEBUG) null else {
            val id = context.resources.getIdentifier("convo_dev", "raw", context.packageName)
            if (id == 0) null else context.resources.openRawResource(id).use {
                CertificateFactory.getInstance("X.509").generateCertificate(it) as X509Certificate
            }
        }
    }
    fun accepts(url: String, cert: X509Certificate?): Boolean = try {
        certificate?.checkValidity(); cert?.checkValidity()
        BuildConfig.DEBUG && developmentEndpoint(Uri.parse(url)) && cert != null && certificate?.encoded.contentEquals(cert.encoded)
    } catch (_: Exception) { false }

    /** Platform trust plus, in debug builds only, the exact development certificate for dev hosts. */
    fun trustManager(): X509TrustManager {
        val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        factory.init(null as KeyStore?)
        val standard = factory.trustManagers.filterIsInstance<X509TrustManager>().first()
        if (!BuildConfig.DEBUG || certificate == null) return standard
        return object : X509TrustManager {
            override fun getAcceptedIssuers() = standard.acceptedIssuers
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = standard.checkClientTrusted(chain, authType)
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                val leaf = chain.firstOrNull()
                if (!(leaf != null && certificate?.encoded.contentEquals(leaf.encoded) && runCatching { leaf.checkValidity() }.isSuccess)) standard.checkServerTrusted(chain, authType)
            }
        }
    }

    /** OkHttp client for LiveKit signalling with the same trust rules as the rest of the app. */
    fun okHttp(): okhttp3.OkHttpClient {
        val manager = trustManager()
        val context = SSLContext.getInstance("TLS").apply { init(null, arrayOf(manager), null) }
        val verifier = HttpsURLConnection.getDefaultHostnameVerifier()
        return okhttp3.OkHttpClient.Builder().sslSocketFactory(context.socketFactory, manager)
            .hostnameVerifier { name, session -> verifier.verify(name, session) || (BuildConfig.DEBUG && name in hosts && certificate?.encoded.contentEquals((session.peerCertificates.firstOrNull() as? X509Certificate)?.encoded)) }
            .build()
    }

    override fun openConnection(uri: Uri): HttpURLConnection {
        require(uri.scheme == "https") { "HTTPS required" }
        val connection = java.net.URL(uri.toString()).openConnection() as HttpsURLConnection
        connection.connectTimeout = 15000; connection.readTimeout = 15000
        if (BuildConfig.DEBUG && developmentEndpoint(uri) && certificate != null) {
            val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
            factory.init(null as KeyStore?)
            val standard = factory.trustManagers.filterIsInstance<X509TrustManager>().first()
            val manager = object : X509TrustManager {
                override fun getAcceptedIssuers() = standard.acceptedIssuers
                override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) = standard.checkClientTrusted(chain, authType)
                override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
                    if (!accepts(uri.toString(), chain.firstOrNull())) standard.checkServerTrusted(chain, authType)
                }
            }
            connection.sslSocketFactory = SSLContext.getInstance("TLS").apply { init(null, arrayOf(manager), null) }.socketFactory
            val verifier = HttpsURLConnection.getDefaultHostnameVerifier()
            connection.hostnameVerifier = HostnameVerifier { name, session ->
                verifier.verify(name, session) || (name in hosts && accepts(uri.toString(), session.peerCertificates.firstOrNull() as? X509Certificate))
            }
        }
        return connection
    }
}

/** Hidden packaged protocol runtime. Navigation is blocked; only same-origin API/media IO is allowed. */
@SuppressLint("SetJavaScriptEnabled")
class ProtocolBridge(context: Context, private val origin: String, private val receive: (String, JSONObject) -> Unit) {
    val webView = WebView(context)
    private val tls = DevelopmentTls(context)
    private var nextId = 1
    private val callbacks = mutableMapOf<Int, (JSONObject) -> Unit>()
    private val html = """<!doctype html><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src $origin ${origin.replace("https:", "wss:")}; img-src blob: data:; media-src blob:; style-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><script src="core.js"></script>"""

    init {
        require(Uri.parse(origin).scheme == "https" && Uri.parse(origin).userInfo == null && Uri.parse(origin).query == null)
        with(webView.settings) {
            javaScriptEnabled = true; domStorageEnabled = true
            allowFileAccess = false; allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false; setSupportMultipleWindows(false)
            cacheMode = WebSettings.LOAD_NO_CACHE
        }
        WebView.setWebContentsDebuggingEnabled(false)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.addJavascriptInterface(object {
            @JavascriptInterface fun emit(json: String) {
                if (json.length > 150 * 1024 * 1024) return
                try {
                    val message = JSONObject(json); val type = message.getString("type")
                    webView.post {
                        val value = message.optJSONObject("value") ?: JSONObject()
                        if (type == "result") callbacks.remove(value.optInt("id"))?.invoke(value) else receive(type, value)
                    }
                } catch (_: Exception) { /* Never log user data or protocol material. */ }
            }
        }, "NativeConvo")
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest) = true
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val uri = request.url
                val allowedOrigin = "${uri.scheme}://${uri.authority}" == origin
                if (!allowedOrigin) return blocked()
                if (uri.path == "/__convo_native__/index.html") return WebResourceResponse("text/html", "UTF-8", ByteArrayInputStream(html.toByteArray()))
                if (uri.path == "/__convo_native__/core.js") return WebResourceResponse("application/javascript", "UTF-8", context.assets.open("core.js"))
                if (uri.path?.startsWith("/v1/") == true || uri.path?.startsWith("/enclave-attachments/") == true) return null
                return blocked()
            }
            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                val bytes = android.net.http.SslCertificate.saveState(error.certificate).getByteArray("x509-certificate")
                val cert = bytes?.let { CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(it)) as X509Certificate }
                if (tls.accepts(error.url, cert)) handler.proceed() else handler.cancel()
            }
        }
        webView.loadUrl("$origin/__convo_native__/index.html")
    }
    private fun blocked() = WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), ByteArrayInputStream(byteArrayOf()))
    fun command(method: String, args: JSONObject = JSONObject(), callback: (JSONObject) -> Unit = {}) {
        val id = nextId++; callbacks[id] = callback
        val payload = JSONObject().put("id", id).put("method", method).put("args", args).toString()
        webView.evaluateJavascript("window.ConvoCore && window.ConvoCore.command(${JSONObject.quote(payload)})", null)
    }
    fun destroy() { callbacks.clear(); webView.removeJavascriptInterface("NativeConvo"); webView.destroy() }
}
