package com.enclave.transparency.internal;

import com.enclave.contracts.DeploymentProperties;
import com.enclave.contracts.Ed25519Keys;
import com.enclave.identity.IdentityApi;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Arrays;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The key-transparency log: appends one leaf per change of an account's identity key or device
 * list, signs a new tree head on every append (so clients never see a roster the log does not yet
 * cover), serves proofs, and stores witness co-signatures after checking them.
 *
 * <p>Appends are serialized with a transaction-scoped advisory lock; leaf indexes are dense. The
 * tree is recomputed from the stored leaf hashes, which is cheap at directory scale (one 32-byte
 * hash per device change).
 */
@Service
class TransparencyLog {
    /** Advisory lock key ("KTLOG") that serializes appends across replicas. */
    private static final long APPEND_LOCK = 0x4b544c4f47L;

    record Head(long size, byte[] root, Instant signedAt, byte[] signature) {}
    record Leaf(long index, UUID accountId, byte[] identityKey, long deviceListVersion, byte[] deviceHash) {}
    record Cosignature(String witnessId, byte[] publicKey, Instant cosignedAt, byte[] signature) {}
    record Witnessed(Head head, List<Cosignature> cosignatures) {}

    private final JdbcClient jdbc;
    private final IdentityApi identity;
    private final Clock clock;
    private final String deploymentId;
    private final KeyPair key;
    private final Map<String, byte[]> witnesses = new HashMap<>();

    TransparencyLog(JdbcClient jdbc, IdentityApi identity, Clock clock, DeploymentProperties deployment, KeyTransparencyProperties properties) {
        this.jdbc = jdbc; this.identity = identity; this.clock = clock; this.deploymentId = deployment.id();
        this.key = loadKey(properties.signingKey());
        for (String entry : properties.witnesses()) {
            int colon = entry.indexOf(':');
            if (colon <= 0) throw new IllegalStateException("enclave.kt.witnesses entries are id:base64-public-key");
            byte[] publicKey = Base64.getDecoder().decode(entry.substring(colon + 1).strip());
            if (publicKey.length != 32) throw new IllegalStateException("witness key must be a raw 32-byte Ed25519 key: " + entry.substring(0, colon));
            witnesses.put(entry.substring(0, colon).strip(), publicKey);
        }
    }

    String deploymentId() { return deploymentId; }
    byte[] logKey() { return Ed25519Keys.raw(key.getPublic()); }
    Map<String, byte[]> witnesses() { return Map.copyOf(witnesses); }

    /**
     * Appends a leaf for each account whose current key state differs from its newest leaf, then
     * signs one new head. Runs inside the caller's transaction (device changes), so the log and the
     * roster commit together.
     */
    @Transactional
    void record(List<UUID> accounts) {
        jdbc.sql("SELECT pg_advisory_xact_lock(:k)").param("k", APPEND_LOCK).query(Object.class).single();
        long size = size();
        long next = size;
        for (UUID accountId : accounts) {
            var state = identity.keyState(accountId);
            if (state.isEmpty()) continue;
            byte[] ik = state.get().identityKey();
            byte[] devices = KtEncoding.deviceHash(state.get().roster());
            long version = state.get().roster().deviceListVersion();
            Optional<Leaf> latest = latestLeaf(accountId, Long.MAX_VALUE);
            if (latest.isPresent() && Arrays.equals(latest.get().identityKey(), ik) && Arrays.equals(latest.get().deviceHash(), devices)
                    && latest.get().deviceListVersion() == version) continue;
            byte[] leafHash = MerkleTree.leafHash(KtEncoding.leaf(accountId, version, ik, devices));
            jdbc.sql("INSERT INTO kt_leaves (idx, account_id, identity_key, device_list_version, device_hash, leaf_hash) VALUES (:i, :a, :ik, :v, :d, :h)")
                    .param("i", next++).param("a", accountId).param("ik", ik).param("v", version).param("d", devices).param("h", leafHash).update();
        }
        if (next == size && latestHead().isPresent()) return;
        signHead(next);
    }

    private void signHead(long size) {
        // Read directly: these leaves are not committed yet, so they must not enter the cache.
        List<byte[]> leaves = jdbc.sql("SELECT leaf_hash FROM kt_leaves WHERE idx < :n ORDER BY idx").param("n", size).query(byte[].class).list();
        byte[] root = MerkleTree.root(leaves, Math.toIntExact(size));
        Instant at = clock.instant().truncatedTo(ChronoUnit.MILLIS);
        byte[] signature = Ed25519Keys.sign(key.getPrivate(), KtEncoding.head(deploymentId, size, root, at.toEpochMilli()));
        jdbc.sql("INSERT INTO kt_heads (size, root, signed_at, signature) VALUES (:s, :r, :t, :g) ON CONFLICT (size) DO NOTHING")
                .param("s", size).param("r", root).param("t", Timestamp.from(at)).param("g", signature).update();
    }

    long size() { return jdbc.sql("SELECT count(*) FROM kt_leaves").query(Long.class).single(); }

    /** Leaf hashes already read; the log is append-only, so cached entries never change. */
    private final List<byte[]> cachedLeaves = new java.util.ArrayList<>();

