package com.enclave.groups.internal;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.groups.internal.GroupRepository.GroupRow;
import com.enclave.identity.DeviceRevoked;
import com.enclave.identity.IdentityApi;
import com.enclave.messaging.DeliveryApi;
import com.enclave.messaging.GroupEnvelope;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** MLS Delivery Service use cases (see module {@code docs.md}). */
@Service
class GroupService {

    private static final int GROUP_ID_BYTES = 32;

    private final GroupRepository groups;
    private final IdentityApi identity;
    private final DeliveryApi delivery;
    private final GroupsProperties properties;
    private final Clock clock;

    GroupService(GroupRepository groups, IdentityApi identity, DeliveryApi delivery, GroupsProperties properties, Clock clock) {
        this.groups = groups;
        this.identity = identity;
        this.delivery = delivery;
        this.properties = properties;
        this.clock = clock;
    }

    /** Current server view of a group. */
    record GroupView(byte[] groupId, long epoch, Map<UUID, Role> members, List<DeviceAddress> devices, boolean adminOnly) {}

    /** Commit acceptance. */
    record Accepted(long epoch, long seq, boolean duplicate) {}

    /** Creates a group; the creator becomes owner. Idempotent for the creating device. */
    @Transactional
    GroupView create(DeviceAddress creator, GroupCommands.Create cmd) {
        requireGroupId(cmd.groupId());
        if (cmd.welcome() != null && cmd.welcome().length > properties.maxHandshakeBytes()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "welcome too large");
        }
        Set<UUID> members = new HashSet<>(cmd.members());
        members.add(creator.accountId());
        if (members.size() > properties.maxMembers() || cmd.devices().size() + 1 > properties.maxDevices()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "group too large");
        }
        for (DeviceAddress d : cmd.devices()) {
            if (!members.contains(d.accountId()) || d.equals(creator) || !identity.isActive(d)) {
                throw new EnclaveException(ErrorCode.INVALID_REQUEST, "invalid initial device " + d);
            }
        }
        if (!groups.insertGroup(cmd.groupId(), cmd.epoch(), cmd.adminOnly())) {
            GroupRow existing = groups.lock(cmd.groupId(), false)
                    .orElseThrow(() -> new EnclaveException(ErrorCode.INVALID_REQUEST, "group ID already used"));
            if (groups.members(cmd.groupId()).get(creator.accountId()) == Role.OWNER && groups.hasDevice(cmd.groupId(), creator)) {
                return view(existing); // retry of our own creation
            }
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "group ID already used");
        }
        groups.upsertMember(cmd.groupId(), creator.accountId(), Role.OWNER);
        members.stream().filter(m -> !m.equals(creator.accountId()))
                .forEach(m -> groups.upsertMember(cmd.groupId(), m, Role.MEMBER));
        groups.addDevice(cmd.groupId(), creator);
        cmd.devices().forEach(d -> groups.addDevice(cmd.groupId(), d));
        if (cmd.welcome() != null && !cmd.devices().isEmpty()) {
            delivery.deliverGroup(cmd.devices(), new GroupEnvelope(GroupEnvelope.Kind.WELCOME, creator, cmd.groupId(),
                    cmd.epoch(), 0, cmd.welcome()));
        }
        return view(groups.lock(cmd.groupId(), false).orElseThrow());
    }

    /** Accepts an ordered commit (epoch compare-and-set) and applies its roster/ACL changes. */
    @Transactional
    Accepted commit(DeviceAddress caller, byte[] groupId, GroupCommands.Commit cmd) {
        GroupRow group = lockForMember(groupId, caller, false);
        if (cmd.submissionId() == null || cmd.submissionId().length != 16) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "submissionId must be 16 bytes");
        }
        if (cmd.commit() == null || cmd.commit().length == 0 || cmd.commit().length > properties.maxHandshakeBytes()
                || (cmd.welcome() != null && cmd.welcome().length > properties.maxHandshakeBytes())) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "commit too large");
        }
        byte[] digest = digest(cmd.commit(), cmd.welcome());
        var prior = groups.eventBySubmission(groupId, cmd.submissionId());
        if (prior.isPresent()) {
            if (!MessageDigest.isEqual(prior.get().digest(), digest)) {
                throw new EnclaveException(ErrorCode.IDEMPOTENCY_CONFLICT, "submission ID reused with different content");
            }
            return new Accepted(prior.get().epoch() + 1, prior.get().seq(), true);
        }
        if (cmd.epoch() != group.epoch()) {
            throw new EnclaveException(ErrorCode.EPOCH_CONFLICT, "commit is not for the current epoch",
                    Map.of("currentEpoch", group.epoch()));
        }

        Map<UUID, Role> members = groups.members(groupId);
        List<DeviceAddress> roster = groups.devices(groupId);
        authorize(caller, members, roster, cmd);

        long newEpoch = group.epoch() + 1;
        long seq = group.nextSeq();
        groups.advance(groupId, newEpoch, seq + 1);
        groups.insertEvent(groupId, seq, group.epoch(), cmd.submissionId(), digest, cmd.commit());
        cmd.addMembers().forEach(a -> groups.upsertMember(groupId, a, Role.MEMBER));
        cmd.addDevices().forEach(d -> groups.addDevice(groupId, d));
        cmd.removeDevices().forEach(d -> groups.removeDevice(groupId, d));
        cmd.removeMembers().forEach(a -> groups.deleteMember(groupId, a));
        cmd.roleChanges().forEach((a, r) -> groups.upsertMember(groupId, a, r));

        // Everyone in the pre-commit roster (including removed devices) learns the new epoch.
        List<DeviceAddress> recipients = roster.stream().filter(d -> !d.equals(caller)).toList();
        delivery.deliverGroup(recipients, new GroupEnvelope(GroupEnvelope.Kind.COMMIT, caller, groupId, group.epoch(), seq, cmd.commit()));
        if (cmd.welcome() != null && !cmd.addDevices().isEmpty()) {
            delivery.deliverGroup(cmd.addDevices(), new GroupEnvelope(GroupEnvelope.Kind.WELCOME, caller, groupId, newEpoch, 0, cmd.welcome()));
        }
        return new Accepted(newEpoch, seq, false);
    }

    /** Fans out an application message encrypted for the current epoch. */
    @Transactional
    boolean message(DeviceAddress caller, byte[] groupId, GroupCommands.Message cmd) {
        GroupRow group = lockForMember(groupId, caller, true);
        if (group.adminOnly() && groups.members(groupId).get(caller.accountId()) == Role.MEMBER) {
            throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "only admins can post in this channel");
        }
        if (cmd.submissionId() == null || cmd.submissionId().length != 16) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "submissionId must be 16 bytes");
        }
        if (cmd.message() == null || cmd.message().length == 0 || cmd.message().length > properties.maxMessageBytes()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "message too large");
        }
        byte[] digest = digest(cmd.message(), null);
        var prior = groups.submissionDigest(groupId, caller, cmd.submissionId());
        if (prior.isPresent()) {
            if (!MessageDigest.isEqual(prior.get(), digest)) {
                throw new EnclaveException(ErrorCode.IDEMPOTENCY_CONFLICT, "submission ID reused with different content");
            }
            return true;
        }
        if (cmd.epoch() != group.epoch()) {
            throw new EnclaveException(ErrorCode.EPOCH_CONFLICT, "message is not for the current epoch",
                    Map.of("currentEpoch", group.epoch()));
        }
        groups.insertSubmission(groupId, caller, cmd.submissionId(), digest, clock.instant().plus(properties.submissionRetention()));
        List<DeviceAddress> recipients = groups.devices(groupId).stream().filter(d -> !d.equals(caller)).toList();
        delivery.deliverGroup(recipients, new GroupEnvelope(GroupEnvelope.Kind.PRIVATE, caller, groupId, cmd.epoch(), 0, cmd.message()));
        return false;
    }

    /** Groups of the caller's account. */
    @Transactional(readOnly = true)
    List<Map<String, Object>> mine(UUID accountId) {
        return groups.groupsOf(accountId);
    }

    /** Server view of a group for one of its members. */
    @Transactional(readOnly = true)
    GroupView get(DeviceAddress caller, byte[] groupId) {
        requireGroupId(groupId);
        GroupRow group = groups.find(groupId)
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_GROUP_MEMBER, "not a member"));
        if (!groups.members(groupId).containsKey(caller.accountId())) {
            throw new EnclaveException(ErrorCode.NOT_GROUP_MEMBER, "not a member");
        }
        return view(group);
    }

    /** Revoked devices stop receiving group ciphertext immediately. */
    @ApplicationModuleListener
    void on(DeviceRevoked event) {
        groups.removeDeviceEverywhere(event.address());
    }

    @Scheduled(fixedDelayString = "${enclave.groups.purge-interval:PT1H}")
    @Transactional
    void purge() {
        groups.purgeSubmissions();
    }

    // --- rules -----------------------------------------------------------------------------

    /**
     * Server-side ACL mirror (specs §30.2): admins/owners manage other accounts; anyone manages
     * their own devices; only owners change roles; the last owner stays.
     */
    private void authorize(DeviceAddress caller, Map<UUID, Role> members, List<DeviceAddress> roster, GroupCommands.Commit cmd) {
        Role callerRole = members.get(caller.accountId());
        boolean touchesOthers = !cmd.addMembers().isEmpty()
                || cmd.removeMembers().stream().anyMatch(a -> !a.equals(caller.accountId()))
                || cmd.addDevices().stream().anyMatch(d -> !d.accountId().equals(caller.accountId()))
                || cmd.removeDevices().stream().anyMatch(d -> !d.accountId().equals(caller.accountId()));
        if (touchesOthers && !callerRole.canManageMembers()) {
            throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "only admins can change membership");
        }
        if (!cmd.roleChanges().isEmpty() && callerRole != Role.OWNER) {
            throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "only owners can change roles");
        }
        if (cmd.removeMembers().contains(caller.accountId())) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "a committer cannot remove itself; leave via proposal");
        }
        for (UUID removed : cmd.removeMembers()) {
            if (members.get(removed) == Role.OWNER && callerRole != Role.OWNER) {
                throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "only owners can remove owners");
            }
        }

        Map<UUID, Role> after = new LinkedHashMap<>(members);
        cmd.addMembers().forEach(a -> after.putIfAbsent(a, Role.MEMBER));
        cmd.removeMembers().forEach(after::remove);
        after.putAll(cmd.roleChanges());
        if (after.values().stream().noneMatch(r -> r == Role.OWNER)) {
            throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "a group needs at least one owner");
        }
        if (after.size() > properties.maxMembers()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "group too large");
        }

        Set<DeviceAddress> rosterAfter = new HashSet<>(roster);
        for (DeviceAddress d : cmd.addDevices()) {
            if (!after.containsKey(d.accountId()) || !identity.isActive(d) || !rosterAfter.add(d)) {
                throw new EnclaveException(ErrorCode.INVALID_REQUEST, "invalid added device " + d);
            }
        }
        for (DeviceAddress d : cmd.removeDevices()) {
            if (!rosterAfter.remove(d)) {
                throw new EnclaveException(ErrorCode.INVALID_REQUEST, "device not in group " + d);
            }
        }
        Map<UUID, Integer> remaining = new HashMap<>();
        rosterAfter.forEach(d -> remaining.merge(d.accountId(), 1, Integer::sum));
        for (UUID removed : cmd.removeMembers()) {
            if (remaining.containsKey(removed)) {
                throw new EnclaveException(ErrorCode.INVALID_REQUEST, "removed member still has devices in the group");
            }
        }
        if (rosterAfter.size() > properties.maxDevices()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "too many devices");
        }
    }

    private GroupRow lockForMember(byte[] groupId, DeviceAddress caller, boolean shared) {
        requireGroupId(groupId);
        GroupRow group = groups.lock(groupId, shared)
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_GROUP_MEMBER, "not a member"));
        if (!groups.hasDevice(groupId, caller)) {
            throw new EnclaveException(ErrorCode.NOT_GROUP_MEMBER, "device is not in the group");
        }
        return group;
    }

    private GroupView view(GroupRow group) {
        return new GroupView(group.groupId(), group.epoch(), groups.members(group.groupId()), groups.devices(group.groupId()), group.adminOnly());
    }

    private static void requireGroupId(byte[] groupId) {
        if (groupId == null || groupId.length != GROUP_ID_BYTES) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "groupId must be 32 bytes");
        }
    }

    private static byte[] digest(byte[] first, byte[] second) {
        try {
            MessageDigest sha = MessageDigest.getInstance("SHA-256");
            sha.update(first);
            if (second != null) {
                sha.update(second);
            }
            return sha.digest();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
