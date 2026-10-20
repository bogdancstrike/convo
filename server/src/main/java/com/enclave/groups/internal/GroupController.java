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

    GroupController(GroupService groups) {
        this.groups = groups;
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
    record CreateRequest(String groupId, long epoch, List<UUID> members, List<DeviceDto> devices, String welcome) {}

    /** {@code POST /v1/groups/{gid}/commits} request. */
    record CommitRequest(long epoch, String submissionId, String commit, String welcome, List<UUID> addMembers,
            List<UUID> removeMembers, List<DeviceDto> addDevices, List<DeviceDto> removeDevices, Map<UUID, String> roleChanges) {}

    /** {@code PUT /v1/groups/{gid}/messages} request. */
    record MessageRequest(long epoch, String submissionId, String message) {}

    /** Member entry. */
    record MemberDto(UUID accountId, String role) {}

    /** Group view. */
    record GroupDto(String groupId, long epoch, List<MemberDto> members, List<DeviceDto> devices) {
        static GroupDto of(GroupService.GroupView v) {
            return new GroupDto(encode(v.groupId()), v.epoch(),
                    v.members().entrySet().stream().map(e -> new MemberDto(e.getKey(), e.getValue().db())).toList(),
                    v.devices().stream().map(DeviceDto::of).toList());
        }
    }

    /** Group summary. */
    record GroupSummaryDto(String groupId, long epoch, String role, long members) {}

    /** Commit acceptance. */
    record AcceptedDto(long epoch, long seq, boolean duplicate) {}

    @PostMapping("/v1/groups")
    @ResponseStatus(HttpStatus.CREATED)
    GroupDto create(@AuthenticationPrincipal AuthenticatedDevice me, @RequestBody CreateRequest body) {
        return GroupDto.of(groups.create(me.address(), new GroupCommands.Create(
                decode(body.groupId(), "groupId"), body.epoch(), list(body.members()),
                list(body.devices()).stream().map(DeviceDto::toAddress).toList(),
                body.welcome() == null ? null : decode(body.welcome(), "welcome"))));
    }

    @GetMapping("/v1/groups/mine")
    List<GroupSummaryDto> mine(@AuthenticationPrincipal AuthenticatedDevice me) {
        return groups.mine(me.accountId()).stream().map(row -> new GroupSummaryDto(
                encode((byte[]) row.get("group_id")), ((Number) row.get("epoch")).longValue(),
                (String) row.get("role"), ((Number) row.get("members")).longValue())).toList();
    }

    @GetMapping("/v1/groups/{groupId}")
    GroupDto get(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId) {
        return GroupDto.of(groups.get(me.address(), decode(groupId, "groupId")));
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

    @PutMapping("/v1/groups/{groupId}/messages")
    Map<String, Object> message(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String groupId,
            @RequestBody MessageRequest body) {
        boolean duplicate = groups.message(me.address(), decode(groupId, "groupId"), new GroupCommands.Message(
                body.epoch(), decode(body.submissionId(), "submissionId"), decode(body.message(), "message")));
        return Map.of("ok", true, "duplicate", duplicate);
    }

    private static <T> List<T> list(List<T> value) {
        return value == null ? List.of() : value;
    }
}
