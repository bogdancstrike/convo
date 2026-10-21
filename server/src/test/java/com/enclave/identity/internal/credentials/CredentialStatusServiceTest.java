package com.enclave.identity.internal.credentials;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.enclave.identity.internal.account.AccountRepository;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.ExpectedCount;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class CredentialStatusServiceTest {
    private static final UUID ACCOUNT = UUID.randomUUID();
    private static final String TOKEN_URL = "http://kc/auth/realms/enclave/protocol/openid-connect/token";
    private static final String CREDENTIALS_URL = "http://kc/auth/admin/realms/enclave/users/sub-1/credentials";

    private final AccountRepository accounts = mock(AccountRepository.class);
    private final RestClient.Builder builder = RestClient.builder();
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();

    private CredentialStatusService service(boolean enabled) {
        when(accounts.findOidcSubject(ACCOUNT)).thenReturn(Optional.of("sub-1"));
        var properties = new CredentialStatusProperties(enabled, URI.create("http://kc/auth"), "enclave", "convo-credential-status", "secret",
                Duration.ofSeconds(1), Duration.ofSeconds(30));
        return new CredentialStatusService(properties, accounts, builder.build(), Clock.fixed(Instant.EPOCH, ZoneOffset.UTC));
    }

    @Test void reportsPasskeyAndOtpAndCachesTheAnswer() {
        var service = service(true);
        server.expect(ExpectedCount.once(), requestTo(TOKEN_URL)).andExpect(method(HttpMethod.POST))
                .andRespond(withSuccess("{\"access_token\":\"t\",\"expires_in\":300}", MediaType.APPLICATION_JSON));
        server.expect(ExpectedCount.once(), requestTo(CREDENTIALS_URL)).andExpect(header("Authorization", "Bearer t"))
                .andRespond(withSuccess("[{\"type\":\"password\"},{\"id\":\"c1\",\"type\":\"webauthn-passwordless\",\"userLabel\":\"Pixel\",\"createdDate\":1000},{\"type\":\"otp\"}]", MediaType.APPLICATION_JSON));
        assertThat(service.status(ACCOUNT)).isEqualTo(new CredentialStatusService.CredentialStatus("available", true, true,
                java.util.List.of(new CredentialStatusService.Passkey("c1", "Pixel", 1000))));
        assertThat(service.status(ACCOUNT).passkey()).isTrue();
        server.verify();
    }

    @Test void passwordOnlyMeansNoPasskey() {
        var service = service(true);
        server.expect(requestTo(TOKEN_URL)).andRespond(withSuccess("{\"access_token\":\"t\",\"expires_in\":300}", MediaType.APPLICATION_JSON));
        server.expect(requestTo(CREDENTIALS_URL)).andRespond(withSuccess("[{\"type\":\"password\"}]", MediaType.APPLICATION_JSON));
        assertThat(service.status(ACCOUNT)).isEqualTo(new CredentialStatusService.CredentialStatus("available", false, false, java.util.List.of()));
        // Not cached: a passkey registered a moment later is seen on the next request.
        server.verify(); server.reset();
        server.expect(requestTo(CREDENTIALS_URL)).andRespond(withSuccess("[{\"type\":\"webauthn-passwordless\"}]", MediaType.APPLICATION_JSON));
        assertThat(service.status(ACCOUNT).passkey()).isTrue();
    }

    @Test void outagesAndMissingConfigurationAreUnavailableNotFalse() {
        var service = service(true);
        server.expect(requestTo(TOKEN_URL)).andRespond(withServerError());
        assertThat(service.status(ACCOUNT).state()).isEqualTo("unavailable");
        assertThat(service(false).status(ACCOUNT).state()).isEqualTo("unavailable");
    }
}
