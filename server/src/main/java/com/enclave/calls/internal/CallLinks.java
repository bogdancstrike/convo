package com.enclave.calls.internal;

import com.enclave.contracts.Base64Url;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.groups.GroupsApi;
import com.enclave.identity.AuthenticatedDevice;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Comparator;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Authenticated member call links (specs AC-CALL-07). A link is a shareable pointer to "this
 * group's call" for people who are <em>already members</em>: it never admits non-members, guests
 * or anonymous users. Membership is checked when the link is created, when it is resolved and
 * again when {@link CallService} issues the LiveKit token. The media key never touches the server;
 * members get it from the group's encrypted ring and rekey messages.
 *
 * <p>Tokens are 32 random bytes shown once; only their SHA-256 hash is stored. Links expire
 * ({@code enclave.calls.link-ttl}, capped by {@code max-link-ttl}) and their creator can revoke them.
 */
@Service
class CallLinks {
    /** What a member learns from a link: the group and its joinable call, if one is running. */
    record Resolved(String groupId, UUID callId, Boolean video, Instant expiresAt) {}
    record Created(String token, Instant expiresAt) {}

    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcClient jdbc;
    private final GroupsApi groups;
    private final CallRepository calls;
    private final CallsProperties properties;
    private final Clock clock;

    CallLinks(JdbcClient jdbc, GroupsApi groups, CallRepository calls, CallsProperties properties, Clock clock) {
        this.jdbc = jdbc; this.groups = groups; this.calls = calls; this.properties = properties; this.clock = clock;
    }

    @Transactional
    Created create(AuthenticatedDevice me, byte[] groupId, Duration requested) {
        requireMember(me, groupId);
        Duration ttl = requested == null ? properties.linkTtl() : requested;
        if (ttl.isNegative() || ttl.isZero() || ttl.compareTo(properties.maxLinkTtl()) > 0) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "link lifetime out of range");
        byte[] token = new byte[32];
        RANDOM.nextBytes(token);
        String encoded = Base64Url.encode(token);
        Instant now = clock.instant(), expires = now.plus(ttl);
        jdbc.sql("INSERT INTO call_links (token_hash, group_id, created_by, created_at, expires_at) VALUES (:h, :g, :by, :at, :exp)")
                .param("h", hash(encoded)).param("g", groupId).param("by", me.accountId()).param("at", utc(now)).param("exp", utc(expires)).update();
        return new Created(encoded, expires);
    }

    /** Valid, unrevoked link held by a current member → the group and its newest open call. */
    @Transactional(readOnly = true)
    Resolved resolve(AuthenticatedDevice me, String token) {
        var link = find(token).filter(l -> l.revokedAt == null && l.expiresAt.isAfter(clock.instant()))
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "call link unavailable"));
        requireMember(me, link.groupId);
        var open = calls.openGroupCalls(link.groupId, clock.instant().minus(properties.maxCallAge())).stream()
                .max(Comparator.comparing(CallRepository.CallRow::createdAt));
        return new Resolved(Base64Url.encode(link.groupId), open.map(CallRepository.CallRow::callId).orElse(null),
                open.map(CallRepository.CallRow::video).orElse(null), link.expiresAt);
    }

    /** The creator revokes a link; new resolutions fail immediately. Unknown tokens are a no-op. */
    @Transactional
    void revoke(AuthenticatedDevice me, String token) {
        var link = find(token).orElse(null);
        if (link == null) return;
        if (!link.createdBy.equals(me.accountId())) throw new EnclaveException(ErrorCode.FORBIDDEN, "only the creator can revoke this link");
        jdbc.sql("UPDATE call_links SET revoked_at = :at WHERE token_hash = :h AND revoked_at IS NULL").param("at", utc(clock.instant())).param("h", hash(token)).update();
    }

    private record Link(byte[] groupId, UUID createdBy, Instant expiresAt, Instant revokedAt) {}

    private Optional<Link> find(String token) {
        if (token == null || token.length() > 100) return Optional.empty();
        return jdbc.sql("SELECT group_id, created_by, expires_at, revoked_at FROM call_links WHERE token_hash = :h").param("h", hash(token))
                .query((rs, n) -> {
                    var revoked = rs.getObject("revoked_at", OffsetDateTime.class);
                    return new Link(rs.getBytes("group_id"), rs.getObject("created_by", UUID.class), rs.getObject("expires_at", OffsetDateTime.class).toInstant(), revoked == null ? null : revoked.toInstant());
                }).optional();
    }

    private void requireMember(AuthenticatedDevice me, byte[] groupId) {
        Set<UUID> members = groups.members(groupId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "group unavailable"));
        if (!members.contains(me.accountId())) throw new EnclaveException(ErrorCode.NOT_GROUP_MEMBER, "not a member");
    }

    static byte[] hash(String token) {
        try { return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private static OffsetDateTime utc(Instant at) { return OffsetDateTime.ofInstant(at, ZoneOffset.UTC); }
}
