package com.enclave.groups.internal;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.IdentityApi;
import com.enclave.messaging.DeliveryApi;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class ChannelPermissionsTest {
    @Test void channelRejectsMemberButAllowsAdminAndOwner() {
        var groups = mock(GroupRepository.class);
        var delivery = mock(DeliveryApi.class);
        var id = new byte[32];
        var caller = new DeviceAddress(UUID.randomUUID(), 1);
        when(groups.lock(id, true)).thenReturn(Optional.of(new GroupRepository.GroupRow(id, 1, 1, "active", true)));
        when(groups.hasDevice(id, caller)).thenReturn(true);
        when(groups.devices(id)).thenReturn(List.of(caller));
        var service = new GroupService(groups, mock(IdentityApi.class), delivery,
                new GroupsProperties(1000, 5000, 262144, 1048576, Duration.ofDays(31), Duration.ofDays(7), 200), Clock.systemUTC(), mock(org.springframework.context.ApplicationEventPublisher.class));
        var command = new GroupCommands.Message(1, new byte[16], new byte[]{1,2,3});
        when(groups.members(id)).thenReturn(Map.of(caller.accountId(), Role.MEMBER));
        assertThatThrownBy(() -> service.message(caller, id, command)).isInstanceOfSatisfying(EnclaveException.class,
                e -> assertThat(e.code()).isEqualTo(ErrorCode.FORBIDDEN_ROLE));
        verifyNoInteractions(delivery);
        for (Role role : List.of(Role.ADMIN, Role.OWNER)) {
            when(groups.members(id)).thenReturn(Map.of(caller.accountId(), role));
            assertThat(service.message(caller, id, command)).isFalse();
        }
    }
}
