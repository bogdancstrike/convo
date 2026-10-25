package com.enclave.transparency.internal;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;

/**
 * Verifiable map for key transparency (specs §19.4): a 256-level sparse Merkle tree from
 * {@code SHA-256("CONVO-KT-MAPKEY-V1\n" || accountId)} to the hash of that account's newest log leaf.
 * A lookup proves the returned leaf is the newest one for the account at a head — the gap a plain
 * log leaves open (a server could otherwise serve an older, still valid entry).
 *
 * <pre>
 * empty[0]   = 32 zero bytes                    (an empty leaf position)
 * empty[i+1] = SHA-256(0x01 || empty[i] || empty[i])
 * leaf       = SHA-256(0x02 || key || value)
 * node       = SHA-256(0x01 || left || right)   (bit 0 of the key, most significant first, picks left)
 * proof      = bitmap (32 bytes; bit i set = sibling at depth i is not empty, depth 0 = just below the root)
 *              + the non-empty siblings, top-down
 * </pre>
 * Matching implementations: {@code core/keyTransparency.ts}, {@code deploy/kt-witness}; vectors in
 * {@code contracts/vectors/kt-map-v1.json}.
 */
final class SparseMerkleMap {
    static final int DEPTH = 256;
    private static final byte[][] EMPTY = new byte[DEPTH + 1][];
    static {
        EMPTY[0] = new byte[32];
        for (int i = 1; i <= DEPTH; i++) EMPTY[i] = MerkleTree.sha256(new byte[] {1}, EMPTY[i - 1], EMPTY[i - 1]);
    }

    /** One map entry: 32-byte key and 32-byte value. */
    record Entry(byte[] key, byte[] value) {}

    /** Map proof: which siblings (top-down) are non-empty, and those siblings. */
    record Proof(byte[] bitmap, List<byte[]> siblings) {}

    private SparseMerkleMap() {}

    static byte[] key(UUID accountId) {
        byte[] label = "CONVO-KT-MAPKEY-V1\n".getBytes(StandardCharsets.UTF_8);
        byte[] id = java.nio.ByteBuffer.allocate(16).putLong(accountId.getMostSignificantBits()).putLong(accountId.getLeastSignificantBits()).array();
        return MerkleTree.sha256(label, id);
    }

    static byte[] leaf(byte[] key, byte[] value) { return MerkleTree.sha256(new byte[] {2}, key, value); }

    static byte[] emptyRoot() { return EMPTY[DEPTH]; }

    /** Root of the map; {@code entries} must be sorted by key (unsigned) with unique keys. */
    static byte[] root(List<Entry> entries) { return hash(entries, 0, entries.size(), 0); }

    /** Proof for {@code key} (present or absent) in the map of sorted {@code entries}. */
    static Proof prove(List<Entry> entries, byte[] key) {
        byte[] bitmap = new byte[32];
        List<byte[]> siblings = new ArrayList<>();
        int from = 0, to = entries.size();
        for (int depth = 0; depth < DEPTH; depth++) {
            int split = split(entries, from, to, depth);
            boolean right = bit(key, depth);
            byte[] sibling = right ? hash(entries, from, split, depth + 1) : hash(entries, split, to, depth + 1);
            if (!Arrays.equals(sibling, EMPTY[DEPTH - depth - 1])) { bitmap[depth / 8] |= (byte) (0x80 >>> (depth % 8)); siblings.add(sibling); }
            if (right) from = split; else to = split;
            if (from == to) break; // the rest of the path is empty: every remaining sibling is empty
        }
        return new Proof(bitmap, siblings);
    }

    private static byte[] hash(List<Entry> entries, int from, int to, int depth) {
        if (from == to) return EMPTY[DEPTH - depth];
        if (depth == DEPTH) return leaf(entries.get(from).key(), entries.get(from).value());
        if (to - from == 1 && depth < DEPTH) {
            // A single entry: fold its leaf up through empty siblings without recursing 256 times.
            Entry e = entries.get(from);
            byte[] h = leaf(e.key(), e.value());
            for (int d = DEPTH - 1; d >= depth; d--) h = bit(e.key(), d) ? MerkleTree.node(EMPTY[DEPTH - d - 1], h) : MerkleTree.node(h, EMPTY[DEPTH - d - 1]);
            return h;
        }
        int split = split(entries, from, to, depth);
        return MerkleTree.node(hash(entries, from, split, depth + 1), hash(entries, split, to, depth + 1));
    }

    /** First index in [from, to) whose key has bit {@code depth} set (entries sorted). */
    private static int split(List<Entry> entries, int from, int to, int depth) {
        int lo = from, hi = to;
        while (lo < hi) { int mid = (lo + hi) >>> 1; if (bit(entries.get(mid).key(), depth)) hi = mid; else lo = mid + 1; }
        return lo;
    }

    static boolean bit(byte[] key, int depth) { return (key[depth / 8] & (0x80 >>> (depth % 8))) != 0; }

    /** Unsigned lexicographic order of keys (sorting entries before {@link #root}/{@link #prove}). */
    static int compare(byte[] a, byte[] b) { return Arrays.compareUnsigned(a, b); }
}
