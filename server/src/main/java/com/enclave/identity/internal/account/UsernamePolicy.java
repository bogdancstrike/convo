package com.enclave.identity.internal.account;

import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Derives a valid organization handle ({@code [a-z0-9._-]{3,32}}, specs §2) from an IdP claim.
 * Diacritics are folded ({@code ș → s}) so Romanian names produce readable handles.
 */
public final class UsernamePolicy {

    /** Valid handle pattern. */
    public static final Pattern VALID = Pattern.compile("[a-z0-9._-]{3,32}");

    private static final Pattern INVALID_CHARS = Pattern.compile("[^a-z0-9._-]");

    private UsernamePolicy() {}

    /**
     * @param claim raw claim value, may be {@code null}
     * @param fallback used when the claim yields fewer than three valid characters
     * @return normalized handle candidate
     */
    public static String normalize(String claim, String fallback) {
        String base = claim == null ? "" : claim;
        int at = base.indexOf('@');
        if (at > 0) {
            base = base.substring(0, at);
        }
        String folded = Normalizer.normalize(base, Normalizer.Form.NFKD).replaceAll("\\p{M}", "");
        String cleaned = INVALID_CHARS.matcher(folded.toLowerCase(Locale.ROOT)).replaceAll("");
        if (cleaned.length() < 3) {
            cleaned = fallback;
        }
        return cleaned.length() > 32 ? cleaned.substring(0, 32) : cleaned;
    }

    /**
     * @param base normalized handle
     * @param attempt collision counter, starting at 2
     * @return {@code base-attempt}, truncated to fit 32 characters
     */
    public static String withSuffix(String base, int attempt) {
        String suffix = "-" + attempt;
        String head = base.length() + suffix.length() > 32 ? base.substring(0, 32 - suffix.length()) : base;
        return head + suffix;
    }
}
