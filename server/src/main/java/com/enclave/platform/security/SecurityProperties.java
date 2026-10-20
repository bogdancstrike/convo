package com.enclave.platform.security;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * HTTP security configuration ({@code enclave.security.*}).
 *
 * @param oidc Keycloak/OIDC token validation settings
 * @param allowedOrigins exact browser origins allowed for CORS and WebSocket upgrades; empty means
 *     same-origin only (recommended: serve web app and API from one origin)
 * @param maxBodyBytes maximum buffered request body for signed device requests
 */
@Validated
@ConfigurationProperties("enclave.security")
public record SecurityProperties(
        @Valid Oidc oidc,
        @DefaultValue List<String> allowedOrigins,
        @DefaultValue("1048576") @Min(1024) int maxBodyBytes) {

    /**
     * @param issuer expected {@code iss} claim (the public issuer URL clients see)
     * @param jwkSetUri JWKS endpoint reachable from the backend (may be an internal URL)
     * @param audiences accepted {@code aud} values; empty disables the audience check
     * @param publicClientId OIDC client ID the web app uses (published in deployment info)
     */
    public record Oidc(
            @NotBlank String issuer,
            @NotBlank String jwkSetUri,
            @DefaultValue List<String> audiences,
            @DefaultValue("enclave-web") String publicClientId) {}
}
