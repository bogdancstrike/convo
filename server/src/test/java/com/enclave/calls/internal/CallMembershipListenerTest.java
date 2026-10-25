package com.enclave.calls.internal;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

import com.enclave.groups.GroupMembersRemoved;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class CallMembershipListenerTest {
    private final CallRepository calls = mock(CallRepository.class);
    private final LiveKitRooms rooms = mock(LiveKitRooms.class);
    private final CallMembershipListener listener = new CallMembershipListener(calls, rooms,
            new CallsProperties(true, "/rtc", "convo", "x".repeat(32), Duration.ofMinutes(10), Duration.ofHours(12), 16, "http://livekit:7880", Duration.ofHours(24), Duration.ofDays(7), ""), Clock.systemUTC());

    @Test void onlyTheRemovedAccountsDevicesLeaveOngoingCalls() throws Exception {
        byte[] group = new byte[32];
        UUID removed = UUID.randomUUID(), stays = UUID.randomUUID();
        when(rooms.enabled()).thenReturn(true);
        when(calls.openGroupCalls(eq(group), any())).thenReturn(List.of(new CallRepository.CallRow(UUID.randomUUID(), "room-1", stays, null, group, false, Instant.now(), null)));
        when(rooms.participants("room-1")).thenReturn(List.of(removed + ":1", removed + ":2", stays + ":1", "not-an-account"));
        listener.on(new GroupMembersRemoved(group, Set.of(removed)));
        verify(rooms).remove("room-1", removed + ":1");
        verify(rooms).remove("room-1", removed + ":2");
        verify(rooms, times(2)).remove(anyString(), anyString());
    }

    @Test void nothingHappensWithoutRoomAdministration() throws Exception {
        when(rooms.enabled()).thenReturn(false);
        listener.on(new GroupMembersRemoved(new byte[32], Set.of(UUID.randomUUID())));
        verifyNoInteractions(calls);
    }
}
