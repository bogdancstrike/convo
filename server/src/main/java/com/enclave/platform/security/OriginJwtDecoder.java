package com.enclave.platform.security;

import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidationException;
import org.springframework.security.oauth2.core.OAuth2Error;
import java.util.List;

/** Check the actual issuer before mapping aliases to the stable account issuer. Keys always
 * come from the configured internal JWKS endpoint, never from the submitted token. */
final class OriginJwtDecoder implements JwtDecoder {
    private final JwtDecoder delegate;
    private final String expected;
    private final String canonical;

    OriginJwtDecoder(JwtDecoder delegate, String expected, String canonical) {
        this.delegate = delegate;
        this.expected = expected;
        this.canonical = canonical;
    }

    @Override
    public Jwt decode(String token) {
        Jwt jwt = delegate.decode(token);
        if (!expected.equals(jwt.getClaimAsString("iss"))) {
            throw new JwtValidationException("issuer not accepted",
                    List.of(new OAuth2Error("invalid_token", "issuer not accepted", null)));
        }
        return Jwt.withTokenValue(jwt.getTokenValue()).headers(h -> h.putAll(jwt.getHeaders()))
                .claims(c -> { c.putAll(jwt.getClaims()); c.put("iss", canonical); }).build();
    }
}
