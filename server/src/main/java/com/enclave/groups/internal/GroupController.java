package com.enclave.groups.internal;

import static com.enclave.contracts.Base64Url.decode;
import static com.enclave.contracts.Base64Url.encode;

import com.enclave.contracts.DeviceAddress;
import com.enclave.identity.AuthenticatedDevice;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Group REST API (specs §12.4). Binary fields are unpadded base64url; group IDs in paths too. */
@RestController
class GroupController {

    private final GroupService groups;
    private final InviteService invites;

    GroupController(GroupService groups, InviteService invites) {
        this.groups = groups;
        this.invites = invites;
    }

    /** Device reference. */
    record DeviceDto(UUID accountId, int deviceId) {
        DeviceAddress toAddress() {
            return new DeviceAddress(accountId, deviceId);
        }

        static DeviceDto of(DeviceAddress d) {
            return new DeviceDto(d.accountId(), d.deviceId());
        }
    }

    /** {@code POST /v1/groups} request. */
    record CreateRequest(String groupId, long epoch, List<UUID> members, List<DeviceDto> devices, String welcome, boolean adminOnly) {}

    /** {@code POST /v1/groups/{gid}/commits} request. */
    record CommitRequest(long epoch, String submissionId, String commit, String welcome, List<UUID> addMembers,
            List<UUID> removeMembers, List<DeviceDto> addDevices, List<DeviceDto> removeDevices, Map<UUID, String> roleChanges) {}

    /** {@code PUT /v1/groups/{gid}/messages} request. */
    record MessageRequest(long epoch, String submissionId, String message, Boolean urgent, Boolean interaction) {}

    /** Member entry. */
    record MemberDto(UUID accountId, String role) {}

    /** Group view. */
    record GroupDto(String groupId, long epoch, List<MemberDto> members, List<DeviceDto> devices, boolean adminOnly, List<java.util.UUID> departed) {
        static GroupDto of(GroupService.GroupView v) {
            return new GroupDto(encode(v.groupId()), v.epoch(),
                    v.members().entrySet().stream().map(e -> new MemberDto(e.getKey(), e.getValue().db())).toList(),
                    v.devices().stream().map(DeviceDto::of).toList(), v.adminOnly(), List.copyOf(v.departed()));
        }
    }

    /** Group summary. */
    record GroupSummaryDto(String groupId, long epoch, String role, long members, boolean adminOnly) {}

    /** Commit acceptance. */
    record AcceptedDto(long epoch, long seq, boolean duplicate) {}

    @PostMapping("/v1/groups")
    @ResponseStatus(HttpStatus.CREATED)
    GroupDto create(@AuthenticationPrincipal AuthenticatedDevice me, @RequestBody CreateRequest body) {
        return GroupDto.of(groups.create(me.address(), new GroupCommands.Create(
                decode(body.groupId(), "groupId"), body.epoch(), list(body.members()),
                list(body.devices()).stream().map(DeviceDto::toAddress).toList(),
                body.welcome() == null ? null : decode(body.welcome(), "welcome"), body.adminOnly())));
    }

    @GetMapping("/v1/groups/mine")
    List<GroupSummaryDto> mine(@AuthenticationPrincipal AuthenticatedDevice me) {
        return groups.mine(me.accountId()).stream().map(row -> new GroupSummaryDto(
                encode((byte[]) row.get("group_id")), ((Number) row.get("epoch")).longValue(),
                (String) row.get("role"), ((Number) row.get("members")).longValue(), (Boolean) row.get("admin_only"))).toList();
    }

    @GetMapping("/v1/groups/{groupId}")
    GroupDto get(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId) {
        return GroupDto.of(groups.get(me.address(), decode(groupId, "groupId")));
    }

    record CommitEventDto(long seq, long epoch, String commit) {}

    /** Accepted commits from an epoch on (at most 100 per page), for a device catching up. */
    @GetMapping("/v1/groups/{groupId}/events")
    List<CommitEventDto> events(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId, @RequestParam("fromEpoch") long fromEpoch) {
        return groups.commitsFrom(me.address(), decode(groupId, "groupId"), fromEpoch).stream()
                .map(e -> new CommitEventDto(e.seq(), e.epoch(), encode(e.commit()))).toList();
    }

