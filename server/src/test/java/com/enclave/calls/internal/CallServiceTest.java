package com.enclave.calls.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.groups.GroupsApi;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.DeviceRoster;
import com.enclave.identity.IdentityApi;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.SignedJWT;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class CallServiceTest {
    private static final String SECRET = "0123456789abcdef0123456789abcdef-test";
    private final UUID alice = UUID.randomUUID(), bob = UUID.randomUUID(), eve = UUID.randomUUID();
    private final CallRepository repository = mock(CallRepository.class);
    private final IdentityApi identity = mock(IdentityApi.class);
    private final GroupsApi groups = mock(GroupsApi.class);
    private final Clock clock = Clock.fixed(Instant.parse("2026-10-21T10:00:00Z"), ZoneOffset.UTC);
    private final CallsProperties properties = new CallsProperties(true, "/rtc", "convo", SECRET, Duration.ofMinutes(10), Duration.ofHours(12), 16, "");
    private final CallService service = new CallService(repository, identity, groups, new LiveKitTokens(properties, clock), properties, clock, mock(org.springframework.context.ApplicationEventPublisher.class));
    private final AtomicReference<CallRepository.CallRow> stored = new AtomicReference<>();

    private AuthenticatedDevice device(UUID account) { return new AuthenticatedDevice(new DeviceAddress(account, 2), "web"); }

    private void storeCalls() {
        Mockito.doAnswer((i) -> { stored.set(i.getArgument(0)); return null; }).when(repository).insert(any());
        when(repository.find(any())).thenAnswer((i) -> Optional.ofNullable(stored.get()).filter((c) -> c.callId().equals(i.getArgument(0))));
    }

    @Test void directCallTokensAreScopedToOneRoomAndDevice() throws Exception {
        storeCalls();
        when(identity.activeRoster(bob)).thenReturn(Optional.of(mock(DeviceRoster.class)));
        var join = service.create(device(alice), bob, null, true);
        var jwt = SignedJWT.parse(join.token());
        assertThat(jwt.verify(new MACVerifier(SECRET.getBytes()))).isTrue();
        assertThat(jwt.getJWTClaimsSet().getIssuer()).isEqualTo("convo");
        assertThat(jwt.getJWTClaimsSet().getSubject()).isEqualTo(alice + ":2");
        assertThat(jwt.getJWTClaimsSet().getExpirationTime().toInstant()).isEqualTo(clock.instant().plus(Duration.ofMinutes(10)));
        @SuppressWarnings("unchecked") var video = (Map<String, Object>) jwt.getJWTClaimsSet().getClaim("video");
        assertThat(video).containsEntry("room", join.room()).containsEntry("roomJoin", true);
        assertThat(join.room()).hasSize(24);

        assertThat(SignedJWT.parse(service.join(device(bob), join.callId()).token()).getJWTClaimsSet().getSubject()).isEqualTo(bob + ":2");
        assertThatThrownBy(() -> service.join(device(eve), join.callId())).isInstanceOf(EnclaveException.class);
    }

    @Test void groupCallsFollowCurrentMembershipAndEndedCallsCannotBeJoined() {
        storeCalls();
        byte[] group = new byte[32];
        when(groups.members(group)).thenReturn(Optional.of(Set.of(alice, bob)));
        var join = service.create(device(alice), null, group, false);
        assertThat(service.join(device(bob), join.callId()).video()).isFalse();
        when(groups.members(group)).thenReturn(Optional.of(Set.of(alice)));
        assertThatThrownBy(() -> service.join(device(bob), join.callId())).isInstanceOf(EnclaveException.class);
        stored.set(new CallRepository.CallRow(join.callId(), join.room(), alice, null, group, false, clock.instant(), clock.instant()));
        assertThatThrownBy(() -> service.join(device(alice), join.callId())).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(() -> service.create(device(eve), null, group, false)).isInstanceOf(EnclaveException.class);
    }

    @Test void disabledOrWeakSecretRefusesCalls() {
        var weak = new CallsProperties(true, "/rtc", "convo", "short", Duration.ofMinutes(10), Duration.ofHours(12), 16, "");
        var disabled = new CallService(repository, identity, groups, new LiveKitTokens(weak, clock), weak, clock, mock(org.springframework.context.ApplicationEventPublisher.class));
        assertThatThrownBy(() -> disabled.create(device(alice), bob, null, false)).isInstanceOf(EnclaveException.class);
    }
}
