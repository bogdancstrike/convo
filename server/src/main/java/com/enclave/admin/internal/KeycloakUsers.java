package com.enclave.admin.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.net.URI;
import java.net.http.HttpClient;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;
import org.springframework.web.util.UriComponentsBuilder;

/**
 * Sign-in accounts at the identity provider (Keycloak), managed for administrators through a
 * dedicated confidential client ({@code enclave.admin.idp.client-id}, realm-management
 * {@code manage-users}/{@code view-users} only). Convo never stores or logs passwords: a generated
 * temporary password is returned once to the administrator and must be changed at next sign-in.
 * Session details are reduced to counts and last-access times (no IP addresses).
 */
@Service
class KeycloakUsers {
    /** Realm roles an administrator may grant or remove (all other realm roles are untouched). */
    static final Set<String> MANAGED_ROLES = Set.of("convo-admin", "convo-helpdesk", "convo-org-admin", "convo-security", "convo-auditor");
    /** Required actions an administrator may ask for at next sign-in. */
    static final Set<String> ALLOWED_ACTIONS = Set.of("UPDATE_PASSWORD", "webauthn-register-passwordless", "CONFIGURE_TOTP", "UPDATE_PROFILE", "VERIFY_EMAIL");

    /**
     * @param id IdP user ID (the token subject)
     * @param enabled whether sign-in is allowed at the IdP
     * @param requiredActions actions the user must complete at next sign-in
     * @param credentialTypes registered credential types (password, webauthn-passwordless, otp)
     * @param roles managed admin roles held
     * @param sessions active IdP sessions
     * @param lastAccess most recent session activity, may be {@code null}
     */
    record IdpUser(String id, String username, String firstName, String lastName, String email, String phone, boolean enabled,
            Instant createdAt, List<String> requiredActions, List<String> credentialTypes, List<String> roles, int sessions, Instant lastAccess) {}

    /** A new sign-in account; {@code temporaryPassword} is shown once. */
    record Created(IdpUser user, String temporaryPassword) {}

    record Draft(String username, String firstName, String lastName, String email, String phone, boolean requirePasskey) {}

    private record Token(String value, Instant until) {}
    record TokenResponse(String access_token, long expires_in) {}
    record UserRep(String id, String username, String firstName, String lastName, String email, Boolean enabled, Long createdTimestamp,
            List<String> requiredActions, Map<String, List<String>> attributes) {}
    record CredentialRep(String type) {}
    record RoleRep(String id, String name) {}
    record SessionRep(Long lastAccess) {}

    private final AdminProperties properties;
    private final RestClient http;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();
    private volatile Token token;

    @org.springframework.beans.factory.annotation.Autowired
    KeycloakUsers(AdminProperties properties, Clock clock) {
        this(properties, RestClient.builder().requestFactory(requestFactory(properties)).build(), clock);
    }

    KeycloakUsers(AdminProperties properties, RestClient http, Clock clock) {
        this.properties = properties;
        this.http = http;
        this.clock = clock;
    }

