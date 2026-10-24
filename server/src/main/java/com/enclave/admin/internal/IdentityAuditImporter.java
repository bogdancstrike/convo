package com.enclave.admin.internal;

import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.PlatformTransactionManager;

/** Authoritative Keycloak events: cursor, deduplication and hash-chain entries commit together. */
@Component
class IdentityAuditImporter {
    record Status(boolean configured, Instant lastSuccess, String error) {}
    private final KeycloakUsers idp;
    private final JdbcClient jdbc;
    private final AuditLog audit;
    private final Clock clock;
    private final TransactionTemplate transaction;
    private volatile Instant lastSuccess;
    private volatile String error;
    IdentityAuditImporter(KeycloakUsers idp, JdbcClient jdbc, AuditLog audit, Clock clock, PlatformTransactionManager manager) {
        this.idp = idp; this.jdbc = jdbc; this.audit = audit; this.clock = clock;
        this.transaction = new TransactionTemplate(manager);
    }
    Status status() { return new Status(idp.available(), lastSuccess, error); }
    @Scheduled(fixedDelayString = "${enclave.admin.audit-poll-interval:PT15S}", initialDelayString = "PT5S")
    void poll() {
        if (!idp.available()) return;
        try {
            transaction.executeWithoutResult(status -> importEvents());
            lastSuccess = clock.instant(); error = null;
        } catch (RuntimeException failure) {
            error = "Identity audit sync failed. Check Keycloak availability, event storage and the view-events role.";
            LoggerFactory.getLogger(getClass()).warn("Identity audit import failed ({}); cursor retained for retry", failure.getClass().getSimpleName());
        }
    }
    void importEvents() {
        long cursor = jdbc.sql("SELECT through_millis FROM identity_audit_cursor WHERE source = 'keycloak' FOR UPDATE").query(Long.class).single();
        long until = clock.millis() - 3000;
        if (until < cursor) return;
        // Fixed upper bound stabilizes pagination; overlap tolerates late source commits.
        long from = Math.max(0, cursor - 60_000);
        int offset = 0;
        while (true) {
            List<KeycloakUsers.IdentityEvent> page = idp.events(from, until, offset, 200);
            for (var event : page) ingest(event);
            if (page.size() < 200) break;
            offset += page.size();
            if (offset >= 100_000) throw new IllegalStateException("identity audit backlog exceeds one import batch");
        }
        jdbc.sql("UPDATE identity_audit_cursor SET through_millis = :to WHERE source = 'keycloak'").param("to", until).update();
        jdbc.sql("DELETE FROM identity_audit_import WHERE source_time < :cutoff")
                .param("cutoff", OffsetDateTime.ofInstant(clock.instant().minusSeconds(8 * 86400), ZoneOffset.UTC)).update();
    }
    void ingest(KeycloakUsers.IdentityEvent event) {
        String action = action(event);
        if (action == null) return;
        if (event.id() == null || event.id().isBlank()) throw new IllegalStateException("identity event has no stable id");
        Instant at = Instant.ofEpochMilli(event.time());
        int inserted = jdbc.sql("INSERT INTO identity_audit_import(event_id, source_time) VALUES (:id, :at) ON CONFLICT DO NOTHING")
                .param("id", event.id()).param("at", OffsetDateTime.ofInstant(at, ZoneOffset.UTC)).update();
        if (inserted == 0) return;
        String subject = event.userId() == null ? "unknown" : clean(event.userId());
        String username = event.details() == null ? null : event.details().get("username");
        String actor = "idp:" + subject + (username == null ? "" : " (" + clean(username) + ")");
        String reason = "Keycloak " + clean(event.type()) + " · client " + clean(event.clientId());
        if (event.error() != null) reason += " · error " + clean(event.error());
        audit.appendAt(at, actor, action, "idp:" + subject, reason);
    }
    static String action(KeycloakUsers.IdentityEvent e) {
        if (e.type() == null) return null;
        String type = e.type();
        if (type.startsWith("CLIENT_") || type.equals("CODE_TO_TOKEN") || type.equals("REFRESH_TOKEN") || type.equals("USER_INFO_REQUEST")) return null;
        boolean failed = type.endsWith("_ERROR");
        String base = failed ? type.substring(0, type.length() - 6) : type;
        String credential = e.details() == null ? "" : e.details().getOrDefault("credential_type", "");
        String action = switch (base) {
            case "LOGIN" -> "auth.login";
            case "LOGOUT" -> "auth.logout";
            case "REGISTER" -> "auth.register";
            case "UPDATE_PASSWORD", "RESET_PASSWORD" -> "credential.password-change";
            case "UPDATE_TOTP" -> "credential.authenticator-add";
            case "REMOVE_TOTP" -> "credential.authenticator-remove";
            case "UPDATE_CREDENTIAL" -> credential.contains("webauthn") ? "passkey.add" : "credential.add";
            case "REMOVE_CREDENTIAL" -> credential.contains("webauthn") ? "passkey.remove" : "credential.remove";
            case "UPDATE_PROFILE" -> "profile.update";
            case "UPDATE_EMAIL" -> "profile.email-change";
            case "VERIFY_EMAIL" -> "profile.email-verify";
            default -> "auth." + base.toLowerCase(Locale.ROOT).replace('_', '-');
        };
        return failed || e.error() != null ? action + ".failed" : action;
    }
    private static String clean(String value) {
        if (value == null) return "unknown";
        String cleaned = value.replaceAll("[\\r\\n\\t]", " ");
        return cleaned.substring(0, Math.min(cleaned.length(), 200));
    }
}
