package com.enclave.transparency.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.enclave.contracts.Base64Url;
import com.enclave.contracts.Ed25519Keys;
import com.enclave.identity.DeviceRoster;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Shared key-transparency vectors ({@code contracts/vectors/kt-v1.json}, generated independently in Python). */
class KtVectorsTest {
    private static final JsonNode VECTORS = JsonMapper.builder().build().readTree(Path.of("..", "contracts", "vectors", "kt-v1.json").toFile());

    private static byte[] b(JsonNode node) { return Base64Url.decode(node.asString(), "vector"); }

    private static List<byte[]> leafHashes() {
        List<byte[]> leaves = new ArrayList<>();
        for (JsonNode e : VECTORS.get("entries")) leaves.add(b(e.get("leafHash")));
        return leaves;
    }

    private static List<String> encoded(List<byte[]> nodes) { return nodes.stream().map(Base64Url::encode).toList(); }

    @Test void encodingsMatch() {
        for (JsonNode e : VECTORS.get("entries")) {
            List<DeviceRoster.Entry> devices = new ArrayList<>();
            for (JsonNode d : e.get("devices")) devices.add(new DeviceRoster.Entry(d.get("deviceId").asInt(), d.get("registrationId").asInt()));
            UUID account = UUID.fromString(e.get("accountId").asString());
            byte[] deviceHash = KtEncoding.deviceHash(new DeviceRoster(account, e.get("deviceListVersion").asLong(), devices));
            assertThat(Base64Url.encode(deviceHash)).isEqualTo(e.get("deviceHash").asString());
            byte[] leaf = KtEncoding.leaf(account, e.get("deviceListVersion").asLong(), b(e.get("identityKey")), deviceHash);
            assertThat(Base64Url.encode(leaf)).isEqualTo(e.get("leaf").asString());
            assertThat(Base64Url.encode(MerkleTree.leafHash(leaf))).isEqualTo(e.get("leafHash").asString());
        }
        JsonNode h = VECTORS.get("head");
        assertThat(Base64Url.encode(KtEncoding.head(h.get("deploymentId").asString(), h.get("size").asLong(), b(h.get("root")), h.get("timestamp").asLong())))
                .isEqualTo(h.get("bytes").asString());
        assertThat(Base64Url.encode(KtEncoding.cosigned(b(h.get("bytes")), h.get("cosignTimestamp").asLong()))).isEqualTo(h.get("cosignBytes").asString());
    }

    @Test void rootsAndProofsMatch() {
        List<byte[]> leaves = leafHashes();
        for (int n = 0; n <= leaves.size(); n++) assertThat(Base64Url.encode(MerkleTree.root(leaves, n))).isEqualTo(VECTORS.get("roots").get(String.valueOf(n)).asString());
        for (JsonNode p : VECTORS.get("inclusion")) {
            List<String> expected = new ArrayList<>(); p.get("path").forEach(x -> expected.add(x.asString()));
            assertThat(encoded(MerkleTree.inclusion(leaves, p.get("index").asInt(), p.get("size").asInt()))).isEqualTo(expected);
        }
        for (JsonNode p : VECTORS.get("consistency")) {
            List<String> expected = new ArrayList<>(); p.get("proof").forEach(x -> expected.add(x.asString()));
            assertThat(encoded(MerkleTree.consistency(leaves, p.get("from").asInt(), p.get("to").asInt()))).isEqualTo(expected);
        }
    }

    @Test void ed25519HelperSignsAndRejectsTampering() throws Exception {
        var pair = Ed25519Keys.fromPkcs8(Ed25519Keys.generatePkcs8());
        byte[] message = KtEncoding.cosigned(b(VECTORS.get("head").get("bytes")), 1L);
        byte[] signature = Ed25519Keys.sign(pair.getPrivate(), message);
        assertThat(Ed25519Keys.verify(Ed25519Keys.raw(pair.getPublic()), message, signature)).isTrue();
        message[message.length - 1] ^= 1;
        assertThat(Ed25519Keys.verify(Ed25519Keys.raw(pair.getPublic()), message, signature)).isFalse();
    }
}
