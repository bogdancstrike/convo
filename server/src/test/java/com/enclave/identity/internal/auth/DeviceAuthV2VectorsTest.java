package com.enclave.identity.internal.auth;

import static org.assertj.core.api.Assertions.assertThat;

import com.enclave.contracts.Base64Url;
import com.enclave.identity.SignedDeviceRequest;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Shared vectors for profile ENCLAVE-REQ-V2 ({@code contracts/vectors/device-auth-v2.json}, WebCrypto-signed). */
class DeviceAuthV2VectorsTest {
    private static final JsonNode VECTORS = JsonMapper.builder().build()
            .readTree(Path.of("..", "contracts", "vectors", "device-auth-v2.json").toFile());
    private final byte[] spki = Base64Url.decode(VECTORS.get("signingKeySpki").asString(), "spki");
    private final JsonNode r = VECTORS.get("deviceRequest");

    private SignedDeviceRequest request(String nonce) {
        return new SignedDeviceRequest(r.get("method").asString(), r.get("pathAndQuery").asString(), Base64Url.decode(r.get("body").asString(), "body"),
                r.get("deviceAddress").asString(), r.get("requestId").asString(), r.get("expiresAtMillis").asLong(),
                Base64Url.decode(r.get("signature").asString(), "signature"), nonce);
    }

    @Test void canonicalStringBindsTheNonceAndVerifies() {
        byte[] canonical = DeviceSignatureAuthenticator.canonical(request(r.get("nonce").asString()));
        assertThat(new String(canonical, StandardCharsets.UTF_8)).isEqualTo(r.get("canonical").asString());
        assertThat(DeviceKeyProfile.P256_ECDSA_SHA256_V1.verify(spki, canonical, request(null).signature())).isTrue();
    }

    @Test void anotherNonceOrTheV1StringDoesNotVerify() {
        byte[] signature = Base64Url.decode(r.get("signature").asString(), "signature");
        assertThat(DeviceKeyProfile.P256_ECDSA_SHA256_V1.verify(spki, DeviceSignatureAuthenticator.canonical(request("x".repeat(32))), signature)).isFalse();
        assertThat(DeviceKeyProfile.P256_ECDSA_SHA256_V1.verify(spki, DeviceSignatureAuthenticator.canonical(request(null)), signature)).isFalse();
    }
}