    /** The first {@code n} committed leaf hashes (cached; only newer ones are read). Read paths only. */
    List<byte[]> leafHashes(long n) {
        synchronized (cachedLeaves) {
            if (cachedLeaves.size() < n) {
                cachedLeaves.addAll(jdbc.sql("SELECT leaf_hash FROM kt_leaves WHERE idx >= :from AND idx < :n ORDER BY idx")
                        .param("from", cachedLeaves.size()).param("n", n).query(byte[].class).list());
            }
            if (cachedLeaves.size() < n) throw new IllegalStateException("log has fewer leaves than " + n);
            return List.copyOf(cachedLeaves.subList(0, Math.toIntExact(n)));
        }
    }

    Optional<Head> latestHead() {
        return jdbc.sql("SELECT size, root, signed_at, signature FROM kt_heads ORDER BY size DESC LIMIT 1").query(this::headRow).optional();
    }

    Optional<Head> head(long size) {
        return jdbc.sql("SELECT size, root, signed_at, signature FROM kt_heads WHERE size = :s").param("s", size).query(this::headRow).optional();
    }

    /** The newest leaf of an account among the first {@code size} leaves. */
    Optional<Leaf> latestLeaf(UUID accountId, long size) {
        return jdbc.sql("SELECT idx, account_id, identity_key, device_list_version, device_hash FROM kt_leaves WHERE account_id = :a AND idx < :n ORDER BY idx DESC LIMIT 1")
                .param("a", accountId).param("n", size)
                .query((rs, i) -> new Leaf(rs.getLong(1), rs.getObject(2, UUID.class), rs.getBytes(3), rs.getLong(4), rs.getBytes(5))).optional();
    }

    /** The largest head co-signed by at least one configured witness, with those co-signatures. */
    Optional<Witnessed> latestWitnessed() {
        if (witnesses.isEmpty()) return Optional.empty();
        List<Long> sizes = jdbc.sql("SELECT DISTINCT size FROM kt_cosignatures WHERE witness_id IN (:w) ORDER BY size DESC LIMIT 1")
                .param("w", witnesses.keySet()).query(Long.class).list();
        if (sizes.isEmpty()) return Optional.empty();
        long size = sizes.getFirst();
        List<Cosignature> cosignatures = jdbc.sql("SELECT witness_id, cosigned_at, signature FROM kt_cosignatures WHERE size = :s AND witness_id IN (:w) ORDER BY witness_id")
                .param("s", size).param("w", witnesses.keySet())
                .query((rs, i) -> new Cosignature(rs.getString(1), witnesses.get(rs.getString(1)), rs.getTimestamp(2).toInstant(), rs.getBytes(3))).list();
        return head(size).map(h -> new Witnessed(h, cosignatures));
    }

    /**
     * Stores a witness co-signature after verifying it over the stored head. Witnesses re-sign the
     * newest head periodically with a fresh time; the newest co-signature per head and witness wins.
     *
     * @param cosignedAt the witness's signing time; at most five minutes ahead of the server clock
     * @return false when the witness is unknown, the head does not exist, the time is implausible or
     *     the signature is invalid
     */
    @Transactional
    boolean cosign(String witnessId, long size, long cosignedAt, byte[] signature) {
        byte[] publicKey = witnesses.get(witnessId);
        Optional<Head> head = head(size);
        if (publicKey == null || head.isEmpty() || cosignedAt > clock.millis() + 300_000 || cosignedAt < head.get().signedAt().toEpochMilli()) return false;
        byte[] signed = KtEncoding.cosigned(KtEncoding.head(deploymentId, size, head.get().root(), head.get().signedAt().toEpochMilli()), cosignedAt);
        if (!Ed25519Keys.verify(publicKey, signed, signature)) return false;
        jdbc.sql("""
                INSERT INTO kt_cosignatures (size, witness_id, signature, cosigned_at) VALUES (:s, :w, :g, :t)
                ON CONFLICT (size, witness_id) DO UPDATE SET signature = EXCLUDED.signature, cosigned_at = EXCLUDED.cosigned_at
                WHERE kt_cosignatures.cosigned_at < EXCLUDED.cosigned_at""")
                .param("s", size).param("w", witnessId).param("g", signature).param("t", Timestamp.from(Instant.ofEpochMilli(cosignedAt))).update();
        return true;
    }

    private Head headRow(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new Head(rs.getLong(1), rs.getBytes(2), rs.getTimestamp(3).toInstant(), rs.getBytes(4));
    }

    private KeyPair loadKey(String configured) {
        try {
            byte[] pkcs8 = !configured.isBlank() ? Base64.getDecoder().decode(configured.strip())
                    : jdbc.sql("SELECT private_key FROM kt_signing_key WHERE id = 1").query(byte[].class).optional().orElse(null);
            if (pkcs8 == null) {
                jdbc.sql("INSERT INTO kt_signing_key (id, private_key) VALUES (1, :k) ON CONFLICT (id) DO NOTHING").param("k", Ed25519Keys.generatePkcs8()).update();
                pkcs8 = jdbc.sql("SELECT private_key FROM kt_signing_key WHERE id = 1").query(byte[].class).single(); // another replica may have won
            }
            return Ed25519Keys.fromPkcs8(pkcs8);
        } catch (GeneralSecurityException | IllegalArgumentException e) { throw new IllegalStateException("invalid enclave.kt.signing-key", e); }
    }
}
