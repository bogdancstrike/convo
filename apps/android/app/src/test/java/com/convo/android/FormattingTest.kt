package com.convo.android

import com.convo.android.i18n.Strings
import com.convo.android.ui.info.formatInterval
import com.convo.android.ui.media.formatSize
import com.convo.android.ui.thread.formatDuration
import com.convo.android.ui.thread.metaReserve
import com.convo.android.ui.thread.timerLabel
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/** Sizes, durations, intervals and timer labels shown in the UI (English and Romanian). */
@RunWith(Parameterized::class)
class FormatSizeTest(private val bytes: Long, private val expected: String) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{0} B -> {1}")
        fun cases() = listOf(
            arrayOf<Any>(0L, "0 B"), arrayOf<Any>(1L, "1 B"), arrayOf<Any>(1023L, "1023 B"), arrayOf<Any>(1024L, "1.0 KB"),
            arrayOf<Any>(1536L, "1.5 KB"), arrayOf<Any>(1_048_575L, "1024.0 KB"), arrayOf<Any>(1_048_576L, "1.0 MB"),
            arrayOf<Any>(5_767_168L, "5.5 MB"), arrayOf<Any>(104_857_600L, "100.0 MB"), arrayOf<Any>(10_737_418_240L, "10240.0 MB"))
    }
    @Test fun formats() = assertEquals(expected, formatSize(bytes).replace(',', '.'))
}

@RunWith(Parameterized::class)
class FormatDurationTest(private val ms: Long, private val expected: String) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{0} ms -> {1}")
        fun cases() = listOf(
            arrayOf<Any>(0L, "0:00"), arrayOf<Any>(999L, "0:00"), arrayOf<Any>(1_000L, "0:01"), arrayOf<Any>(59_999L, "0:59"),
            arrayOf<Any>(60_000L, "1:00"), arrayOf<Any>(61_000L, "1:01"), arrayOf<Any>(600_000L, "10:00"), arrayOf<Any>(3_599_000L, "59:59"),
            arrayOf<Any>(3_600_000L, "60:00"), arrayOf<Any>(7_325_000L, "122:05"))
    }
    @Test fun formats() = assertEquals(expected, formatDuration(ms))
}

@RunWith(Parameterized::class)
class FormatIntervalTest(private val seconds: Long, private val locale: String, private val expected: String) {
    companion object {
        @JvmStatic @Parameterized.Parameters(name = "{0} s ({1}) -> {2}")
        fun cases() = listOf(
            arrayOf<Any>(10L, "en", "10 s"), arrayOf<Any>(30L, "en", "30 s"), arrayOf<Any>(60L, "en", "1 min"), arrayOf<Any>(300L, "en", "5 min"),
            arrayOf<Any>(3600L, "en", "1 h"), arrayOf<Any>(7200L, "en", "2 h"), arrayOf<Any>(90L, "en", "90 s"), arrayOf<Any>(5400L, "en", "90 min"))
    }
    @After fun reset() { Strings.locale = "en" }
    @Test fun formats() { Strings.locale = locale; assertEquals(expected, formatInterval(seconds)) }
}

class TimerAndLayoutTest {
    @After fun reset() { Strings.locale = "en" }

    @Test fun timerLabelsCoverTheOfferedTimers() {
        assertEquals("Off", timerLabel(0)); assertEquals("24 hours", timerLabel(86_400)); assertEquals("7 days", timerLabel(604_800))
        assertEquals("90 days", timerLabel(7_776_000)); assertEquals("Off", timerLabel(12345))
    }

    @Test fun timerLabelsAreTranslated() {
        Strings.locale = "ro"
        assertTrue(timerLabel(86_400) != "24 hours")
    }

    @Test fun metaReserveLeavesRoomForTimeAndMarks() {
        val plain = metaReserve(JSONObject().put("body", "hi"), outgoing = false)
        val outgoing = metaReserve(JSONObject().put("body", "hi"), outgoing = true)
        val edited = metaReserve(JSONObject().put("body", "hi").put("editedAt", 1), outgoing = true)
        val everything = metaReserve(JSONObject().put("editedAt", 1).put("expireTimer", 60).put("starred", true), outgoing = true)
        assertTrue(plain.length < outgoing.length && outgoing.length < edited.length && edited.length < everything.length)
    }

    @Test fun metaReserveIsEmptyForMediaAndAcknowledgements() {
        assertEquals("", metaReserve(JSONObject().put("attachments", JSONArray().put(JSONObject())), outgoing = true))
        assertEquals("", metaReserve(JSONObject().put("ackRequest", JSONObject()), outgoing = false))
    }
}
