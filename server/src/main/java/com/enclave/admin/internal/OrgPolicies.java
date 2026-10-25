package com.enclave.admin.internal;

import com.enclave.admin.internal.AdminPermissions.Permission;
import com.enclave.contracts.DeploymentProperties;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.AuthenticatedDevice;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.ObjectMapper;

/**
 * Signed organization policy (specs §19.1, AC-ADM-02). Administrators publish a new version naming
 * the version they edited (a stale edit is refused with CONFLICT); each version is signed with the
 * server's Ed25519 policy key over {@code CONVO-POLICY-V1\n<deploymentId>\n<document>} and audited.
 * Devices fetch {@code GET /v1/policy}, verify the signature, pin the key on first use and enforce
 * the policy locally.
 *
 * <p>The signing key comes from {@code enclave.policy.signing-key} (base64 PKCS#8 Ed25519). When it
 * is not set, a key is generated once and stored in {@code policy_signing_key} (development).
 */
@RestController
class OrgPolicies {
    static final String CONTEXT = "CONVO-POLICY-V1";

    /** A published version: the exact signed text, its signature and the public key (base64 X.509). */
    record Signed(int version, String document, String signature, String publicKey, String keyId, Instant publishedAt, String publishedBy) {}
    record Publish(@Min(0) int expectedVersion, @Valid @NotNull OrgPolicy policy, @NotBlank @Size(max = 500) String reason) {}
    /** The current policy for the console: in-force values (defaults until something is published). */
    record Current(int version, OrgPolicy policy, Signed signed) {}

    private final JdbcClient jdbc;
    private final ObjectMapper json;
    private final AdminGuard guard;
    private final AuditLog audit;
    private final String deploymentId;
    private final KeyPair key;

    private final java.time.Clock clock;

    OrgPolicies(JdbcClient jdbc, ObjectMapper json, AdminGuard guard, AuditLog audit, DeploymentProperties deployment, java.time.Clock clock,
            @Value("${enclave.policy.signing-key:}") String configuredKey) {
        this.jdbc = jdbc; this.json = json; this.guard = guard; this.audit = audit; this.deploymentId = deployment.id(); this.clock = clock;
        this.key = loadKey(configuredKey);
    }

    /** Device-authenticated: the current signed policy, or 204 when none was published (defaults apply). */
    @GetMapping("/v1/policy")
    ResponseEntity<Signed> forDevice(@AuthenticationPrincipal AuthenticatedDevice device) {
        return latest().map(s -> ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(s)).orElseGet(() -> ResponseEntity.noContent().build());
    }

    @GetMapping("/v1/admin/policy")
    Current current(@AuthenticationPrincipal Jwt admin) {
        guard.require(admin, Permission.POLICY_READ);
        return latest().map(s -> new Current(s.version(), json.readValue(s.document(), Envelope.class).policy(), s))
                .orElseGet(() -> new Current(0, OrgPolicy.defaults(), null));
    }

    @PutMapping("/v1/admin/policy")
    @Transactional
    Signed publish(@AuthenticationPrincipal Jwt admin, @Valid @RequestBody Publish body) {
        guard.requireAudited(admin, Permission.POLICY_MANAGE, "policy.publish", "policy");
        guard.requireRecentSignIn(admin);
        // Serialize publishers so the version check and insert cannot interleave.
        jdbc.sql("SELECT pg_advisory_xact_lock(hashtext('org_policies'))").query(Object.class).optional();
        int current = jdbc.sql("SELECT coalesce(max(version), 0) FROM org_policies").query(Integer.class).single();
        if (current != body.expectedVersion()) throw new EnclaveException(ErrorCode.CONFLICT, "the policy changed since you opened it (now version " + current + ")");
        int version = current + 1;
        Instant at = clock.instant();
        String document = json.writeValueAsString(new Envelope(version, deploymentId, at.toString(), body.policy()));
        byte[] signature = sign(document);
        String actor = guard.actor(admin);
        jdbc.sql("INSERT INTO org_policies (version, document, signature, key_id, created_by) VALUES (:v, :d, :s, :k, :b)")
                .param("v", version).param("d", document).param("s", signature).param("k", keyId()).param("b", actor).update();
        audit.append(actor, "policy.publish", "policy:v" + version, body.reason());
        return new Signed(version, document, Base64.getEncoder().encodeToString(signature), publicKey(), keyId(), at, actor);
    }

