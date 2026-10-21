package com.enclave.groups.internal;

import com.enclave.contracts.Base64Url;
import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Invite links and join requests (GRP-03). A link is a random bearer token; the server stores only
 * its SHA-256, so a database leak does not reveal working links. Using a link never reveals the
 * (end-to-end encrypted) group name or members: it only files a join request that owners/admins
 * approve by adding the requester through a normal MLS commit, which also clears the request.
 */
@Service
class InviteService {
    record Invite(String token, Instant expiresAt) {}
    record JoinRequest(UUID accountId, Instant requestedAt) {}

    private static final SecureRandom RANDOM = new SecureRandom();
    private final JdbcClient jdbc;
    private final GroupRepository groups;
    private final GroupsProperties properties;
    private final Clock clock;

    InviteService(JdbcClient jdbc, GroupRepository groups, GroupsProperties properties, Clock clock) {
        this.jdbc = jdbc;
        this.groups = groups;
        this.properties = properties;
        this.clock = clock;
    }

    /** Creates a new link (owners/admins). Previous links stay valid until revoked or expired. */
    @Transactional
    Invite create(DeviceAddress caller, byte[] groupId) {
        requireManager(caller, groupId);
        byte[] token = new byte[24];
        RANDOM.nextBytes(token);
        Instant expires = clock.instant().plus(properties.inviteTtl());
        jdbc.sql("INSERT INTO mls_group_invites (token_hash, group_id, created_by, expires_at) VALUES (:h, :g, :by, :exp)")
                .param("h", sha256(token)).param("g", groupId).param("by", caller.accountId()).param("exp", OffsetDateTime.ofInstant(expires, ZoneOffset.UTC)).update();
        return new Invite(Base64Url.encode(token), expires);
    }

    /** Revokes every link of the group (owners/admins). */
    @Transactional
    void revokeAll(DeviceAddress caller, byte[] groupId) {
        requireManager(caller, groupId);
        jdbc.sql("DELETE FROM mls_group_invites WHERE group_id = :g").param("g", groupId).update();
    }

    /** Files a join request for the caller's account. Unknown, expired or revoked links are NOT_FOUND. */
    @Transactional
    void request(DeviceAddress caller, String token) {
        byte[] raw = Base64Url.decode(token, "token");
        if (raw.length != 24) throw new EnclaveException(ErrorCode.NOT_FOUND, "invite not found");
        byte[] groupId = jdbc.sql("SELECT group_id FROM mls_group_invites WHERE token_hash = :h AND expires_at > :now")
                .param("h", sha256(raw)).param("now", OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC))
                .query(byte[].class).optional().orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "invite not found"));
        if (groups.members(groupId).containsKey(caller.accountId())) return; // already a member
        Long pending = jdbc.sql("SELECT count(*) FROM mls_group_join_requests WHERE group_id = :g").param("g", groupId).query(Long.class).single();
        if (pending >= properties.maxJoinRequests()) throw new EnclaveException(ErrorCode.RATE_LIMITED, "too many pending requests");
        jdbc.sql("INSERT INTO mls_group_join_requests (group_id, account_id) VALUES (:g, :a) ON CONFLICT DO NOTHING")
                .param("g", groupId).param("a", caller.accountId()).update();
    }

    @Transactional(readOnly = true)
    List<JoinRequest> requests(DeviceAddress caller, byte[] groupId) {
        requireManager(caller, groupId);
        return jdbc.sql("SELECT account_id, requested_at FROM mls_group_join_requests WHERE group_id = :g ORDER BY requested_at")
                .param("g", groupId)
                .query((rs, i) -> new JoinRequest(rs.getObject(1, UUID.class), rs.getObject(2, OffsetDateTime.class).toInstant())).list();
    }

    /** Declines a request (owners/admins). */
    @Transactional
    void decline(DeviceAddress caller, byte[] groupId, UUID accountId) {
        requireManager(caller, groupId);
        groups.deleteJoinRequest(groupId, accountId);
    }

    private void requireManager(DeviceAddress caller, byte[] groupId) {
        Map<UUID, Role> members = groups.members(groupId);
        Role role = members.get(caller.accountId());
        if (role == null) throw new EnclaveException(ErrorCode.NOT_GROUP_MEMBER, "not a member");
        if (!role.canManageMembers()) throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "only admins manage invites");
    }

    private static byte[] sha256(byte[] value) {
        try { return MessageDigest.getInstance("SHA-256").digest(value); }
        catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
