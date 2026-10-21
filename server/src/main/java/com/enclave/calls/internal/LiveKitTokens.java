package com.enclave.calls.internal;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.time.Clock;
import java.time.Instant;
import java.util.Date;
import java.util.Map;
import org.springframework.stereotype.Component;

/**
 * LiveKit access tokens: HS256 JWT with {@code iss} = API key, {@code sub} = participant identity
 * and a {@code video} grant for exactly one room (LiveKit authentication spec).
 */
@Component
class LiveKitTokens {
    private final CallsProperties properties;
    private final Clock clock;

    LiveKitTokens(CallsProperties properties, Clock clock) {
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * @param room LiveKit room name
     * @param identity unique participant identity ({@code accountId:deviceId})
     * @return signed token
     */
    String issue(String room, String identity) {
        return sign(identity, Map.of("room", room, "roomJoin", true, "canPublish", true, "canSubscribe", true, "canPublishData", true), properties.tokenTtl());
    }

    /** Short-lived server token administering exactly one room (list/remove participants). */
    String issueAdmin(String room) {
        return sign("convo-server", Map.of("room", room, "roomAdmin", true), java.time.Duration.ofMinutes(1));
    }

    private String sign(String subject, Map<String, Object> grant, java.time.Duration ttl) {
        Instant now = clock.instant();
        var claims = new JWTClaimsSet.Builder()
                .issuer(properties.apiKey()).subject(subject)
                .notBeforeTime(Date.from(now.minusSeconds(5))).expirationTime(Date.from(now.plus(ttl)))
                .jwtID(java.util.UUID.randomUUID().toString())
                .claim("video", grant)
                .build();
        try {
            var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
            jwt.sign(new MACSigner(properties.apiSecret().getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException("LiveKit token signing failed", e);
        }
    }
}
