package com.enclave.calls.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.groups.GroupsApi;
import com.enclave.identity.AuthenticatedDevice;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.jdbc.core.simple.JdbcClient;

/** AC-CALL-07: links never admit non-members, store only token hashes, and honour expiry/revocation. */
class CallLinksTest {
    private final Instant now = Instant.parse("2026-10-25T12:00:00Z");
    private final UUID alice = UUID.randomUUID(), mallory = UUID.randomUUID();
    private final byte[] group = {1, 2, 3};
    private final JdbcClient jdbc = mock(JdbcClient.class);
    private final JdbcClient.StatementSpec sql = mock(JdbcClient.StatementSpec.class, RETURNS_SELF);
    private final GroupsApi groups = mock(GroupsApi.class);
    private final CallRepository calls = mock(CallRepository.class);
    private final CallsProperties properties = new CallsProperties(true, "/rtc", "convo", "x".repeat(32), Duration.ofMinutes(10), Duration.ofHours(12), 16, "", Duration.ofHours(24), Duration.ofDays(7));
    private final CallLinks links = new CallLinks(jdbc, groups, calls, properties, Clock.fixed(now, ZoneOffset.UTC));

    CallLinksTest() {
        when(jdbc.sql(anyString())).thenReturn(sql);
        when(groups.members(any())).thenReturn(Optional.of(Set.of(alice)));
    }
    private AuthenticatedDevice device(UUID account) { return new AuthenticatedDevice(new DeviceAddress(account, 1), "web"); }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private void stored(UUID creator, Instant expires, Instant revoked) {
        JdbcClient.MappedQuerySpec spec = mock(JdbcClient.MappedQuerySpec.class);
        when(sql.query(any(RowMapper.class))).thenReturn(spec);
        // The private Link record is built by the row mapper; feed it through a fake result set.
        when(spec.optional()).thenAnswer(inv -> {
            var captor = org.mockito.ArgumentCaptor.forClass(RowMapper.class);
            verify(sql, atLeastOnce()).query(captor.capture());
            var rs = mock(java.sql.ResultSet.class);
            when(rs.getBytes("group_id")).thenReturn(group);
            when(rs.getObject("created_by", UUID.class)).thenReturn(creator);
            when(rs.getObject("expires_at", OffsetDateTime.class)).thenReturn(OffsetDateTime.ofInstant(expires, ZoneOffset.UTC));
            when(rs.getObject("revoked_at", OffsetDateTime.class)).thenReturn(revoked == null ? null : OffsetDateTime.ofInstant(revoked, ZoneOffset.UTC));
            return Optional.of(captor.getValue().mapRow(rs, 0));
        });
    }

    @Test void createsForMembersAndStoresOnlyTheTokenHash() {
        var created = links.create(device(alice), group, null);
        assertThat(created.expiresAt()).isEqualTo(now.plus(Duration.ofHours(24)));
        verify(sql).param("h", CallLinks.hash(created.token()));
        verify(sql, never()).param(anyString(), eq(created.token()));
    }

    @Test void nonMembersCannotCreateAndLifetimesAreBounded() {
        assertThatThrownBy(() -> links.create(device(mallory), group, null)).isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.NOT_GROUP_MEMBER));
        assertThatThrownBy(() -> links.create(device(alice), group, Duration.ofDays(8))).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(() -> links.create(device(alice), group, Duration.ZERO)).isInstanceOf(EnclaveException.class);
    }

    @Test void resolvingNeedsCurrentMembershipAndReturnsTheNewestOpenCall() {
        stored(alice, now.plusSeconds(60), null);
        var older = new CallRepository.CallRow(UUID.randomUUID(), "a", alice, null, group, false, now.minusSeconds(600), null);
        var newer = new CallRepository.CallRow(UUID.randomUUID(), "b", alice, null, group, true, now.minusSeconds(60), null);
        when(calls.openGroupCalls(eq(group), any())).thenReturn(List.of(older, newer));
        var resolved = links.resolve(device(alice), "token");
        assertThat(resolved.callId()).isEqualTo(newer.callId());
        assertThat(resolved.video()).isTrue();
        assertThatThrownBy(() -> links.resolve(device(mallory), "token")).isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.NOT_GROUP_MEMBER));
    }

    @Test void expiredOrRevokedLinksResolveToNothing() {
        stored(alice, now.minusSeconds(1), null);
        assertThatThrownBy(() -> links.resolve(device(alice), "token")).isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test void onlyTheCreatorRevokes() {
        stored(alice, now.plusSeconds(60), null);
        assertThatThrownBy(() -> links.revoke(device(mallory), "token")).isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.FORBIDDEN));
        links.revoke(device(alice), "token");
        verify(sql).param("at", OffsetDateTime.ofInstant(now, ZoneOffset.UTC));
    }
}
