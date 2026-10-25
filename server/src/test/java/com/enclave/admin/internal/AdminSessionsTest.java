package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.time.*;
import java.net.URI;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;

class AdminSessionsTest {
    private final Instant now=Instant.parse("2026-10-24T12:00:00Z");
    private final Clock clock=Clock.fixed(now,ZoneOffset.UTC);
    private final AdminProperties props=new AdminProperties("convo-admin",new AdminProperties.Roles("help","org","security","auditor", "platform", "compliance"),"",Duration.ofMinutes(15),Duration.ofMinutes(10),new AdminProperties.Activity(true,Duration.ofDays(90)),new AdminProperties.Idp(URI.create("http://idp/auth"),"enclave","ops","secret",Duration.ofSeconds(5)));
    private final KeycloakUsers idp=mock(KeycloakUsers.class);
    private final SessionObservations observations=mock(SessionObservations.class);
    private final AuditLog audit=mock(AuditLog.class);
    private final AdminGuard guard=new AdminGuard(new AdminPermissions(props),audit,props,clock);
    private final AdminSessionsController controller=new AdminSessionsController(idp,observations,guard,audit);
    private Jwt token(String role, Instant at) { return Jwt.withTokenValue("t").header("alg","RS256").subject("operator").claim("sid","current").claim("preferred_username","ana").claim("auth_time",at.getEpochSecond()).claim("realm_access",Map.of("roles",List.of(role))).build(); }
    @Test void singleLogoutVerifiesOwnershipAndAuditsWithoutLeakingSessionIdentifier() {
        when(idp.sessions("person")).thenReturn(List.of(new KeycloakUsers.SessionRep("one","person","bob","127.0.0.1",1000L,2000L,Map.of()),new KeycloakUsers.SessionRep("two","person","bob",null,1000L,2000L,Map.of())));
        controller.end(token("help",now),"person","one",new AdminConsoleController.Reason("lost laptop"));
        verify(idp).endSession("one"); verify(idp,never()).endSession("two");
        verify(audit).append("operator (ana)","session.end","idp:person","lost laptop");
        assertThatThrownBy(()->controller.end(token("help",now),"person","another-users-session",new AdminConsoleController.Reason("test"))).isInstanceOfSatisfying(EnclaveException.class,e->assertThat(e.code()).isEqualTo(ErrorCode.NOT_FOUND));
        verify(idp,never()).endSession("another-users-session");
    }
    @Test void staleAndReadOnlyOperatorsCannotEndSessions() {
        assertThatThrownBy(()->controller.end(token("help",now.minusSeconds(601)),"person","one",new AdminConsoleController.Reason("test"))).isInstanceOfSatisfying(EnclaveException.class,e->assertThat(e.code()).isEqualTo(ErrorCode.STEP_UP_REQUIRED));
        assertThatThrownBy(()->controller.sessions(token("auditor",now),Map.of("user","person"))).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(()->controller.end(token("auditor",now),"person","one",new AdminConsoleController.Reason("test"))).isInstanceOf(EnclaveException.class);
        verifyNoInteractions(idp);
    }
    @Test void sessionTablesFilterAndSortBeforePaginationAndNeverInventBrowserMetadata() {
        when(observations.of("person")).thenReturn(List.of(new SessionObservations.Observation("one","person","Firefox","Linux",now)));
        when(idp.sessions("person")).thenReturn(List.of(new KeycloakUsers.SessionRep("one","person","bob","10.0.0.1",1000L,2000L,Map.of("client","enclave-web")),new KeycloakUsers.SessionRep("two","person","bob",null,1000L,3000L,Map.of())));
        var page=controller.sessions(token("help",now),Map.of("user","person","q","Firefox","size","1")).getBody();
        assertThat(page.total()).isEqualTo(1); assertThat(page.rows().getFirst().browser()).isEqualTo("Firefox");
        assertThat(controller.sessions(token("help",now),Map.of("user","person","q","Not observed")).getBody().rows().getFirst().id()).isEqualTo("two");
    }
    @Test void userAgentsAreReducedToCoarseFamilies() {
        assertThat(SessionObservations.family("Mozilla Firefox/128 Linux")).containsExactly("Firefox","Linux");
        assertThat(SessionObservations.family("Mozilla Android Chrome/120 Edg/120")).containsExactly("Edge","Android");
        assertThat(SessionObservations.family(null)).containsExactly("Not observed","Not observed");
    }
}
