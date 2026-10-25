package com.enclave.transparency.internal;

import com.enclave.identity.DeviceRoster;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.UUID;

/**
 * Canonical byte encodings signed or hashed by the key-transparency log. Clients and witnesses
 * recompute the same bytes (`core/keyTransparency.ts`, `deploy/kt-witness`); any change is a new
 * version label.
 *
 * <pre>
 * device hash = SHA-256("CONVO-KT-DEVICES-V1\n" || for each device by ascending ID: u32 id || u32 registrationId)
 * leaf        = "CONVO-KT-LEAF-V1\n" || accountId (16) || u64 deviceListVersion || u16 len || identityKey || device hash (32)
 * head        = "CONVO-KT-HEAD-V1\n" || deploymentId || "\n" || u64 size || root (32) || u64 timestampMillis
 * cosignature = Ed25519 over "CONVO-KT-COSIGN-V1\n" || u64 cosignedAtMillis || head
 * </pre>
 */
final class KtEncoding {
    private KtEncoding() {}

    static byte[] deviceHash(DeviceRoster roster) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes("CONVO-KT-DEVICES-V1\n".getBytes(StandardCharsets.UTF_8));
        roster.devices().stream().sorted(Comparator.comparingInt(DeviceRoster.Entry::deviceId))
                .forEach(d -> out.writeBytes(ByteBuffer.allocate(8).putInt(d.deviceId()).putInt(d.registrationId()).array()));
        return MerkleTree.sha256(out.toByteArray());
    }

    static byte[] leaf(UUID accountId, long deviceListVersion, byte[] identityKey, byte[] deviceHash) {
        byte[] label = "CONVO-KT-LEAF-V1\n".getBytes(StandardCharsets.UTF_8);
        return ByteBuffer.allocate(label.length + 16 + 8 + 2 + identityKey.length + 32).put(label)
                .putLong(accountId.getMostSignificantBits()).putLong(accountId.getLeastSignificantBits())
                .putLong(deviceListVersion).putShort((short) identityKey.length).put(identityKey).put(deviceHash).array();
    }

    static byte[] head(String deploymentId, long size, byte[] root, long timestampMillis) {
        byte[] label = ("CONVO-KT-HEAD-V1\n" + deploymentId + "\n").getBytes(StandardCharsets.UTF_8);
        return ByteBuffer.allocate(label.length + 8 + 32 + 8).put(label).putLong(size).put(root).putLong(timestampMillis).array();
    }

    /** The witness's own time is signed too: clients judge freshness by it, not by the head's age. */
    static byte[] cosigned(byte[] head, long cosignedAtMillis) {
        byte[] label = "CONVO-KT-COSIGN-V1\n".getBytes(StandardCharsets.UTF_8);
        return ByteBuffer.allocate(label.length + 8 + head.length).put(label).putLong(cosignedAtMillis).put(head).array();
    }
}
