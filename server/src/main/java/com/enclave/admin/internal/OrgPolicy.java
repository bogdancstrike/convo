package com.enclave.admin.internal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * Organization policy enforced by honest clients (specs §19.1). It is a governance tool, not a
 * cryptographic guarantee: a modified client can ignore it, which the admin console states. Only
 * controls that clients enforce are listed; server-enforced limits (edit windows, attachment size)
 * stay server configuration. Missing sections take the permissive defaults below.
 *
 * @param notifications most detailed notification preview devices may show
 * @param security device protections
 * @param privacy defaults for new devices (people can still change them unless noted)
 * @param features features that can be turned off for the organization
 */
record OrgPolicy(@Valid @NotNull Notifications notifications, @Valid @NotNull Security security, @Valid @NotNull Privacy privacy, @Valid @NotNull Features features) {

    /** @param maxPreview {@code generic}, {@code sender} or {@code full} */
    record Notifications(@NotNull @Pattern(regexp = "generic|sender|full") String maxPreview) {}

    /**
     * @param screenshotBlock Android blocks screenshots and screen recording of Convo
     * @param appLockRequired devices must use the app lock (passkey/biometrics)
     * @param appLockMaxMinutes longest allowed background time before the lock engages
     * @param keyTransparencyBlock devices refuse to encrypt to an account whose keys or devices do not
     *     match the key-transparency log (absent in older documents: warn only)
     */
    record Security(boolean screenshotBlock, boolean appLockRequired, @Min(0) @Max(60) int appLockMaxMinutes, Boolean keyTransparencyBlock) {
        Security {
            keyTransparencyBlock = Boolean.TRUE.equals(keyTransparencyBlock); // absent in older documents
        }
    }

    /** @param readReceiptsDefault @param typingDefault initial values on newly enrolled devices */
    record Privacy(boolean readReceiptsDefault, boolean typingDefault) {}

    /** Each {@code false} hides the feature in clients. */
    record Features(boolean chatExport, boolean viewOnce, boolean stickers, boolean callLinks) {}

    /** The policy in force before an administrator publishes one. */
    static OrgPolicy defaults() {
        return new OrgPolicy(new Notifications("full"), new Security(false, false, 15, false), new Privacy(false, false), new Features(true, true, true, true));
    }
}
