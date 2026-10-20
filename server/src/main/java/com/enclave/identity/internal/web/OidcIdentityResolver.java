package com.enclave.identity.internal.web;

import com.enclave.identity.internal.IdentityProperties;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.internal.account.OidcIdentity;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

/** Extracts an {@link OidcIdentity} from a validated Keycloak access token. */
@Component
class OidcIdentityResolver {

    private final IdentityProperties properties;

    OidcIdentityResolver(IdentityProperties properties) {
        this.properties = properties;
    }

    OidcIdentity resolve(Jwt jwt) {
        if (jwt.getSubject() == null || jwt.getSubject().isBlank()) {
            throw new EnclaveException(ErrorCode.UNAUTHENTICATED, "account subject required");
        }
        String issuer = jwt.getIssuer() == null ? jwt.getClaimAsString("iss") : jwt.getIssuer().toString();
        return new OidcIdentity(issuer, jwt.getSubject(), jwt.getClaimAsString(properties.usernameClaim()),
                jwt.getClaimAsString(properties.displayNameClaim()), jwt.getClaimAsString(properties.phoneClaim()));
    }
}
