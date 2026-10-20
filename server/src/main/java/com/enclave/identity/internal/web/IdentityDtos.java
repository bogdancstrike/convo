package com.enclave.identity.internal.web;

import static com.enclave.contracts.Base64Url.decode;
import static com.enclave.contracts.Base64Url.encode;

import com.enclave.identity.internal.keys.OneTimePreKey;
import com.enclave.identity.internal.keys.PreKeyBundle;
import com.enclave.identity.internal.keys.SignedPreKey;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/**
 * JSON request/response bodies of the identity REST API. Binary fields are unpadded base64url
 * strings (specs §12). Records are grouped here to keep the wire contract reviewable in one file.
 */
final class IdentityDtos {

    private IdentityDtos() {}

    /** {@code POST /v1/devices/reservations} request. */
    record ReservationRequest(@NotBlank String purpose) {}

    /** {@code POST /v1/devices/reservations} response. */
    record ReservationResponse(UUID reservationId, UUID accountId, int deviceId, String challenge,
            String deploymentId, Instant expiresAt) {}

    /** Wire form of a signed prekey. */
    record SignedPreKeyDto(int keyId, @NotBlank String publicKey, @NotBlank String signature) {
        SignedPreKey toDomain() {
            return new SignedPreKey(keyId, decode(publicKey, "signedPreKey.publicKey"), decode(signature, "signedPreKey.signature"));
        }

        static SignedPreKeyDto of(SignedPreKey k) {
            return new SignedPreKeyDto(k.keyId(), encode(k.publicKey()), encode(k.signature()));
        }
    }

    /** Wire form of a one-time prekey. */
    record PreKeyDto(int keyId, @NotBlank String publicKey) {
        OneTimePreKey toDomain() {
            return new OneTimePreKey(keyId, decode(publicKey, "preKey.publicKey"));
        }

        static PreKeyDto of(OneTimePreKey k) {
            return k == null ? null : new PreKeyDto(k.keyId(), encode(k.publicKey()));
        }
    }

    /** {@code POST /v1/devices/primary} request. */
    record PrimaryRegistrationRequest(
            @NotNull UUID reservationId,
            @NotBlank String identityKey,
            int registrationId,
            @NotNull @Valid SignedPreKeyDto signedPreKey,
            @NotNull @Size(max = 1000) List<@Valid PreKeyDto> preKeys,
            @NotBlank String signingKey,
            @NotBlank String signingKeyProfile,
            @NotBlank String registrationProof,
            @NotBlank String platform,
            String nameEnc) {}

    /** Registration response. */
    record RegistrationResponse(UUID accountId, int deviceId, long deviceListVersion) {}

    /** Own device listing entry. */
    record DeviceDto(int deviceId, String platform, String nameEnc, Instant createdAt, LocalDate lastSeenDay,
            boolean current) {}

    /** {@code PUT /v1/keys} request. */
    record KeysUploadRequest(@Valid SignedPreKeyDto signedPreKey, @NotNull @Size(max = 1000) List<@Valid PreKeyDto> preKeys) {}

    /** {@code GET /v1/keys/status} response. */
    record KeyStatusResponse(int oneTimePreKeys) {}

    /** {@code POST /v1/keys/{accountId}/claim} request. */
    record ClaimRequest(@Size(max = 64) List<Integer> deviceIds) {}

    /** Per-device bundle. */
    record BundleDto(int deviceId, int registrationId, SignedPreKeyDto signedPreKey, PreKeyDto preKey) {
        static BundleDto of(PreKeyBundle b) {
            return new BundleDto(b.deviceId(), b.registrationId(), SignedPreKeyDto.of(b.signedPreKey()),
                    PreKeyDto.of(b.oneTimePreKey()));
        }
    }

    /** Claim response. */
    record ClaimResponse(UUID accountId, String identityKey, long deviceListVersion, List<BundleDto> devices) {}

    /** Public account view. */
    record AccountDto(UUID accountId, String username, String identityKey) {}

    /** Caller's own account view. */
    record SelfDto(UUID accountId, String username, int deviceId, String identityKey, long deviceListVersion) {}

    /** Active device roster of an account (fan-out). */
    record RosterDto(UUID accountId, long deviceListVersion, List<RosterEntryDto> devices) {}

    /** Roster entry. */
    record RosterEntryDto(int deviceId, int registrationId) {}
}
