package com.enclave.admin.internal;

import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.function.Predicate;
import javax.sql.DataSource;
import org.springframework.boot.availability.ApplicationAvailability;
import org.springframework.boot.availability.ReadinessState;
import org.springframework.core.env.Environment;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.stereotype.Component;
import software.amazon.awssdk.auth.credentials.AwsBasicCredentials;
import software.amazon.awssdk.auth.credentials.StaticCredentialsProvider;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.S3Configuration;
import tools.jackson.databind.ObjectMapper;

/** Infrastructure checks use the effective server configuration, without exposing its values. */
@Component
class ComponentProbes {
    private final Environment env;
    private final DataSource database;
    private final RedisConnectionFactory redis;
    private final ApplicationAvailability availability;
    private final SystemHealthProperties properties;
    private final IdentityAuditImporter audit;
    private final Clock clock;
    private final ObjectMapper json;
    private final NetworkHealth network;

    ComponentProbes(Environment env, DataSource database, RedisConnectionFactory redis, ApplicationAvailability availability,
            SystemHealthProperties properties, IdentityAuditImporter audit, Clock clock, ObjectMapper json) {
        this.env = env; this.database = database; this.redis = redis; this.availability = availability;
        this.properties = properties; this.audit = audit; this.clock = clock; this.json = json;
        this.network = new NetworkHealth(properties.timeout());
    }
    List<SystemHealth.Probe> probes() {
        return List.of(
            probe("api", "Application API", "Core", true, "Application readiness", () -> availability.getReadinessState() == ReadinessState.ACCEPTING_TRAFFIC
                    ? SystemHealth.Observation.up("Application is accepting requests.") : state(SystemHealth.State.DOWN, "Application is not accepting requests.")),
            probe("database", "PostgreSQL", "Core", true, "Acquire connection and SELECT 1", () -> {
                try (var connection = database.getConnection(); var statement = connection.createStatement()) {
                    statement.setQueryTimeout(Math.max(1, (int) properties.timeout().toSeconds()));
                    try (var result = statement.executeQuery("SELECT 1")) {
                        return result.next() && result.getInt(1) == 1 ? SystemHealth.Observation.up("Database connection and query succeeded.") : state(SystemHealth.State.DOWN, "Database query returned an unexpected result.");
                    }
                }
            }),
            probe("valkey", "Valkey", "Core", true, "Redis protocol PING", () -> {
                try (var connection = redis.getConnection()) {
                    return "PONG".equals(connection.ping()) ? SystemHealth.Observation.up("Cache and realtime event transport responded to PING.") : state(SystemHealth.State.DOWN, "Cache did not return PONG.");
                }
            }),
            probe("identity", "Keycloak", "Identity & access", true, "Realm signing-key endpoint", () -> network.http(env.getProperty("enclave.security.oidc.jwk-set-uri", "http://localhost:8180/auth/realms/enclave/protocol/openid-connect/certs"), body -> json.readTree(body).path("keys").isArray() && !json.readTree(body).path("keys").isEmpty())),
            probe("identity-audit", "Identity audit sync", "Identity & access", true, "Importer success within two minutes", () -> {
                var source = audit.status();
                if (!source.configured()) return state(SystemHealth.State.DISABLED, "Identity audit integration is not configured.");
                if (source.error() != null) return state(SystemHealth.State.DEGRADED, source.error());
                if (source.lastSuccess() == null) return state(SystemHealth.State.UNKNOWN, "Waiting for the first identity audit synchronization.");
                if (source.lastSuccess().isBefore(clock.instant().minusSeconds(120))) return state(SystemHealth.State.DEGRADED, "No successful identity audit synchronization in the last two minutes.");
                return SystemHealth.Observation.up("Identity events are synchronizing. Last success: " + source.lastSuccess());
            }),
            probe("attachments", "Attachment storage", "Storage", true, "Authenticated S3 HEAD bucket", this::storage),
            probe("calls", "LiveKit calls", "Communications", false, "Signalling service readiness; no media session created", () -> {
                if (!enabled("enclave.calls.enabled")) return state(SystemHealth.State.DISABLED, "Calling is disabled.");
                return endpoint(env.getProperty("enclave.calls.livekit-url", ""), "", body -> "OK".equals(body.trim()));
            }),
            probe("push", "Notification distributor", "Communications", false, "ntfy health response", () -> {
                if (!enabled("enclave.push.enabled")) return state(SystemHealth.State.DISABLED, "Push wake-ups are disabled.");
                return endpoint(env.getProperty("enclave.push.internal-origin", ""), "/v1/health", body -> json.readTree(body).path("healthy").asBoolean());
            }),
            probe("web-push", "Browser push", "Communications", false, "Local VAPID configuration; external provider delivery not probed", () -> {
                if (!enabled("enclave.push.web-push.enabled")) return state(SystemHealth.State.DISABLED, "Browser push is disabled.");
                if (env.getProperty("enclave.push.web-push.public-key", "").isBlank() || env.getProperty("enclave.push.web-push.private-key", "").isBlank()) return state(SystemHealth.State.DOWN, "Browser push is enabled but VAPID keys are missing.");
                return state(SystemHealth.State.UNKNOWN, "VAPID keys are configured. Delivery to browser providers is observed through push diagnostics, not active test notifications.");
            }),
            probe("turn", "TURN / STUN", "Communications", false, "UDP binding exchange; relay allocation and external routing not tested", () -> {
                if (!enabled("enclave.calls.enabled")) return state(SystemHealth.State.DISABLED, "Calling is disabled.");
                if (properties.turnHost().isBlank()) return unconfigured();
                return network.stun(properties.turnHost(), properties.turnPort());
            }),
            probe("web", "Messenger frontend", "Interfaces", true, "Internal nginx response and frontend document", () -> endpoint(properties.webUrl(), "", body -> body.toLowerCase(java.util.Locale.ROOT).contains("<html"))),
            probe("admin", "Admin frontend", "Interfaces", true, "Internal nginx response and frontend document", () -> endpoint(properties.adminUrl(), "", body -> body.toLowerCase(java.util.Locale.ROOT).contains("<html"))),
            probe("operations", "Database console", "Operations", false, "Optional pgAdmin ping endpoint", () -> endpoint(properties.operationsUrl(), "", body -> "PING".equalsIgnoreCase(body.trim())))
        );
    }
    private SystemHealth.Observation storage() {
        try (var client = S3Client.builder()
                .endpointOverride(URI.create(env.getProperty("enclave.attachments.endpoint", "http://localhost:8333")))
                .region(Region.of(env.getProperty("enclave.attachments.region", "us-east-1")))
                .credentialsProvider(StaticCredentialsProvider.create(AwsBasicCredentials.create(env.getProperty("enclave.attachments.access-key", "enclave-dev-access"), env.getProperty("enclave.attachments.secret-key", "enclave-dev-secret-change-me"))))
                .serviceConfiguration(S3Configuration.builder().pathStyleAccessEnabled(env.getProperty("enclave.attachments.path-style", Boolean.class, true)).build())
                .httpClientBuilder(UrlConnectionHttpClient.builder().connectionTimeout(properties.timeout()).socketTimeout(properties.timeout()))
                .overrideConfiguration(c -> c.apiCallTimeout(properties.timeout()).apiCallAttemptTimeout(properties.timeout())).build()) {
            client.headBucket(b -> b.bucket(env.getProperty("enclave.attachments.bucket", "enclave-attachments")));
            return SystemHealth.Observation.up("Attachment bucket is reachable with the configured credentials. No object was written.");
        }
    }
    private SystemHealth.Observation endpoint(String base, String suffix, Predicate<String> valid) throws Exception {
        return base.isBlank() ? unconfigured() : network.http(base.replaceAll("/+$", "") + suffix, valid);
    }
    private boolean enabled(String key) { return env.getProperty(key, Boolean.class, false); }
    private static SystemHealth.Probe probe(String id, String name, String group, boolean required, String scope, SystemHealth.Operation operation) { return new SystemHealth.Probe(id, name, group, required, scope, operation); }
    private static SystemHealth.Observation state(SystemHealth.State status, String detail) { return new SystemHealth.Observation(status, detail); }
    private static SystemHealth.Observation unconfigured() { return state(SystemHealth.State.UNKNOWN, "No internal health target is configured for this component."); }
}
