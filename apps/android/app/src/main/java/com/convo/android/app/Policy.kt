package com.convo.android.app

import com.convo.android.MainActivity
import org.json.JSONObject

/**
 * The organization policy in force (specs §19.1), as verified by the shared core and carried in the
 * snapshot. A policy that blocks screenshots overrides the person's "Allow screenshots" setting;
 * the app lock engages on every return, which is at least as strict as any policy delay.
 */
val MainActivity.policy: JSONObject get() = snapshot.optJSONObject("policy") ?: JSONObject()

/** Whether a feature is allowed (missing = allowed, matching the permissive defaults). */
fun MainActivity.featureAllowed(name: String): Boolean = policy.optJSONObject("features")?.optBoolean(name, true) ?: true

private val PREVIEW_RANK = mapOf("generic" to 0, "sender" to 1, "full" to 2)

/** The person's preview choice capped by the policy's maximum. */
fun MainActivity.effectivePreview(chosen: String): String {
    val max = policy.optJSONObject("notifications")?.optString("maxPreview")?.takeIf { it in PREVIEW_RANK } ?: "full"
    return if ((PREVIEW_RANK[chosen] ?: 0) <= PREVIEW_RANK.getValue(max)) chosen else max
}

fun MainActivity.previewAllowed(level: String): Boolean = effectivePreview(level) == level

val MainActivity.appLockRequired: Boolean get() = policy.optJSONObject("security")?.optBoolean("appLockRequired") == true
