package com.enclave.identity.internal.auth;

import com.enclave.contracts.Base64Url;
import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.DeviceRequestAuthenticator;
import com.enclave.identity.SignedDeviceRequest;
import com.enclave.identity.internal.IdentityProperties;
import com.enclave.identity.internal.account.AccountRepository;
import com.enclave.identity.internal.device.Device;
import com.enclave.identity.internal.device.DeviceRepository;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.regex.Pattern;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Verifies device proof-of-possession signatures (specs §4.2).
 *
 * <p>Checks, in order: request-ID syntax, expiry window, device existence/activity, account
 * status, signature, and finally single use of the request ID (only after the signature is valid,
 * so unauthenticated callers cannot fill the replay cache).
 *
 * <p>Note: the launch profile requires a server-issued single-use nonce. This implementation binds
 * a client-chosen single-use request ID plus a short expiry instead; the replay window is bounded
 * by {@code enclave.identity.device-auth.max-signature-lifetime}. Tracked as PRIV-02 follow-up.
 */
@Service
class DeviceSignatureAuthenticator implements DeviceRequestAuthenticator {

    private static final Pattern REQUEST_ID = Pattern.compile("[A-Za-z0-9_-]{16,64}");

    private final DeviceRepository devices;
    private final AccountRepository accounts;
    private final RequestIdRepository requestIds;
    private final IdentityProperties properties;
    private final Clock clock;

    DeviceSignatureAuthenticator(DeviceRepository devices, AccountRepository accounts,
            RequestIdRepository requestIds, IdentityProperties properties, Clock clock) {
        this.devices = devices;
        this.accounts = accounts;
        this.requestIds = requestIds;
        this.properties = properties;
        this.clock = clock;
    }

    @Override
    @Transactional
    public AuthenticatedDevice authenticate(SignedDeviceRequest request) {
        DeviceAddress address;
        try {
            address = DeviceAddress.parse(request.deviceAddress());
        } catch (EnclaveException e) {
            throw unauthenticated("malformed device address");
        }
        if (request.requestId() == null || !REQUEST_ID.matcher(request.requestId()).matches()) {
            throw unauthenticated("malformed request id");
        }
        Instant now = clock.instant();
        Instant expires = Instant.ofEpochMilli(request.expiresAtMillis());
        var auth = properties.deviceAuth();
        if (expires.isBefore(now.minus(auth.clockSkew()))
                || expires.isAfter(now.plus(auth.maxSignatureLifetime()).plus(auth.clockSkew()))) {
            throw unauthenticated("signature expired or too long-lived");
        }
        Device device = devices.find(address.accountId(), address.deviceId())
                .orElseThrow(() -> unauthenticated("unknown device"));
        boolean signatureValid = DeviceKeyProfile.fromId(device.keyProfile())
                .verify(device.signingKey(), canonical(request), request.signature());
        if (!signatureValid) {
            throw unauthenticated("bad signature");
        }
        if (!device.active()) {
            throw new EnclaveException(ErrorCode.DEVICE_REVOKED, "device credential revoked");
        }
        if (accounts.findById(address.accountId()).map(a -> a.disabled()).orElse(true)) {
            throw new EnclaveException(ErrorCode.ACCOUNT_DISABLED, "account is disabled");
        }
        if (!requestIds.consume(address.accountId(), address.deviceId(), request.requestId(),
                expires.plus(auth.clockSkew()))) {
            throw unauthenticated("replayed request");
        }
        devices.touch(address.accountId(), address.deviceId());
        return new AuthenticatedDevice(address, device.platform());
    }

    /**
     * Builds the canonical signed bytes documented on {@link SignedDeviceRequest}.
     *
     * @param r request inputs
     * @return UTF-8 canonical string
     */
    static byte[] canonical(SignedDeviceRequest r) {
        String text = "ENCLAVE-REQ-V1\n" + r.method() + "\n" + r.pathAndQuery() + "\n"
                + Base64Url.encode(sha256(r.body())) + "\n" + r.deviceAddress() + "\n"
                + r.requestId() + "\n" + r.expiresAtMillis();
        return text.getBytes(StandardCharsets.UTF_8);
    }

    /** Hourly cleanup of expired replay-cache rows. */
    @Scheduled(fixedDelayString = "${enclave.identity.device-auth.purge-interval:PT1H}")
    void purgeExpiredRequestIds() {
        requestIds.purgeExpired();
    }

    private static byte[] sha256(byte[] body) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(body == null ? new byte[0] : body);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static EnclaveException unauthenticated(String detail) {
        return new EnclaveException(ErrorCode.UNAUTHENTICATED, detail);
    }
}
