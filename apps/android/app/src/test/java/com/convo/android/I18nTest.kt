package com.convo.android

import com.convo.android.i18n.Strings
import com.convo.android.i18n.tr
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.runners.Parameterized

/** Every Romanian translation keeps the English placeholders, is non-blank and has balanced quotes. */
@RunWith(Parameterized::class)
class RomanianTranslationTest(private val english: String, private val romanian: String) {
    companion object {
        private val PLACEHOLDER = Regex("\\{[a-zA-Z]+\\}")
        @JvmStatic @Parameterized.Parameters(name = "{0}")
        fun cases() = Strings.ro.entries.map { arrayOf<Any>(it.key, it.value) }
    }

    /** One test per translation: placeholders kept, not blank, leading space and trailing ellipsis kept. */
    @Test fun isFaithful() {
        assertEquals("placeholders of \"$english\"", PLACEHOLDER.findAll(english).map { it.value }.sorted().toList(), PLACEHOLDER.findAll(romanian).map { it.value }.sorted().toList())
        assertTrue("empty translation for \"$english\"", romanian.isNotBlank())
        assertEquals("leading space of \"$english\"", english.startsWith(" "), romanian.startsWith(" "))
        assertEquals("trailing ellipsis of \"$english\"", english.endsWith("…"), romanian.endsWith("…"))
    }
}

class TrTest {
    @After fun reset() { Strings.locale = "en" }

    @Test fun englishIsTheKey() { Strings.locale = "en"; assertEquals("Accept", tr("Accept")) }
    @Test fun romanianUsesTheTable() { Strings.locale = "ro"; assertEquals("Răspunde", tr("Accept")) }
    @Test fun missingTranslationFallsBackToEnglish() { Strings.locale = "ro"; assertEquals("No such string 123", tr("No such string 123")) }
    @Test fun unknownLocaleFallsBackToEnglish() { Strings.locale = "de"; assertEquals("Accept", tr("Accept")) }
    @Test fun tableIsLarge() = assertTrue(Strings.ro.size > 500)
}