    /**
     * Resolves a commit whose response was lost (specs §6): whether this submission was accepted, and
     * the resulting epoch and sequence. 404 when it was not (the client discards its pending commit).
     */
    @GetMapping("/v1/groups/{groupId}/commits/{submissionId}")
    AcceptedDto commitStatus(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId, @PathVariable String submissionId) {
        var event = groups.acceptedCommit(me.address(), decode(groupId, "groupId"), decode(submissionId, "submissionId"));
        return new AcceptedDto(event.epoch() + 1, event.seq(), true);
    }

    @PostMapping("/v1/groups/{groupId}/commits")
    AcceptedDto commit(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId, @RequestBody CommitRequest body) {
        var accepted = groups.commit(me.address(), decode(groupId, "groupId"), new GroupCommands.Commit(
                body.epoch(), decode(body.submissionId(), "submissionId"), decode(body.commit(), "commit"),
                body.welcome() == null ? null : decode(body.welcome(), "welcome"),
                list(body.addMembers()), list(body.removeMembers()),
                list(body.addDevices()).stream().map(DeviceDto::toAddress).toList(),
                list(body.removeDevices()).stream().map(DeviceDto::toAddress).toList(),
                body.roleChanges() == null ? Map.of() : body.roleChanges().entrySet().stream()
                        .collect(Collectors.toMap(Map.Entry::getKey, e -> Role.parse(e.getValue())))));
        return new AcceptedDto(accepted.epoch(), accepted.seq(), accepted.duplicate());
    }

    @PostMapping("/v1/groups/{groupId}/invites")
    ResponseEntity<InviteService.Invite> invite(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(invites.create(me.address(), decode(groupId, "groupId")));
    }

    @DeleteMapping("/v1/groups/{groupId}/invites")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void revokeInvites(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId) {
        invites.revokeAll(me.address(), decode(groupId, "groupId"));
    }

    @PostMapping("/v1/invites/{token}/requests")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void requestToJoin(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String token) {
        invites.request(me.address(), token);
    }

    @GetMapping("/v1/groups/{groupId}/join-requests")
    List<InviteService.JoinRequest> joinRequests(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId) {
        return invites.requests(me.address(), decode(groupId, "groupId"));
    }

    @DeleteMapping("/v1/groups/{groupId}/join-requests/{accountId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void declineJoin(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId, @PathVariable java.util.UUID accountId) {
        invites.decline(me.address(), decode(groupId, "groupId"), accountId);
    }

    @PutMapping("/v1/groups/{groupId}/bans/{accountId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void ban(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId, @PathVariable java.util.UUID accountId) {
        groups.ban(me.address(), decode(groupId, "groupId"), accountId, true);
    }

    @DeleteMapping("/v1/groups/{groupId}/bans/{accountId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void unban(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId, @PathVariable java.util.UUID accountId) {
        groups.ban(me.address(), decode(groupId, "groupId"), accountId, false);
    }

    @GetMapping("/v1/groups/{groupId}/bans")
    java.util.Set<java.util.UUID> bans(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId) {
        return groups.bans(me.address(), decode(groupId, "groupId"));
    }

    @PostMapping("/v1/groups/{groupId}/leave")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void leave(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId) {
        groups.leave(me.address(), decode(groupId, "groupId"));
    }

    @PutMapping("/v1/groups/{groupId}/messages")
    Map<String, Object> message(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId,
            @RequestBody MessageRequest body) {
        boolean duplicate = groups.message(me.address(), decode(groupId, "groupId"), new GroupCommands.Message(
                body.epoch(), decode(body.submissionId(), "submissionId"), decode(body.message(), "message"), Boolean.TRUE.equals(body.urgent()), Boolean.TRUE.equals(body.interaction())));
        return Map.of("ok", true, "duplicate", duplicate);
    }

    private static <T> List<T> list(List<T> value) {
        return value == null ? List.of() : value;
    }
}
