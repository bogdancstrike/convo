package com.enclave.identity.internal.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.enclave.contracts.Base64Url;
import com.enclave.identity.SignedDeviceRequest;
import com.enclave.identity.internal.enrollment.EnrollmentTranscript;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Verifies the shared Java/TypeScript vectors in {@code contracts/vectors/device-auth-v1.json}
 * (signed by WebCrypto). The web client runs the same assertions in {@code contracts.test.ts}.
 */
class DeviceAuthVectorsTest {

    private static final JsonNode VECTORS = JsonMapper.builder().build()
            .readTree(Path.of("..", "contracts", "vectors", "device-auth-v1.json").toFile());

    private final byte[] spki = Base64Url.decode(VECTORS.get("signingKeySpki").asString(), "spki");

    @Test
    void deviceRequestCanonicalStringAndWebCryptoSignatureVerify() {
        JsonNode r = VECTORS.get("deviceRequest");
        SignedDeviceRequest request = new SignedDeviceRequest(r.get("method").asString(), r.get("pathAndQuery").asString(),
                Base64Url.decode(r.get("body").asString(), "body"), r.get("deviceAddress").asString(),
                r.get("requestId").asString(), r.get("expiresAtMillis").asLong(),
                Base64Url.decode(r.get("signature").asString(), "signature"));

        byte[] canonical = DeviceSignatureAuthenticator.canonical(request);

        assertThat(new String(canonical, StandardCharsets.UTF_8)).isEqualTo(r.get("canonical").asString());
        assertThat(DeviceKeyProfile.P256_ECDSA_SHA256_V1.verify(spki, canonical, request.signature())).isTrue();
    }

    @Test
    void tamperedRequestDoesNotVerify() {
        JsonNode r = VECTORS.get("deviceRequest");
        SignedDeviceRequest tampered = new SignedDeviceRequest("DELETE", r.get("pathAndQuery").asString(),
                Base64Url.decode(r.get("body").asString(), "body"), r.get("deviceAddress").asString(),
                r.get("requestId").asString(), r.get("expiresAtMillis").asLong(), new byte[0]);
        byte[] signature = Base64Url.decode(r.get("signature").asString(), "signature");

        assertThat(DeviceKeyProfile.P256_ECDSA_SHA256_V1.verify(spki, DeviceSignatureAuthenticator.canonical(tampered), signature))
                .isFalse();
        assertThat(DeviceKeyProfile.P256_ECDSA_SHA256_V1.verify(spki, new byte[] {1}, new byte[] {1, 2, 3})).isFalse();
    }

    @Test
    void enrollmentTranscriptMatchesClientAndVerifies() {
        JsonNode e = VECTORS.get("enrollment");
        byte[] transcript = EnrollmentTranscript.build(e.get("deploymentId").asString(),
                UUID.fromString(e.get("accountId").asString()), e.get("deviceId").asInt(),
                UUID.fromString(e.get("reservationId").asString()), Base64Url.decode(e.get("challenge").asString(), "challenge"),
                Base64Url.decode(e.get("identityKey").asString(), "ik"), e.get("registrationId").asInt(), spki);

        assertThat(new String(transcript, StandardCharsets.UTF_8)).isEqualTo(e.get("canonical").asString());
        assertThat(DeviceKeyProfile.P256_ECDSA_SHA256_V1.verify(spki, transcript,
                Base64Url.decode(e.get("signature").asString(), "signature"))).isTrue();
    }
}
