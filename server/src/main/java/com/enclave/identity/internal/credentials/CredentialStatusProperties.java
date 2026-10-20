package com.enclave.identity.internal.credentials;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.net.URI;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Read-only lookup of which sign-in credentials an account registered at the identity provider
 * ({@code enclave.identity.credential-status.*}). Clients use it only to decide whether to offer
 * native app/chat locks; the IdP stays the owner of passkey enrollment.
 *
 * <p>The client must be a confidential Keycloak client whose service account holds only
 * {@code realm-management/view-users}. Its secret belongs in the environment, never in Git or an APK.
 *
 * @param enabled whether the lookup is configured; disabled reports {@code unavailable}
 * @param adminUrl Keycloak base URL reachable from the server (e.g. {@code http://keycloak:8080/auth})
 * @param realm realm holding the accounts
 * @param clientId service-account client ID
 * @param clientSecret service-account secret
 * @param timeout connect/read timeout for each IdP call
 * @param cacheTtl how long one account's answer is reused (bounds IdP load)
 */
@Validated
@ConfigurationProperties("enclave.identity.credential-status")
public record CredentialStatusProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue("http://localhost:8080/auth") @NotNull URI adminUrl,
        @DefaultValue("enclave") @NotBlank String realm,
        @DefaultValue("convo-credential-status") @NotBlank String clientId,
        @DefaultValue("") String clientSecret,
        @DefaultValue("5s") @NotNull Duration timeout,
        @DefaultValue("30s") @NotNull Duration cacheTtl) {}
