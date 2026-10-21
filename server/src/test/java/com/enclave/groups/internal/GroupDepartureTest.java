package com.enclave.groups.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.IdentityApi;
import com.enclave.messaging.DeliveryApi;
import com.enclave.messaging.GroupEnvelope;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class GroupDepartureTest {
    private final GroupRepository groups = mock(GroupRepository.class);
    private final DeliveryApi delivery = mock(DeliveryApi.class);
    private final byte[] id = new byte[32];
    private final DeviceAddress owner = new DeviceAddress(UUID.randomUUID(), 1);
    private final DeviceAddress member = new DeviceAddress(UUID.randomUUID(), 1);
    private final DeviceAddress leaver = new DeviceAddress(UUID.randomUUID(), 1);
    private final org.springframework.context.ApplicationEventPublisher events = mock(org.springframework.context.ApplicationEventPublisher.class);
    private final GroupService service = new GroupService(groups, mock(IdentityApi.class), delivery,
            new GroupsProperties(1000, 5000, 262144, 1048576, Duration.ofDays(31), Duration.ofDays(7), 200), Clock.systemUTC(), events);

    private void group(Map<UUID, Role> members, Set<UUID> departed) {
        var row = new GroupRepository.GroupRow(id, 4, 1, "active", false);
        when(groups.lock(eq(id), anyBoolean())).thenReturn(Optional.of(row));
        when(groups.hasDevice(eq(id), any())).thenReturn(true);
        when(groups.members(id)).thenReturn(members);
        when(groups.departures(id)).thenReturn(departed);
        when(groups.devices(id)).thenReturn(List.of(owner, member, leaver));
        when(groups.eventBySubmission(any(), any())).thenReturn(Optional.empty());
    }

    @Test void leavingStopsFanOutAndLetsAnyMemberCompleteTheRemoval() {
        group(Map.of(owner.accountId(), Role.OWNER, member.accountId(), Role.MEMBER, leaver.accountId(), Role.MEMBER), Set.of());
        service.leave(leaver, id);
        verify(groups).deleteMember(id, leaver.accountId());
        verify(groups).addDeparture(id, leaver.accountId());
        // Leaving revokes what membership granted elsewhere (e.g. an ongoing group call).
        verify(events).publishEvent(argThat((Object e) -> e instanceof com.enclave.groups.GroupMembersRemoved r && r.accounts().equals(Set.of(leaver.accountId()))));

        group(Map.of(owner.accountId(), Role.OWNER, member.accountId(), Role.MEMBER), Set.of(leaver.accountId()));
        service.message(owner, id, new GroupCommands.Message(4, new byte[16], new byte[]{1}));
        @SuppressWarnings("unchecked") ArgumentCaptor<List<DeviceAddress>> to = ArgumentCaptor.forClass(List.class);
        verify(delivery).deliverGroup(to.capture(), any(GroupEnvelope.class));
        assertThat(to.getValue()).containsExactly(member);

        // A plain member may remove a departed member's leaves (but nobody else's).
        var removal = new GroupCommands.Commit(4, new byte[16], new byte[]{9}, null, List.of(), List.of(leaver.accountId()), List.of(), List.of(leaver), Map.of());
        assertThat(service.commit(member, id, removal).duplicate()).isFalse();
        verify(groups).deleteDeparture(id, leaver.accountId());
        verify(events, times(2)).publishEvent(any(com.enclave.groups.GroupMembersRemoved.class));
        var other = new GroupCommands.Commit(5, new byte[16], new byte[]{9}, null, List.of(), List.of(owner.accountId()), List.of(), List.of(owner), Map.of());
        group(Map.of(owner.accountId(), Role.OWNER, member.accountId(), Role.MEMBER), Set.of());
        when(groups.lock(eq(id), anyBoolean())).thenReturn(Optional.of(new GroupRepository.GroupRow(id, 5, 2, "active", false)));
        assertThatThrownBy(() -> service.commit(member, id, other)).isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.FORBIDDEN_ROLE));
    }

    @Test void bannedAccountsCannotBeAddedUntilUnbanned() {
        group(Map.of(owner.accountId(), Role.OWNER, member.accountId(), Role.MEMBER), Set.of());
        when(groups.bans(id)).thenReturn(Set.of(leaver.accountId()));
        var add = new GroupCommands.Commit(4, new byte[16], new byte[]{9}, null, List.of(leaver.accountId()), List.of(), List.of(), List.of(), Map.of());
        assertThatThrownBy(() -> service.commit(owner, id, add)).isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.FORBIDDEN));
        assertThatThrownBy(() -> service.ban(member, id, leaver.accountId(), true)).isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.FORBIDDEN_ROLE));
        service.ban(owner, id, leaver.accountId(), false);
        verify(groups).unban(id, leaver.accountId());
    }

    @Test void theLastOwnerMustHandOverFirst() {
        group(Map.of(owner.accountId(), Role.OWNER, member.accountId(), Role.MEMBER), Set.of());
        assertThatThrownBy(() -> service.leave(owner, id)).isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.FORBIDDEN_ROLE));
        verify(groups, never()).addDeparture(any(), any());
    }
}