    private static JdkClientHttpRequestFactory requestFactory(AdminProperties properties) {
        var factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder().connectTimeout(properties.idp().timeout()).build());
        factory.setReadTimeout(properties.idp().timeout());
        return factory;
    }

    boolean available() { return !properties.idp().clientSecret().isBlank(); }

    List<IdpUser> search(String query, int limit) {
        URI uri = admin(b -> b.pathSegment("users").queryParam("briefRepresentation", "false")
                .queryParam("search", query == null ? "" : query.strip()).queryParam("max", Math.max(1, Math.min(limit, 100))));
        List<UserRep> users = call(() -> http.get().uri(uri).headers(h -> h.setBearerAuth(accessToken())).retrieve()
                .body(new ParameterizedTypeReference<List<UserRep>>() {}));
        List<IdpUser> out = new ArrayList<>();
        for (UserRep u : users == null ? List.<UserRep>of() : users) out.add(details(u, false));
        return out;
    }

    IdpUser user(String id) {
        UserRep rep = call(() -> http.get().uri(admin(b -> b.pathSegment("users", id))).headers(h -> h.setBearerAuth(accessToken())).retrieve().body(UserRep.class));
        return details(rep, true);
    }

    Created create(Draft draft) {
        String password = temporaryPassword();
        List<String> actions = new ArrayList<>(List.of("UPDATE_PASSWORD"));
        if (draft.requirePasskey()) actions.add("webauthn-register-passwordless");
        Map<String, Object> body = new java.util.HashMap<>(Map.of(
                "username", draft.username(), "enabled", true, "emailVerified", true,
                "firstName", nz(draft.firstName()), "lastName", nz(draft.lastName()),
                "requiredActions", actions,
                "credentials", List.of(Map.of("type", "password", "value", password, "temporary", true))));
        if (!nz(draft.email()).isBlank()) body.put("email", draft.email().strip());
        if (!nz(draft.phone()).isBlank()) body.put("attributes", Map.of("phoneNumber", List.of(draft.phone().strip())));
        var response = call(() -> http.post().uri(admin(b -> b.pathSegment("users"))).headers(h -> h.setBearerAuth(accessToken()))
                .contentType(MediaType.APPLICATION_JSON).body(body).retrieve().toBodilessEntity());
        URI location = response.getHeaders().getLocation();
        if (location == null) throw new EnclaveException(ErrorCode.UNAVAILABLE, "identity provider did not return the new user");
        String path = location.getPath();
        return new Created(user(path.substring(path.lastIndexOf('/') + 1)), password);
    }

    /** Sets a new temporary password (changed at next sign-in) and returns it once. */
    String resetPassword(String id) {
        String password = temporaryPassword();
        call(() -> http.put().uri(admin(b -> b.pathSegment("users", id, "reset-password"))).headers(h -> h.setBearerAuth(accessToken()))
                .contentType(MediaType.APPLICATION_JSON).body(Map.of("type", "password", "value", password, "temporary", true)).retrieve().toBodilessEntity());
        return password;
    }

    /** Adds required actions (validated against {@link #ALLOWED_ACTIONS}). */
    void requireActions(String id, List<String> actions) {
        if (actions.isEmpty() || !ALLOWED_ACTIONS.containsAll(actions)) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "unsupported required action");
        UserRep rep = call(() -> http.get().uri(admin(b -> b.pathSegment("users", id))).headers(h -> h.setBearerAuth(accessToken())).retrieve().body(UserRep.class));
        Set<String> merged = new LinkedHashSet<>(rep.requiredActions() == null ? List.of() : rep.requiredActions());
        merged.addAll(actions);
        update(id, Map.of("requiredActions", List.copyOf(merged)));
    }

    void setEnabled(String id, boolean enabled) { update(id, Map.of("enabled", enabled)); }

    /** Ends every IdP session of the user (they must sign in again; Convo devices stay linked). */
    void signOut(String id) {
        call(() -> http.post().uri(admin(b -> b.pathSegment("users", id, "logout"))).headers(h -> h.setBearerAuth(accessToken())).retrieve().toBodilessEntity());
    }

    /** Grants or removes one managed admin role. */
    void setRole(String id, String role, boolean granted) {
        if (!MANAGED_ROLES.contains(role)) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "not a Convo admin role");
        RoleRep rep = call(() -> http.get().uri(admin(b -> b.pathSegment("roles", role))).headers(h -> h.setBearerAuth(accessToken())).retrieve().body(RoleRep.class));
        URI uri = admin(b -> b.pathSegment("users", id, "role-mappings", "realm"));
        call(() -> (granted ? http.post().uri(uri) : http.method(org.springframework.http.HttpMethod.DELETE).uri(uri))
                .headers(h -> h.setBearerAuth(accessToken())).contentType(MediaType.APPLICATION_JSON).body(List.of(rep)).retrieve().toBodilessEntity());
    }

    /** A role holder (no credentials or attributes). */
    record Holder(String id, String username, String firstName, String lastName, boolean enabled) {}

    /** Holders of one managed admin role. */
    List<Holder> holders(String role) {
        if (!MANAGED_ROLES.contains(role)) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "not a Convo admin role");
        List<UserRep> users = call(() -> http.get().uri(admin(b -> b.pathSegment("roles", role, "users").queryParam("max", 500))).headers(h -> h.setBearerAuth(accessToken()))
                .retrieve().body(new ParameterizedTypeReference<List<UserRep>>() {}));
        return users == null ? List.of() : users.stream().map(u -> new Holder(u.id(), u.username(), u.firstName(), u.lastName(), Boolean.TRUE.equals(u.enabled())))
                .sorted(java.util.Comparator.comparing(Holder::username)).toList();
    }

    private void update(String id, Map<String, Object> changes) {
        call(() -> http.put().uri(admin(b -> b.pathSegment("users", id))).headers(h -> h.setBearerAuth(accessToken()))
                .contentType(MediaType.APPLICATION_JSON).body(changes).retrieve().toBodilessEntity());
    }

    private IdpUser details(UserRep u, boolean full) {
        List<String> credentials = List.of();
        List<String> roles = List.of();
        int sessions = 0;
        Instant lastAccess = null;
        if (full) {
            List<CredentialRep> creds = call(() -> http.get().uri(admin(b -> b.pathSegment("users", u.id(), "credentials"))).headers(h -> h.setBearerAuth(accessToken()))
                    .retrieve().body(new ParameterizedTypeReference<List<CredentialRep>>() {}));
            credentials = creds == null ? List.of() : creds.stream().map(CredentialRep::type).distinct().sorted().toList();
            List<RoleRep> mapped = call(() -> http.get().uri(admin(b -> b.pathSegment("users", u.id(), "role-mappings", "realm"))).headers(h -> h.setBearerAuth(accessToken()))
                    .retrieve().body(new ParameterizedTypeReference<List<RoleRep>>() {}));
            roles = mapped == null ? List.of() : mapped.stream().map(RoleRep::name).filter(MANAGED_ROLES::contains).sorted().toList();
            List<SessionRep> active = call(() -> http.get().uri(admin(b -> b.pathSegment("users", u.id(), "sessions"))).headers(h -> h.setBearerAuth(accessToken()))
                    .retrieve().body(new ParameterizedTypeReference<List<SessionRep>>() {}));
            sessions = active == null ? 0 : active.size();
            lastAccess = active == null ? null : active.stream().map(SessionRep::lastAccess).filter(java.util.Objects::nonNull).max(Long::compare).map(Instant::ofEpochMilli).orElse(null);
        }
        String phone = u.attributes() == null ? null : u.attributes().getOrDefault("phoneNumber", List.of()).stream().findFirst().orElse(null);
        return new IdpUser(u.id(), u.username(), u.firstName(), u.lastName(), u.email(), phone, Boolean.TRUE.equals(u.enabled()),
                u.createdTimestamp() == null ? null : Instant.ofEpochMilli(u.createdTimestamp()),
                u.requiredActions() == null ? List.of() : u.requiredActions(), credentials, roles, sessions, lastAccess);
    }

    /** 20 random URL-safe characters: easy to read out once, changed at next sign-in. */
    private String temporaryPassword() {
        byte[] bytes = new byte[15];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private URI admin(java.util.function.UnaryOperator<UriComponentsBuilder> path) {
        return path.apply(UriComponentsBuilder.fromUri(properties.idp().adminUrl()).pathSegment("admin", "realms", properties.idp().realm()))
                .build().encode().toUri();
    }

    /** IdP failures become typed errors; nothing about the request or response is logged. */
    private <T> T call(java.util.function.Supplier<T> request) {
        if (!available()) throw new EnclaveException(ErrorCode.UNAVAILABLE, "identity provider management is not configured");
        try {
            return request.get();
        } catch (RestClientResponseException e) {
            HttpStatusCode status = e.getStatusCode();
            if (status.value() == 401) token = null;
            if (status.value() == 404) throw new EnclaveException(ErrorCode.NOT_FOUND, "unknown sign-in account");
            if (status.value() == 409) throw new EnclaveException(ErrorCode.CONFLICT, "a sign-in account with that username or email already exists");
            if (status.value() == 400) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "the identity provider rejected the values");
            throw new EnclaveException(ErrorCode.UNAVAILABLE, "identity provider unavailable");
        } catch (RuntimeException e) {
            if (e instanceof EnclaveException ee) throw ee;
            token = null;
            throw new EnclaveException(ErrorCode.UNAVAILABLE, "identity provider unavailable");
        }
    }

    private String accessToken() {
        Token current = token;
        Instant now = clock.instant();
        if (current != null && current.until().isAfter(now)) return current.value();
        var form = new LinkedMultiValueMap<String, String>();
        form.add("grant_type", "client_credentials");
        form.add("client_id", properties.idp().clientId());
        form.add("client_secret", properties.idp().clientSecret());
        URI uri = UriComponentsBuilder.fromUri(properties.idp().adminUrl())
                .pathSegment("realms", properties.idp().realm(), "protocol", "openid-connect", "token").build().toUri();
        TokenResponse response = http.post().uri(uri).contentType(MediaType.APPLICATION_FORM_URLENCODED).body(form).retrieve().body(TokenResponse.class);
        if (response == null || response.access_token() == null) throw new IllegalStateException("no token");
        token = new Token(response.access_token(), now.plusSeconds(Math.max(0, response.expires_in() - 30)));
        return token.value();
    }

    private static String nz(String s) { return s == null ? "" : s; }
}
