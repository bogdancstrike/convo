package com.enclave.identity.internal.credentials;

import com.enclave.identity.internal.account.AccountRepository;
import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Asks Keycloak which credential types an account registered. Failures are reported as
 * {@link CredentialStatus#unavailable()}, never as "no passkey", so clients cannot be tricked into
 * a wrong security state by an outage. Nothing about the response is logged.
 */
@Service
public class CredentialStatusService {

    /** Keycloak credential type of a passwordless WebAuthn (passkey) credential. */
    static final String PASSKEY_TYPE = "webauthn-passwordless";
    static final String OTP_TYPE = "otp";
    private static final Logger log = LoggerFactory.getLogger(CredentialStatusService.class);
    private static final int MAX_CACHED = 10_000;

    private final CredentialStatusProperties properties;
    private final AccountRepository accounts;
    private final RestClient http;
    private final Clock clock;
    private final Map<UUID, Cached> cache = new ConcurrentHashMap<>();
    private volatile Token token;

    /**
     * @param state {@code available} when the IdP answered
     * @param passkey a passwordless passkey is registered
     * @param otp an authenticator-app (TOTP) credential is registered
     */
    public record CredentialStatus(String state, boolean passkey, boolean otp) {
        public static CredentialStatus unavailable() { return new CredentialStatus("unavailable", false, false); }
    }

    private record Cached(CredentialStatus status, Instant until) {}
    private record Token(String value, Instant until) {}
    record TokenResponse(String access_token, long expires_in) {}
    record Credential(String type) {}

    @Autowired
    public CredentialStatusService(CredentialStatusProperties properties, AccountRepository accounts) {
        this(properties, accounts, RestClient.builder().requestFactory(requestFactory(properties)).build(), Clock.systemUTC());
    }

    CredentialStatusService(CredentialStatusProperties properties, AccountRepository accounts, RestClient http, Clock clock) {
        this.properties = properties;
        this.accounts = accounts;
        this.http = http;
        this.clock = clock;
    }

    private static JdkClientHttpRequestFactory requestFactory(CredentialStatusProperties properties) {
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(properties.timeout()).build());
        factory.setReadTimeout(properties.timeout());
        return factory;
    }

    /**
     * @param accountId authenticated account
     * @return the account's registered credential types, or {@code unavailable}
     */
    public CredentialStatus status(UUID accountId) {
        if (!properties.enabled() || properties.clientSecret().isBlank()) return CredentialStatus.unavailable();
        Instant now = clock.instant();
        Cached cached = cache.get(accountId);
        if (cached != null && cached.until().isAfter(now)) return cached.status();
        CredentialStatus status = lookup(accountId);
        // Only a confirmed passkey is cached: "none yet" changes right after set-up from Settings.
        if (status.state().equals("available") && status.passkey()) {
            if (cache.size() >= MAX_CACHED) cache.clear();
            cache.put(accountId, new Cached(status, now.plus(properties.cacheTtl())));
        }
        return status;
    }

    private CredentialStatus lookup(UUID accountId) {
        String subject = accounts.findOidcSubject(accountId).orElse(null);
        if (subject == null) return CredentialStatus.unavailable();
        try {
            var uri = UriComponentsBuilder.fromUri(properties.adminUrl())
                    .pathSegment("admin", "realms", properties.realm(), "users", subject, "credentials").build().encode().toUri();
            List<Credential> credentials = http.get().uri(uri).headers((h) -> h.setBearerAuth(accessToken()))
                    .retrieve().body(new org.springframework.core.ParameterizedTypeReference<List<Credential>>() {});
            Set<String> types = credentials == null ? Set.of() : credentials.stream().map(Credential::type).collect(Collectors.toSet());
            return new CredentialStatus("available", types.contains(PASSKEY_TYPE), types.contains(OTP_TYPE));
        } catch (RuntimeException e) {
            token = null; // a rotated secret or revoked token must not stick
            log.warn("Credential status lookup unavailable ({})", e.getClass().getSimpleName());
            return CredentialStatus.unavailable();
        }
    }

    private String accessToken() {
        Token current = token;
        Instant now = clock.instant();
        if (current != null && current.until().isAfter(now)) return current.value();
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "client_credentials");
        form.add("client_id", properties.clientId());
        form.add("client_secret", properties.clientSecret());
        var uri = UriComponentsBuilder.fromUri(properties.adminUrl())
                .pathSegment("realms", properties.realm(), "protocol", "openid-connect", "token").build().toUri();
        TokenResponse response = http.post().uri(uri).contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form).retrieve().body(TokenResponse.class);
        if (response == null || response.access_token() == null) throw new IllegalStateException("no token");
        // Renew early so a token never expires between check and use.
        token = new Token(response.access_token(), now.plusSeconds(Math.max(0, response.expires_in() - 30)));
        return token.value();
    }
}
