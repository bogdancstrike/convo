package com.enclave.push.internal;

import java.math.BigInteger;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.AlgorithmParameters;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.interfaces.ECPrivateKey;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.ECParameterSpec;
import java.security.spec.ECPrivateKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.concurrent.ConcurrentHashMap;

/**
 * VAPID (RFC 8292) for Web Push: an ES256 JWT per push-service origin, cached until shortly
 * before it expires. Wakes carry no payload, so no RFC 8291 message encryption is needed.
 */
final class Vapid {
    private static final Duration LIFETIME = Duration.ofHours(12);
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();

    private final ECPrivateKey privateKey;
    private final String publicKey;
    private final String subject;
    private final Clock clock;
    private final ConcurrentHashMap<String, Token> tokens = new ConcurrentHashMap<>();

    private record Token(String header, Instant renewAt) {}

    /**
     * @param publicKey base64url uncompressed P-256 point (65 bytes), as given to browsers
     * @param privateKey base64url 32-byte private scalar
     * @param subject contact for the push service ({@code mailto:} or {@code https:})
     */
    Vapid(String publicKey, String privateKey, String subject, Clock clock) {
        byte[] point = Base64.getUrlDecoder().decode(publicKey);
        if (point.length != 65 || point[0] != 4) throw new IllegalArgumentException("enclave.push.web-push.public-key must be an uncompressed P-256 point");
        if (!subject.startsWith("mailto:") && !subject.startsWith("https:")) throw new IllegalArgumentException("enclave.push.web-push.subject must be mailto: or https:");
        try {
            AlgorithmParameters params = AlgorithmParameters.getInstance("EC");
            params.init(new ECGenParameterSpec("secp256r1"));
            ECParameterSpec spec = params.getParameterSpec(ECParameterSpec.class);
            this.privateKey = (ECPrivateKey) KeyFactory.getInstance("EC")
                    .generatePrivate(new ECPrivateKeySpec(new BigInteger(1, Base64.getUrlDecoder().decode(privateKey)), spec));
        } catch (Exception e) {
            throw new IllegalArgumentException("enclave.push.web-push.private-key is not a P-256 private key", e);
        }
        this.publicKey = publicKey;
        this.subject = subject;
        this.clock = clock;
    }

    /** {@code Authorization} header value for a push endpoint. */
    String authorization(String endpoint) {
        URI uri = URI.create(endpoint);
        String audience = uri.getScheme() + "://" + uri.getAuthority();
        Instant now = clock.instant();
        Token token = tokens.compute(audience, (a, old) -> old != null && now.isBefore(old.renewAt()) ? old
                : new Token("vapid t=" + jwt(a, now.plus(LIFETIME)) + ", k=" + publicKey, now.plus(LIFETIME.minusHours(1))));
        return token.header();
    }

    private String jwt(String audience, Instant expires) {
        String header = B64.encodeToString("{\"typ\":\"JWT\",\"alg\":\"ES256\"}".getBytes(StandardCharsets.UTF_8));
        String claims = B64.encodeToString(("{\"aud\":\"" + audience + "\",\"exp\":" + expires.getEpochSecond() + ",\"sub\":\"" + subject + "\"}")
                .getBytes(StandardCharsets.UTF_8));
        String input = header + "." + claims;
        try {
            Signature signer = Signature.getInstance("SHA256withECDSAinP1363Format");
            signer.initSign(privateKey);
            signer.update(input.getBytes(StandardCharsets.US_ASCII));
            return input + "." + B64.encodeToString(signer.sign());
        } catch (Exception e) {
            throw new IllegalStateException("VAPID signing failed", e);
        }
    }
}
