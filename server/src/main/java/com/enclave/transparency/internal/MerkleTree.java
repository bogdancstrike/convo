package com.enclave.transparency.internal;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;

/**
 * RFC 9162 (Certificate Transparency v2) Merkle tree hashing and proofs over a list of leaf hashes:
 * {@code MTH} (§2.1.1), inclusion paths (§2.1.3.1) and consistency proofs (§2.1.4.1). Leaf hashes
 * are {@code SHA-256(0x00 || leaf)}, interior nodes {@code SHA-256(0x01 || left || right)}. The
 * client verifier (`core/keyTransparency.ts`) implements the matching §2.1.3.2 / §2.1.4.2 checks.
 */
final class MerkleTree {
    private MerkleTree() {}

    static byte[] leafHash(byte[] leaf) { return sha256(new byte[] {0}, leaf); }

    static byte[] node(byte[] left, byte[] right) { return sha256(new byte[] {1}, left, right); }

    /** Root of the first {@code n} leaves; the empty tree's root is SHA-256 of nothing. */
    static byte[] root(List<byte[]> leaves, int n) { return n == 0 ? sha256() : mth(leaves, 0, n); }

    /** Audit path for leaf {@code index} in the tree of the first {@code n} leaves. */
    static List<byte[]> inclusion(List<byte[]> leaves, int index, int n) {
        if (index < 0 || index >= n || n > leaves.size()) throw new IllegalArgumentException("index outside tree");
        List<byte[]> path = new ArrayList<>();
        path(leaves, index, 0, n, path);
        return path;
    }

    /** Consistency proof between the trees of the first {@code m} and {@code n} leaves (0 < m ≤ n). */
    static List<byte[]> consistency(List<byte[]> leaves, int m, int n) {
        if (m <= 0 || m > n || n > leaves.size()) throw new IllegalArgumentException("invalid sizes");
        List<byte[]> proof = new ArrayList<>();
        if (m < n) subproof(leaves, m, 0, n, true, proof);
        return proof;
    }

    private static byte[] mth(List<byte[]> leaves, int start, int n) {
        if (n == 1) return leaves.get(start);
        int k = split(n);
        return node(mth(leaves, start, k), mth(leaves, start + k, n - k));
    }

    private static void path(List<byte[]> leaves, int m, int start, int n, List<byte[]> out) {
        if (n == 1) return;
        int k = split(n);
        if (m < k) { path(leaves, m, start, k, out); out.add(mth(leaves, start + k, n - k)); }
        else { path(leaves, m - k, start + k, n - k, out); out.add(mth(leaves, start, k)); }
    }

    private static void subproof(List<byte[]> leaves, int m, int start, int n, boolean complete, List<byte[]> out) {
        if (m == n) { if (!complete) out.add(mth(leaves, start, n)); return; }
        int k = split(n);
        if (m <= k) { subproof(leaves, m, start, k, complete, out); out.add(mth(leaves, start + k, n - k)); }
        else { subproof(leaves, m - k, start + k, n - k, false, out); out.add(mth(leaves, start, k)); }
    }

    /** Largest power of two smaller than n (n ≥ 2). */
    private static int split(int n) { return Integer.highestOneBit(n - 1); }

    static byte[] sha256(byte[]... parts) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            for (byte[] part : parts) digest.update(part);
            return digest.digest();
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
