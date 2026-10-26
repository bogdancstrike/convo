package com.convo.android.bridge

import android.content.Context
import android.view.View
import org.json.JSONObject

/**
 * How the app talks to the shared encryption core: commands with a result callback, events through
 * the `receive` callback given at creation. Production uses [ProtocolBridge] (the core in a
 * headless WebView); JVM tests replace [CoreTransports.factory] with a fake core.
 */
interface CoreTransport {
    /** The view hosting the core, attached invisibly to the window (null for fakes). */
    val view: View?
    fun command(method: String, args: JSONObject = JSONObject(), callback: (JSONObject) -> Unit = {})
    fun destroy()
}

object CoreTransports {
    /** Creates the transport for an activity; tests swap this before launching it. */
    @Volatile var factory: (context: Context, origin: String, receive: (String, JSONObject) -> Unit) -> CoreTransport =
        { context, origin, receive -> ProtocolBridge(context, origin, receive) }
}
