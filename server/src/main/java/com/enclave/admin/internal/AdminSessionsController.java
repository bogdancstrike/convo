package com.enclave.admin.internal;

import static com.enclave.admin.internal.AdminPermissions.Permission.*;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import jakarta.validation.Valid;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

/**
 * Live sign-in sessions from Keycloak, merged with coarse browser observations. Ending a session
 * first verifies it still belongs to the named person, so a session id cannot be used across people.
 */
@RestController
@RequestMapping("/v1/admin")
class AdminSessionsController {
    record Session(String id, String userId, String username, String ipAddress, Instant startedAt, Instant lastAccess,
            List<String> clients, String browser, String operatingSystem, Instant observedAt, boolean current) {}
    private final KeycloakUsers idp;
    private final SessionObservations observations;
    private final AdminGuard guard;
    private final AuditLog audit;
    AdminSessionsController(KeycloakUsers idp, SessionObservations observations, AdminGuard guard, AuditLog audit) {
        this.idp = idp; this.observations = observations; this.guard = guard; this.audit = audit;
    }
    @GetMapping("/tables/sessions") ResponseEntity<AdminTableQuery.Page<Session>> sessions(@AuthenticationPrincipal Jwt admin, @RequestParam Map<String, String> params) {
        guard.require(admin, SESSIONS_READ);
        String user = params.getOrDefault("user", "");
        if (user.isBlank() || user.length() > 200) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "select a sign-in account");
        var metadata = observations.of(user).stream().collect(Collectors.toMap(SessionObservations.Observation::sessionId, o -> o));
        var rows = idp.sessions(user).stream().filter(s -> s.id() != null && user.equals(s.userId())).map(s -> {
            var o = metadata.get(s.id());
            return new Session(s.id(), user, s.username(), s.ipAddress(), instant(s.start()), instant(s.lastAccess()),
                    s.clients() == null ? List.of() : s.clients().values().stream().distinct().sorted().toList(),
                    o == null ? "Not observed" : o.browser(), o == null ? "Not observed" : o.operatingSystem(), o == null ? null : o.observedAt(),
                    user.equals(admin.getSubject()) && Objects.equals(s.id(), admin.getClaimAsString("sid")));
        }).toList();
        var page = AdminTableQuery.from(params).apply(rows, s -> {
            Map<String, Object> fields = new HashMap<>();
            fields.put("username", s.username()); fields.put("browser", s.browser() + " " + s.operatingSystem()); fields.put("ipAddress", s.ipAddress());
            fields.put("clients", String.join(" ", s.clients())); fields.put("startedAt", s.startedAt()); fields.put("lastAccess", s.lastAccess()); fields.put("id", s.id());
            return fields;
        });
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(page);
    }
    @PostMapping("/idp/users/{user}/sessions/{session}/end") AuditLog.Entry end(@AuthenticationPrincipal Jwt admin, @PathVariable String user, @PathVariable String session, @Valid @RequestBody AdminConsoleController.Reason body) {
        guard.requireAudited(admin, SESSIONS_REVOKE, "session.end", "idp:" + user);
        guard.requireRecentSignIn(admin);
        boolean owned = idp.sessions(user).stream().anyMatch(s -> session.equals(s.id()) && user.equals(s.userId()));
        if (!owned) throw new EnclaveException(ErrorCode.NOT_FOUND, "session is no longer active for this person");
        idp.endSession(session);
        // Session identifiers are sensitive correlation data; do not put them in the exported audit.
        return audit.append(guard.actor(admin), "session.end", "idp:" + user, body.reason());
    }
    private static Instant instant(Long millis) { return millis == null ? null : Instant.ofEpochMilli(millis); }
}
