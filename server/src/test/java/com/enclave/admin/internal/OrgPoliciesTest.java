package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.enclave.contracts.DeploymentProperties;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.time.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.oauth2.jwt.Jwt;
import tools.jackson.databind.json.JsonMapper;

class OrgPoliciesTest {
    private final Instant now = Instant.parse("2026-10-25T12:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);
    private final AdminProperties props = new AdminProperties("convo-admin", new AdminProperties.Roles("help", "org", "security", "auditor", "platform", "compliance"), "", Duration.ofMinutes(15), Duration.ofMinutes(10),
            new AdminProperties.Activity(true, Duration.ofDays(90)), new AdminProperties.Idp(URI.create("http://idp/auth"), "enclave", "ops", "secret", Duration.ofSeconds(5)));
    private final AuditLog audit = mock(AuditLog.class);
    private final JdbcClient jdbc = mock(JdbcClient.class, RETURNS_DEEP_STUBS);
    private final DeploymentProperties deployment = mock(DeploymentProperties.class);

    private OrgPolicies policies() throws Exception {
        when(deployment.id()).thenReturn("acme");
        String key = Base64.getEncoder().encodeToString(KeyPairGenerator.getInstance("Ed25519").generateKeyPair().getPrivate().getEncoded());
        return new OrgPolicies(jdbc, JsonMapper.builder().build(), new AdminGuard(new AdminPermissions(props), audit, props, clock), audit, deployment, clock, key);
    }

    private Jwt token(String role) {
        return Jwt.withTokenValue("t").header("alg", "RS256").subject("op").claim("preferred_username", "ana")
                .claim("auth_time", now.getEpochSecond()).claim("realm_access", Map.of("roles", List.of(role))).build();
    }

    private static OrgPolicy strict() {
        return new OrgPolicy(new OrgPolicy.Notifications("generic"), new OrgPolicy.Security(true, true, 5), new OrgPolicy.Privacy(false, false), new OrgPolicy.Features(false, true, true, true));
    }

    @Test void publishesASignedVersionBoundToTheDeploymentThatVerifiesWithThePublishedKey() throws Exception {
        var policies = policies();
        when(jdbc.sql(startsWith("SELECT coalesce")).query(Integer.class).single()).thenReturn(3);
        var signed = policies.publish(token("security"), new OrgPolicies.Publish(3, strict(), "tighten previews"));
        assertThat(signed.version()).isEqualTo(4);
        assertThat(signed.document()).contains("\"deploymentId\":\"acme\"").contains("\"maxPreview\":\"generic\"").contains("\"version\":4");
        var verifier = Signature.getInstance("Ed25519");
        verifier.initVerify(KeyFactory.getInstance("Ed25519").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(signed.publicKey()))));
        verifier.update(("CONVO-POLICY-V1\nacme\n" + signed.document()).getBytes(StandardCharsets.UTF_8));
        assertThat(verifier.verify(Base64.getDecoder().decode(signed.signature()))).isTrue();
        // Tampering with the document breaks the signature.
        verifier.update(("CONVO-POLICY-V1\nacme\n" + signed.document().replace("generic", "full")).getBytes(StandardCharsets.UTF_8));
        assertThat(verifier.verify(Base64.getDecoder().decode(signed.signature()))).isFalse();
        verify(audit).append("op (ana)", "policy.publish", "policy:v4", "tighten previews");
    }

    @Test void aStaleEditIsRefused() throws Exception {
        var policies = policies();
        when(jdbc.sql(startsWith("SELECT coalesce")).query(Integer.class).single()).thenReturn(5);
        assertThatThrownBy(() -> policies.publish(token("security"), new OrgPolicies.Publish(4, strict(), "r")))
                .isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(ErrorCode.CONFLICT));
        verify(audit, never()).append(any(), eq("policy.publish"), any(), any());
    }

    @Test void readOnlyRolesCannotPublishAndTheirAttemptIsAudited() throws Exception {
        var policies = policies();
        assertThatThrownBy(() -> policies.publish(token("auditor"), new OrgPolicies.Publish(0, strict(), "r"))).isInstanceOf(EnclaveException.class);
        verify(audit).append("op (ana)", "denied:policy.publish", "policy", "role lacks POLICY_MANAGE");
    }
}
