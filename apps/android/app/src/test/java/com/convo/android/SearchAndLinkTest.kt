package com.convo.android

import com.convo.android.ui.info.fold
import com.convo.android.ui.linking.LINK_QR_PREFIX
import com.convo.android.ui.linking.matchLinkRequest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/** Case- and diacritic-insensitive search keys (Romanian comma and cedilla forms). */
@RunWith(Parameterized::class)
class FoldTest(private val input: String, private val expected: String) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{0} -> {1}")
        fun cases() = listOf(
            arrayOf<Any>("Ana", "ana"), arrayOf<Any>("ȘTEFAN", "stefan"), arrayOf<Any>("Şerban", "serban"), arrayOf<Any>("Țară", "tara"),
            arrayOf<Any>("Ţuică", "tuica"), arrayOf<Any>("Întâlnire", "intalnire"), arrayOf<Any>("Ăla", "ala"), arrayOf<Any>("café", "cafe"),
            arrayOf<Any>("", ""), arrayOf<Any>("123", "123"), arrayOf<Any>("MiXeD", "mixed"), arrayOf<Any>("naïve", "naive"))
    }
    @Test fun folds() = assertEquals(expected, fold(input))
}

class MatchLinkRequestTest {
    private val requests = listOf(JSONObject().put("code", "1234 5678 9012").put("id", "a"), JSONObject().put("code", "999988887777").put("id", "b"))

    @Test fun matchesByDigitsIgnoringSpacing() = assertEquals("a", matchLinkRequest("${LINK_QR_PREFIX}123456789012", requests)?.getString("id"))
    @Test fun matchesWithSpacesInTheScan() = assertEquals("b", matchLinkRequest("${LINK_QR_PREFIX}9999 8888 7777", requests)?.getString("id"))
    @Test fun refusesOtherPrefixes() = assertNull(matchLinkRequest("https://evil.example/123456789012", requests))
    @Test fun refusesNull() = assertNull(matchLinkRequest(null, requests))
    @Test fun refusesUnknownCodes() = assertNull(matchLinkRequest("${LINK_QR_PREFIX}000000000000", requests))
    @Test fun refusesPartialCodes() = assertNull(matchLinkRequest("${LINK_QR_PREFIX}1234", requests))
    @Test fun noRequests() = assertNull(matchLinkRequest("${LINK_QR_PREFIX}123456789012", emptyList()))
}
