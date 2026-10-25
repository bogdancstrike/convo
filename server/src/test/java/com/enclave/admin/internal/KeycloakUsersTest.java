package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.*;
import static org.springframework.test.web.client.response.MockRestResponseCreators.*;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class KeycloakUsersTest {
    private static final String BASE = "http://kc/auth/admin/realms/enclave";
    private final AdminProperties properties = new AdminProperties("convo-admin", new AdminProperties.Roles("h", "o", "s", "a", "platform", "compliance"), "", Duration.ofMinutes(15),
            Duration.ofMinutes(10), new AdminProperties.Activity(true, Duration.ofDays(90)),
            new AdminProperties.Idp(URI.create("http://kc/auth"), "enclave", "convo-admin-ops", "secret", Duration.ofSeconds(5)));
    private final RestClient.Builder builder = RestClient.builder();
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final KeycloakUsers users = new KeycloakUsers(properties, builder.build(), Clock.systemUTC());

    private void token() {
        server.expect(requestTo("http://kc/auth/realms/enclave/protocol/openid-connect/token")).andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{\"access_token\":\"t\",\"expires_in\":300}", MediaType.APPLICATION_JSON));
    }

    @Test void creatingAUserSetsATemporaryPasswordAndRequiredActions() {
        token();
        server.expect(requestTo(BASE + "/users")).andExpect(method(HttpMethod.POST))
                .andExpect(jsonPath("$.username").value("ana"))
                .andExpect(jsonPath("$.credentials[0].temporary").value(true))
                .andExpect(jsonPath("$.requiredActions[0]").value("UPDATE_PASSWORD"))
                .andExpect(jsonPath("$.requiredActions[1]").value("webauthn-register-passwordless"))
                .andExpect(jsonPath("$.attributes.phoneNumber[0]").value("+40700000001"))
                .andRespond(withStatus(HttpStatus.CREATED).headers(location(BASE + "/users/0f0e0d0c-0000-0000-0000-000000000001")));
        server.expect(requestTo(BASE + "/users/0f0e0d0c-0000-0000-0000-000000000001"))
                .andRespond(withSuccess("{\"id\":\"0f0e0d0c-0000-0000-0000-000000000001\",\"username\":\"ana\",\"enabled\":true}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(BASE + "/users/0f0e0d0c-0000-0000-0000-000000000001/credentials")).andRespond(withSuccess("[{\"type\":\"password\"}]", MediaType.APPLICATION_JSON));
        server.expect(requestTo(BASE + "/users/0f0e0d0c-0000-0000-0000-000000000001/role-mappings/realm"))
                .andRespond(withSuccess("[{\"name\":\"default-roles-enclave\"},{\"name\":\"convo-helpdesk\"}]", MediaType.APPLICATION_JSON));
        server.expect(requestTo(BASE + "/users/0f0e0d0c-0000-0000-0000-000000000001/sessions")).andRespond(withSuccess("[{\"lastAccess\":1000}]", MediaType.APPLICATION_JSON));
        var created = users.create(new KeycloakUsers.Draft("ana", "Ana", "Pop", "", "+40700000001", true));
        assertThat(created.temporaryPassword()).hasSizeGreaterThanOrEqualTo(20);
        assertThat(created.user().roles()).containsExactly("convo-helpdesk");
        assertThat(created.user().sessions()).isEqualTo(1);
        server.verify();
    }

    @Test void onlyAllowedActionsAndConvoRolesAreAccepted() {
        assertThatThrownBy(() -> users.requireActions("u", List.of("delete_account"))).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(() -> users.setRole("u", "realm-admin", true)).isInstanceOf(EnclaveException.class);
    }

    @Test void identityProviderErrorsAreMapped() {
        token();
        server.expect(requestTo(BASE + "/users")).andRespond(withStatus(HttpStatus.CONFLICT));
        assertThatThrownBy(() -> users.create(new KeycloakUsers.Draft("ana", "", "", "", "", false)))
                .isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.CONFLICT));
    }

    @Test void listsOnlineSessionsAndEndsOnlyTheSelectedSession() {
        token();
        server.expect(requestTo(BASE + "/users/person/sessions")).andRespond(withSuccess("[{\"id\":\"session-one\",\"userId\":\"person\",\"username\":\"ana\",\"start\":1000,\"lastAccess\":2000,\"clients\":{\"client-id\":\"enclave-web\"}}]", MediaType.APPLICATION_JSON));
        server.expect(requestTo(BASE + "/sessions/session-one")).andExpect(method(HttpMethod.DELETE)).andRespond(withNoContent());
        assertThat(users.sessions("person").getFirst().clients()).containsEntry("client-id", "enclave-web");
        users.endSession("session-one"); server.verify();
    }

    private static HttpHeaders location(String uri) {
        HttpHeaders h = new HttpHeaders();
        h.setLocation(URI.create(uri));
        return h;
    }
}
