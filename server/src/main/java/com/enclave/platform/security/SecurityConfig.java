package com.enclave.platform.security;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.DeviceRequestAuthenticator;
import com.enclave.platform.web.ProblemWriter;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.web.AuthenticationEntryPoint;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.AccessDeniedHandler;
import org.springframework.security.web.authentication.preauth.AbstractPreAuthenticatedProcessingFilter;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.OrRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

/**
 * HTTP security: two stateless chains with disjoint authentication.
 *
 * <ol>
 *   <li><b>Account chain</b> — enrollment/linking routes require a Keycloak bearer token
 *       ({@code K} in specs §12).</li>
 *   <li><b>Device chain</b> — every other {@code /v1/**} route requires a device
 *       proof-of-possession signature ({@code D}), except public deployment info and the WebSocket
 *       upgrade (authenticated by a one-use ticket in the gateway).</li>
 * </ol>
 * There are no cookies or sessions, so CSRF protection is not applicable.
 */
@Configuration(proxyBeanMethods = false)
class SecurityConfig {

    /**
     * Routes authenticated by Keycloak bearer tokens (enrollment and the new-device side of
     * linking). Method-specific because the existing-device side of linking shares paths.
     */
    static final RequestMatcher ACCOUNT_ROUTES = new OrRequestMatcher(
            route(HttpMethod.POST, "/v1/devices/reservations"),
            route(HttpMethod.POST, "/v1/devices/primary"),
            route(HttpMethod.POST, "/v1/devices/link"),
            route(HttpMethod.POST, "/v1/provisioning/sessions"),
            route(HttpMethod.GET, "/v1/provisioning/sessions/{provisioningId}"),
            route(HttpMethod.DELETE, "/v1/provisioning/sessions/{provisioningId}"));

    /** Routes that need no authentication. */
    static final String[] PUBLIC_ROUTES = {"/v1/deployment-info", "/v1/ws"};

    @Bean
    @Order(1)
    SecurityFilterChain accountChain(HttpSecurity http, ProblemWriter problems) throws Exception {
        return http
                .securityMatcher(ACCOUNT_ROUTES)
                .csrf(c -> c.disable())
                .cors(c -> {})
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(a -> a.anyRequest().authenticated())
                .oauth2ResourceServer(o -> o.jwt(j -> {}).authenticationEntryPoint(entryPoint(problems)))
                .exceptionHandling(e -> e.authenticationEntryPoint(entryPoint(problems)).accessDeniedHandler(denied(problems)))
                .build();
    }

    @Bean
    @Order(2)
    SecurityFilterChain deviceChain(HttpSecurity http, DeviceRequestAuthenticator authenticator,
            ProblemWriter problems, SecurityProperties properties) throws Exception {
        return http
                .securityMatcher("/v1/**")
                .csrf(c -> c.disable())
                .cors(c -> {})
                .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .addFilterBefore(new DeviceSignatureFilter(authenticator, problems, properties.maxBodyBytes()),
                        AbstractPreAuthenticatedProcessingFilter.class)
                .authorizeHttpRequests(a -> a
                        .requestMatchers(HttpMethod.OPTIONS, "/v1/**").permitAll()
                        .requestMatchers(PUBLIC_ROUTES).permitAll()
                        .anyRequest().hasAuthority(DeviceSignatureFilter.DEVICE_AUTHORITY))
                .exceptionHandling(e -> e.authenticationEntryPoint(entryPoint(problems)).accessDeniedHandler(denied(problems)))
                .build();
    }

    @Bean
    @Order(3)
    SecurityFilterChain operationsChain(HttpSecurity http) throws Exception {
        return http
                .securityMatcher("/actuator/**")
                .csrf(c -> c.disable())
                .authorizeHttpRequests(a -> a.requestMatchers("/actuator/health/**", "/actuator/info").permitAll()
                        .anyRequest().denyAll())
                .build();
    }

    /**
     * JWT decoder that fetches keys from the (possibly internal) JWKS URI but validates the public
     * issuer clients see, plus the optional audience list.
     */
    @Bean
    JwtDecoder jwtDecoder(SecurityProperties properties) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withJwkSetUri(properties.oidc().jwkSetUri()).build();
        List<String> audiences = properties.oidc().audiences();
        OAuth2TokenValidator<Jwt> audience = jwt -> audiences.isEmpty()
                || jwt.getAudience().stream().anyMatch(audiences::contains)
                ? OAuth2TokenValidatorResult.success()
                : OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "audience not accepted", null));
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(properties.oidc().issuer()), audience));
        return decoder;
    }

    @Bean
    CorsConfigurationSource corsConfigurationSource(SecurityProperties properties) {
        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        if (!properties.allowedOrigins().isEmpty()) {
            CorsConfiguration cors = new CorsConfiguration();
            cors.setAllowedOrigins(properties.allowedOrigins());
            cors.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE"));
            cors.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Enclave-Request-Id",
                    "X-Enclave-Expires", "X-Enclave-Signature"));
            cors.setAllowCredentials(false);
            cors.setMaxAge(600L);
            source.registerCorsConfiguration("/v1/**", cors);
        }
        return source;
    }

    private static RequestMatcher route(HttpMethod method, String pattern) {
        return PathPatternRequestMatcher.withDefaults().matcher(method, pattern);
    }

    private static AuthenticationEntryPoint entryPoint(ProblemWriter problems) {
        return (request, response, ex) ->
                problems.write(response, new EnclaveException(ErrorCode.UNAUTHENTICATED, "authentication required"));
    }

    private static AccessDeniedHandler denied(ProblemWriter problems) {
        return (request, response, ex) ->
                problems.write(response, new EnclaveException(ErrorCode.FORBIDDEN, "access denied"));
    }
}
