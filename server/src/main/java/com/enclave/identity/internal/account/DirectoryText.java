package com.enclave.identity.internal.account;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Normalization for directory search: diacritic-insensitive names (so "stefan" finds "Ștefan",
 * UI.md §5.5) and digit-only phone numbers (so "0721 000 001", "+40721000001" and "721000001"
 * match the same account).
 */
public final class DirectoryText {

    private static final Pattern MARKS = Pattern.compile("\\p{M}");
    private static final Pattern PHONE_INPUT = Pattern.compile("^\\+?[0-9][0-9 ()./-]*$");
    private static final Pattern NON_DIGITS = Pattern.compile("[^0-9]");

    private DirectoryText() {}

    /** @return lower-case text without diacritics and with collapsed whitespace, or {@code null} */
    public static String fold(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        String folded = MARKS.matcher(Normalizer.normalize(text, Normalizer.Form.NFD)).replaceAll("");
        return folded.toLowerCase(Locale.ROOT).strip().replaceAll("\\s+", " ");
    }

    /** @return digits of a phone number, or {@code null} when there are none */
    public static String phoneDigits(String phone) {
        if (phone == null) {
            return null;
        }
        String digits = NON_DIGITS.matcher(phone).replaceAll("");
        return digits.isEmpty() || digits.length() > 20 ? null : digits;
    }

    /** @return whether user input looks like a phone number rather than a name */
    public static boolean looksLikePhone(String query) {
        return query != null && PHONE_INPUT.matcher(query.strip()).matches();
    }

    /** Trims and bounds a free-text attribute; blank becomes {@code null}. */
    public static String clean(String value, int max) {
        if (value == null) {
            return null;
        }
        String cleaned = value.replaceAll("[\\p{Cntrl}\\p{Cf}]", " ").strip();
        if (cleaned.isEmpty()) {
            return null;
        }
        return cleaned.length() > max ? cleaned.substring(0, max) : cleaned;
    }
}