    /** The signed text: the policy plus what binds it to this deployment and version. */
    record Envelope(int version, String deploymentId, String issuedAt, OrgPolicy policy) {}

    Optional<Signed> latest() {
        return jdbc.sql("SELECT version, document, signature, key_id, created_by, created_at FROM org_policies ORDER BY version DESC LIMIT 1")
                .query((rs, n) -> new Signed(rs.getInt("version"), rs.getString("document"), Base64.getEncoder().encodeToString(rs.getBytes("signature")),
                        publicKey(), rs.getString("key_id"), rs.getTimestamp("created_at").toInstant(), rs.getString("created_by"))).optional();
    }

    byte[] sign(String document) {
        try {
            Signature signer = Signature.getInstance("Ed25519");
            signer.initSign(key.getPrivate());
            signer.update((CONTEXT + "\n" + deploymentId + "\n" + document).getBytes(StandardCharsets.UTF_8));
            return signer.sign();
        } catch (GeneralSecurityException e) { throw new IllegalStateException("policy signing failed", e); }
    }

    String publicKey() { return Base64.getEncoder().encodeToString(key.getPublic().getEncoded()); }

    /** First 16 hex characters of SHA-256 over the public key, shown to admins and devices. */
    String keyId() {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(key.getPublic().getEncoded())).substring(0, 16); }
        catch (GeneralSecurityException e) { throw new IllegalStateException(e); }
    }

    private KeyPair loadKey(String configured) {
        try {
            KeyFactory factory = KeyFactory.getInstance("Ed25519");
            byte[] pkcs8 = !configured.isBlank() ? Base64.getDecoder().decode(configured.strip())
                    : jdbc.sql("SELECT private_key FROM policy_signing_key WHERE id = 1").query(byte[].class).optional().orElse(null);
            if (pkcs8 == null) {
                KeyPair generated = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
                pkcs8 = generated.getPrivate().getEncoded();
                jdbc.sql("INSERT INTO policy_signing_key (id, private_key) VALUES (1, :k) ON CONFLICT (id) DO NOTHING").param("k", pkcs8).update();
                pkcs8 = jdbc.sql("SELECT private_key FROM policy_signing_key WHERE id = 1").query(byte[].class).single(); // another replica may have won
            }
            PrivateKey priv = factory.generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
            KeyPair pair = new KeyPair(publicOf(pkcs8), priv);
            // Self-check: the derived public key must verify a signature by the private key.
            Signature probe = Signature.getInstance("Ed25519");
            probe.initSign(priv); probe.update(CONTEXT.getBytes(StandardCharsets.UTF_8));
            byte[] signed = probe.sign();
            probe.initVerify(pair.getPublic()); probe.update(CONTEXT.getBytes(StandardCharsets.UTF_8));
            if (!probe.verify(signed)) throw new GeneralSecurityException("policy key pair does not match");
            return pair;
        } catch (GeneralSecurityException e) { throw new IllegalStateException("invalid enclave.policy.signing-key", e); }
    }

    /**
     * The public key of an Ed25519 PKCS#8 key (RFC 8410: the 32-byte seed ends the structure). The JDK
     * has no direct derivation, so its generator is fed that seed; {@link #loadKey} verifies the result.
     */
    private static PublicKey publicOf(byte[] pkcs8) throws GeneralSecurityException {
        byte[] seed = java.util.Arrays.copyOfRange(pkcs8, pkcs8.length - 32, pkcs8.length);
        KeyPairGenerator generator = KeyPairGenerator.getInstance("Ed25519");
        generator.initialize(255, new FixedSeed(seed));
        return generator.generateKeyPair().getPublic();
    }

    /** SecureRandom that returns a fixed seed, used only to re-derive the public key above. */
    private static final class FixedSeed extends java.security.SecureRandom {
        private final byte[] seed;
        FixedSeed(byte[] seed) { this.seed = seed.clone(); }
        @Override public void nextBytes(byte[] bytes) { System.arraycopy(seed, 0, bytes, 0, Math.min(seed.length, bytes.length)); }
    }
}
