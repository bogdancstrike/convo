package com.enclave.identity.internal.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.enclave.contracts.Base64Url;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.SignedDeviceRequest;
import com.enclave.identity.internal.IdentityProperties;
import com.enclave.identity.internal.account.Account;
import com.enclave.identity.internal.account.AccountRepository;
import com.enclave.identity.internal.device.Device;
import com.enclave.identity.internal.device.DeviceRepository;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** PRIV-02: the server nonce is required, bound to the signature and usable exactly once. */
class DeviceNonceTest {
    private static final JsonNode V = JsonMapper.builder().build().readTree(Path.of("..", "contracts", "vectors", "device-auth-v2.json").toFile());
    private final JsonNode r = V.get("deviceRequest");
    private final DeviceRepository devices = mock(DeviceRepository.class);
    private final AccountRepository accounts = mock(AccountRepository.class);
    private final RequestIdRepository requestIds = mock(RequestIdRepository.class);
    private final NonceRepository nonces = mock(NonceRepository.class);
    private final IdentityProperties properties = mock(IdentityProperties.class);
    private final DeviceSignatureAuthenticator authenticator = new DeviceSignatureAuthenticator(devices, accounts, requestIds, nonces, properties,
            Clock.fixed(Instant.ofEpochMilli(r.get("expiresAtMillis").asLong()).minusSeconds(60), ZoneOffset.UTC),
            org.mockito.Mockito.mock(org.springframework.context.ApplicationEventPublisher.class));

    DeviceNonceTest() {
        String[] address = r.get("deviceAddress").asString().split("\\.");
        UUID account = UUID.fromString(address[0]);
        when(properties.deviceAuth()).thenReturn(new IdentityProperties.DeviceAuth(Duration.ofMinutes(5), Duration.ofSeconds(30), true, Duration.ofMinutes(2), 8, 64));
        when(devices.find(account, Integer.parseInt(address[1]))).thenReturn(Optional.of(new Device(account, 2, 1,
                Base64Url.decode(V.get("signingKeySpki").asString(), "spki"), "p256-ecdsa-sha256-v1", null, "web", Instant.EPOCH, null, null)));
        when(accounts.findById(account)).thenReturn(Optional.of(new Account(account, "u", 1, new byte[0], "active", "U", null, null)));
        when(requestIds.consume(any(), anyInt(), anyString(), any())).thenReturn(true);
    }

    private SignedDeviceRequest request(String nonce) {
        return new SignedDeviceRequest(r.get("method").asString(), r.get("pathAndQuery").asString(), Base64Url.decode(r.get("body").asString(), "body"),
                r.get("deviceAddress").asString(), r.get("requestId").asString(), r.get("expiresAtMillis").asLong(),
                Base64Url.decode(r.get("signature").asString(), "signature"), nonce);
    }

    private static void assertCode(Runnable action, ErrorCode code) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(code));
    }

    @Test void validProofConsumesItsNonceOnce() {
        String nonce = r.get("nonce").asString();
        when(nonces.consume(any(), anyInt(), eq(nonce))).thenReturn(true, false);
        assertThat(authenticator.authenticate(request(nonce)).address().deviceId()).isEqualTo(2);
        assertCode(() -> authenticator.authenticate(request(nonce)), ErrorCode.NONCE_INVALID); // replay
    }

    @Test void legacyProofsWithoutNonceAreRefusedWhenRequired() {
        assertCode(() -> authenticator.authenticate(request(null)), ErrorCode.NONCE_INVALID);
        verifyNoInteractions(nonces, requestIds);
    }

    @Test void aForeignNonceFailsTheSignatureBeforeAnythingIsConsumed() {
        assertCode(() -> authenticator.authenticate(request("A".repeat(32))), ErrorCode.UNAUTHENTICATED);
        verify(nonces, never()).consume(any(), anyInt(), anyString());
        assertCode(() -> authenticator.authenticate(request("short")), ErrorCode.NONCE_INVALID);
    }
}
