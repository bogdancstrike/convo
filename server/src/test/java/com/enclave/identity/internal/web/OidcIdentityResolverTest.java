package com.enclave.identity.internal.web;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.internal.IdentityProperties;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.jwt.Jwt;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class OidcIdentityResolverTest {
    @Test void rejectsSignedTokensWithoutAnAccountSubjectBeforeProvisioning() {
        var properties = mock(IdentityProperties.class);
        var resolver = new OidcIdentityResolver(properties);
        var token = Jwt.withTokenValue("test").header("alg", "RS256")
                .claim("iss", "https://convo.example/auth/realms/enclave").claim("preferred_username", "alice").build();
        assertThatThrownBy(() -> resolver.resolve(token)).isInstanceOfSatisfying(EnclaveException.class,
                e -> assertThat(e.code()).isEqualTo(ErrorCode.UNAUTHENTICATED));
        verifyNoInteractions(properties);
    }
}
