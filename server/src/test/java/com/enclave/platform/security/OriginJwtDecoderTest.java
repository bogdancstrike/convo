package com.enclave.platform.security;

import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import static org.assertj.core.api.Assertions.*;

class OriginJwtDecoderTest {
    @Test void acceptsOnlyRequestIssuerAndKeepsAccountIdentityStable() {
        String canonical = "http://localhost:8088/auth/realms/enclave";
        String lan = "https://192.168.1.144:8443/auth/realms/enclave";
        Jwt validated = Jwt.withTokenValue("verified").header("alg", "RS256").issuer(lan).subject("same-user").build();
        var decoder = new OriginJwtDecoder(token -> validated, lan, canonical);
        assertThat(decoder.decode("verified").getClaimAsString("iss")).isEqualTo(canonical);
        assertThat(decoder.decode("verified").getSubject()).isEqualTo("same-user");
        assertThatThrownBy(() -> new OriginJwtDecoder(token -> validated, "https://other/auth/realms/enclave", canonical).decode("verified"))
                .isInstanceOf(JwtValidationException.class);
    }
}
