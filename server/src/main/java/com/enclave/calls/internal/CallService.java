package com.enclave.calls.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.groups.GroupsApi;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.IdentityApi;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.Set;
import java.util.UUID;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Call authorization. A direct call admits its two accounts; a group call admits current group
 * members. Every device joins with its own identity ({@code accountId:deviceId}) so clients can
 * show who is connected; media keys never reach the server.
 */
@Service
class CallService {
    record Join(UUID callId, String room, String token, String path, boolean video) {}

    private static final SecureRandom RANDOM = new SecureRandom();
    private final CallRepository calls;
    private final IdentityApi identity;
    private final GroupsApi groups;
    private final LiveKitTokens tokens;
    private final CallsProperties properties;
    private final Clock clock;
    private final org.springframework.context.ApplicationEventPublisher events;

    CallService(CallRepository calls, IdentityApi identity, GroupsApi groups, LiveKitTokens tokens, CallsProperties properties, Clock clock, org.springframework.context.ApplicationEventPublisher events) {
        this.calls = calls;
        this.identity = identity;
        this.groups = groups;
        this.tokens = tokens;
        this.properties = properties;
        this.clock = clock;
        this.events = events;
    }

    @Transactional
    Join create(AuthenticatedDevice me, UUID peer, byte[] groupId, boolean video) {
        requireEnabled();
        if ((peer == null) == (groupId == null)) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "exactly one of peer or groupId");
        if (peer != null) {
            if (peer.equals(me.accountId()) || identity.activeRoster(peer).isEmpty()) throw new EnclaveException(ErrorCode.NOT_FOUND, "peer unavailable");
        } else {
            Set<UUID> members = groups.members(groupId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "group unavailable"));
            if (!members.contains(me.accountId())) throw new EnclaveException(ErrorCode.NOT_GROUP_MEMBER, "not a member");
            if (members.size() > properties.maxGroupParticipants()) throw new EnclaveException(ErrorCode.POLICY_VIOLATION, "group too large for a call");
        }
        byte[] name = new byte[18];
        RANDOM.nextBytes(name);
        var row = new CallRepository.CallRow(UUID.randomUUID(), Base64.getUrlEncoder().withoutPadding().encodeToString(name), me.accountId(), peer, groupId, video, clock.instant(), null);
        calls.insert(row);
        var joined = join(me, row);
        events.publishEvent(new com.enclave.contracts.HandledOperation(com.enclave.contracts.HandledOperation.Kind.CALL_STARTED));
        return joined;
    }

    @Transactional(readOnly = true)
    Join join(AuthenticatedDevice me, UUID callId) {
        requireEnabled();
        return join(me, calls.find(callId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "call not found")));
    }

    @Transactional
    void end(AuthenticatedDevice me, UUID callId) {
        var call = calls.find(callId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "call not found"));
        authorize(me, call);
        calls.end(callId, clock.instant());
    }

    private Join join(AuthenticatedDevice me, CallRepository.CallRow call) {
        authorize(me, call);
        Instant now = clock.instant();
        if (call.endedAt() != null || call.createdAt().plus(properties.maxCallAge()).isBefore(now)) {
            throw new EnclaveException(ErrorCode.NOT_FOUND, "call ended");
        }
        String participant = me.accountId() + ":" + me.deviceId();
        return new Join(call.callId(), call.room(), tokens.issue(call.room(), participant), properties.livekitPath(), call.video());
    }

    /** Not-found for outsiders: call IDs must not reveal anything to non-participants. */
    private void authorize(AuthenticatedDevice me, CallRepository.CallRow call) {
        boolean allowed = call.peer() != null
                ? me.accountId().equals(call.createdBy()) || me.accountId().equals(call.peer())
                : groups.members(call.groupId()).map((m) -> m.contains(me.accountId())).orElse(false);
        if (!allowed) throw new EnclaveException(ErrorCode.NOT_FOUND, "call not found");
    }

    private void requireEnabled() {
        if (!properties.usable()) throw new EnclaveException(ErrorCode.POLICY_VIOLATION, "calls are not configured");
    }

    @Scheduled(fixedDelayString = "PT1H")
    @Transactional
    void purge() { calls.purgeBefore(clock.instant().minus(properties.maxCallAge()).minus(properties.maxCallAge())); }
}
