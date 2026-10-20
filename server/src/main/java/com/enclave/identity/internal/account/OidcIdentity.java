package com.enclave.identity.internal.account;

/**
 * Verified account-authentication identity extracted from a Keycloak access token.
 *
 * @param issuer token issuer ({@code iss})
 * @param subject token subject ({@code sub}); never assumed to be a UUID
 * @param preferredUsername value of the configured username claim, may be {@code null}
 * @param displayName organization display name claim, may be {@code null}
 * @param phone organization phone claim, may be {@code null}
 */
public record OidcIdentity(String issuer, String subject, String preferredUsername, String displayName, String phone) {}
