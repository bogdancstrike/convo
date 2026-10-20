package com.enclave.groups.internal;

import com.enclave.contracts.DeviceAddress;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Commands accepted by {@link GroupService}. Binary fields are already decoded. */
final class GroupCommands {

    private GroupCommands() {}

    /**
     * Create a group whose initial Add commit was already applied by the creator.
     *
     * @param groupId 32-byte MLS group ID
     * @param epoch creator's epoch after adding the initial members
     * @param members initial member accounts (creator added implicitly as owner)
     * @param devices devices added in the initial commit (excluding the creator device)
     * @param welcome encoded MLS Welcome for {@code devices}, may be {@code null} for solo groups
     */
    record Create(byte[] groupId, long epoch, List<UUID> members, List<DeviceAddress> devices, byte[] welcome, boolean adminOnly) {}

    /**
     * Ordered commit with the roster/ACL changes it performs.
     *
     * @param epoch epoch the commit was created in (must equal the current epoch)
     * @param submissionId 16-byte idempotency key
     * @param commit encoded MLSMessage (public commit)
     * @param welcome encoded Welcome for added devices, optional
     * @param addMembers newly added member accounts (role member)
     * @param removeMembers removed member accounts (all their devices must be in removeDevices)
     * @param addDevices devices added by Add proposals
     * @param removeDevices devices removed by Remove proposals
     * @param roleChanges owner-only role changes
     */
    record Commit(long epoch, byte[] submissionId, byte[] commit, byte[] welcome, List<UUID> addMembers,
            List<UUID> removeMembers, List<DeviceAddress> addDevices, List<DeviceAddress> removeDevices,
            Map<UUID, Role> roleChanges) {}

    /**
     * Application message.
     *
     * @param epoch epoch of the ciphertext (must equal the current epoch)
     * @param submissionId 16-byte idempotency key
     * @param message encoded MLSMessage (private message)
     */
    record Message(long epoch, byte[] submissionId, byte[] message) {}
}
