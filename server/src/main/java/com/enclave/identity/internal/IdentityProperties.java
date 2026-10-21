package com.enclave.identity.internal;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Identity module configuration ({@code enclave.identity.*}). Defaults follow specs §26.3.
 *
 * @param maxDevicesPerAccount maximum simultaneously active devices per account
 * @param reservationTtl lifetime of an enrollment reservation
 * @param prekeyLowWatermark publish {@code PrekeysLow} when one-time prekeys drop below this
 * @param maxPrekeysPerUpload maximum one-time prekeys accepted in one upload
 * @param maxStoredPrekeys maximum one-time prekeys stored per device
 * @param usernameClaim OIDC claim used to derive the organization handle
 * @param displayNameClaim OIDC claim with the organization display name
 * @param phoneClaim OIDC claim with the organization phone number
 * @param minPhoneDigits minimum digits before a phone search runs (limits enumeration)
 * @param directoryPageSize maximum directory search results
 * @param deviceAuth device request-signature settings
 * @param keyPackages MLS KeyPackage limits
 */
@Validated
@ConfigurationProperties("enclave.identity")
public record IdentityProperties(
        @DefaultValue("5") @Min(1) @Max(64) int maxDevicesPerAccount,
        @DefaultValue("10m") @NotNull Duration reservationTtl,
        @DefaultValue("20") @Min(0) int prekeyLowWatermark,
        @DefaultValue("200") @Min(1) int maxPrekeysPerUpload,
        @DefaultValue("1000") @Min(1) int maxStoredPrekeys,
        @DefaultValue("preferred_username") @NotBlank String usernameClaim,
        @DefaultValue("name") @NotBlank String displayNameClaim,
        @DefaultValue("phone_number") @NotBlank String phoneClaim,
        @DefaultValue("4") @Min(3) int minPhoneDigits,
        @DefaultValue("20") @Min(1) @Max(100) int directoryPageSize,
        @DefaultValue @Valid DeviceAuth deviceAuth,
        @DefaultValue @Valid KeyPackages keyPackages) {

    /**
     * MLS KeyPackage settings (specs §6.9).
     *
     * @param lowWatermark publish {@code KeyPackagesLow} below this count
     * @param maxPerUpload maximum packages per upload
     * @param maxStored maximum stored packages per device
     * @param maxBytes maximum encoded size of one package
     * @param maxAccountsPerClaim maximum accounts in one claim
     */
    public record KeyPackages(
            @DefaultValue("10") @Min(0) int lowWatermark,
            @DefaultValue("100") @Min(1) int maxPerUpload,
            @DefaultValue("200") @Min(1) int maxStored,
            @DefaultValue("8192") @Min(256) int maxBytes,
            @DefaultValue("100") @Min(1) int maxAccountsPerClaim) {}

    /**
     * Device proof-of-possession settings (specs §4.2).
     *
     * @param maxSignatureLifetime maximum distance between now and the signed expiry
     * @param clockSkew tolerated client clock skew
     * @param requireNonce reject the legacy V1 profile (no server-issued nonce)
     * @param nonceTtl lifetime of an issued nonce
     * @param nonceBatch nonces returned by one {@code POST /v1/device-nonces}
     * @param maxOutstandingNonces live nonces kept per device (oldest dropped beyond this)
     */
    public record DeviceAuth(
            @DefaultValue("5m") @NotNull Duration maxSignatureLifetime,
            @DefaultValue("30s") @NotNull Duration clockSkew,
            @DefaultValue("true") boolean requireNonce,
            @DefaultValue("2m") @NotNull Duration nonceTtl,
            @DefaultValue("8") @Min(1) @Max(64) int nonceBatch,
            @DefaultValue("64") @Min(8) @Max(1024) int maxOutstandingNonces) {}
}
