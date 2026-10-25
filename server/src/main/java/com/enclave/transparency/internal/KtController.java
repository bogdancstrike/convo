package com.enclave.transparency.internal;

import com.enclave.contracts.Base64Url;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.AuthenticatedDevice;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/**
 * Key-transparency API. Devices: {@code GET /v1/kt/accounts/{id}} returns everything needed to
 * verify one account's entry in one round trip. Witnesses (public, hashes only):
 * {@code GET /v1/kt/head}, {@code GET /v1/kt/consistency}, {@code POST /v1/kt/cosignatures}.
 * All binary values are base64url.
 */
@RestController
class KtController {
    /** A signed tree head and the keys needed to check it. */
    /** @param mapRoot verifiable-map root (null before the map existed) @param mapSignature log key signature over CONVO-KT-MAP-V1 */
    record HeadDto(String deploymentId, long size, String root, long timestamp, String signature, String logKey, String mapRoot, String mapSignature) {}
    /** @param version 1 = head only, 2 = head and map root */
    record CosignatureDto(String witnessId, String publicKey, long timestamp, String signature, int version) {}
    /** Map proof for one account: non-empty siblings (top-down) flagged in a 32-byte bitmap. */
    record MapProofDto(String bitmap, List<String> siblings) {}
    record WitnessedDto(HeadDto head, List<CosignatureDto> cosignatures) {}
    record LeafDto(long index, String accountId, String identityKey, long deviceListVersion, String deviceHash) {}
    /**
     * @param witnessConsistency proof from the witnessed head to {@code head} (empty when equal or unwitnessed)
     * @param sinceConsistency proof from the caller's {@code since} size to {@code head}
     * @param leaf the account's newest entry in {@code head} (null when it has none)
     * @param inclusion audit path of {@code leaf} in {@code head}
     */
    record AccountProofDto(HeadDto head, WitnessedDto witnessed, List<String> witnessConsistency, List<String> sinceConsistency,
                           LeafDto leaf, List<String> inclusion, long maxWitnessAgeMs, Map<String, String> witnesses, MapProofDto mapProof) {}
    record CosignRequest(@NotBlank @Size(max = 64) String witnessId, @Min(1) long size, @Min(1) long timestamp, @NotNull String signature, Integer version) {}

    private final TransparencyLog log;
    private final KeyTransparencyProperties properties;

    KtController(TransparencyLog log, KeyTransparencyProperties properties) { this.log = log; this.properties = properties; }

    @GetMapping("/v1/kt/accounts/{accountId}")
    ResponseEntity<AccountProofDto> account(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID accountId,
                                            @RequestParam(defaultValue = "0") long since) {
        TransparencyLog.Head head = log.latestHead().orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "log is empty"));
        int size = Math.toIntExact(head.size());
        if (since > size) throw new EnclaveException(ErrorCode.CONFLICT, "requested size is ahead of the log");
        List<byte[]> leaves = log.leafHashes(size);
        var witnessed = log.latestWitnessed().filter(w -> w.head().size() <= size);
        List<String> witnessConsistency = witnessed.map(w -> proof(MerkleTree.consistency(leaves, Math.toIntExact(w.head().size()), size))).orElse(List.of());
        List<String> sinceConsistency = since > 0 ? proof(MerkleTree.consistency(leaves, Math.toIntExact(since), size)) : List.of();
        var leaf = log.latestLeaf(accountId, size);
        List<String> inclusion = leaf.map(l -> proof(MerkleTree.inclusion(leaves, Math.toIntExact(l.index()), size))).orElse(List.of());
        return noStore(new AccountProofDto(dto(head), witnessed.map(this::dto).orElse(null), witnessConsistency, sinceConsistency,
                leaf.map(l -> new LeafDto(l.index(), l.accountId().toString(), Base64Url.encode(l.identityKey()), l.deviceListVersion(), Base64Url.encode(l.deviceHash()))).orElse(null),
                inclusion, properties.maxWitnessAge().toMillis(),
                log.witnesses().entrySet().stream().collect(Collectors.toMap(Map.Entry::getKey, e -> Base64Url.encode(e.getValue()))),
                head.mapRoot() == null ? null : mapProof(SparseMerkleMap.prove(log.mapEntries(size, true), SparseMerkleMap.key(accountId)))));
    }

    @GetMapping("/v1/kt/head")
    ResponseEntity<HeadDto> head() {
        return noStore(dto(log.latestHead().orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "log is empty"))));
    }

    @GetMapping("/v1/kt/consistency")
    ResponseEntity<Map<String, List<String>>> consistency(@RequestParam long from, @RequestParam long to) {
        if (from < 1 || from > to || log.head(to).isEmpty()) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "invalid sizes");
        return noStore(Map.of("proof", proof(MerkleTree.consistency(log.leafHashes(to), Math.toIntExact(from), Math.toIntExact(to)))));
    }

    @PostMapping("/v1/kt/cosignatures")
    ResponseEntity<Void> cosign(@RequestBody @jakarta.validation.Valid CosignRequest body) {
        int version = body.version() == null ? 1 : body.version();
        if (version != 1 && version != 2) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "unknown co-signature version");
        if (!log.cosign(body.witnessId(), body.size(), body.timestamp(), Base64Url.decode(body.signature(), "signature"), version)) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "unknown witness, head or invalid co-signature");
        }
        return ResponseEntity.noContent().build();
    }

    /**
     * Witnesses only: full leaves (account IDs, public keys) from {@code from} to {@code to}, at most
     * 1000, so they can recompute the map. Signed by a configured witness key (X-KT-Witness,
     * X-KT-Timestamp, X-KT-Signature over CONVO-KT-READ-V1); strangers cannot list the directory.
     */
    @GetMapping("/v1/kt/leaves")
    ResponseEntity<Map<String, List<String>>> leaves(@RequestParam long from, @RequestParam long to, @RequestHeader("X-KT-Witness") String witnessId,
                                                     @RequestHeader("X-KT-Timestamp") long timestamp, @RequestHeader("X-KT-Signature") String signature) {
        if (from < 0 || to <= from || to - from > 1000 || to > log.size()) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "invalid range");
        if (!log.witnessMayRead(witnessId, from, to, timestamp, Base64Url.decode(signature, "signature"))) throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "not a configured witness");
        return noStore(Map.of("leaves", log.leafBytes(from, to).stream().map(Base64Url::encode).toList()));
    }

    private static MapProofDto mapProof(SparseMerkleMap.Proof p) { return new MapProofDto(Base64Url.encode(p.bitmap()), proof(p.siblings())); }

    private HeadDto dto(TransparencyLog.Head h) {
        return new HeadDto(log.deploymentId(), h.size(), Base64Url.encode(h.root()), h.signedAt().toEpochMilli(), Base64Url.encode(h.signature()), Base64Url.encode(log.logKey()),
                h.mapRoot() == null ? null : Base64Url.encode(h.mapRoot()), h.mapSignature() == null ? null : Base64Url.encode(h.mapSignature()));
    }

    private WitnessedDto dto(TransparencyLog.Witnessed w) {
        return new WitnessedDto(dto(w.head()), w.cosignatures().stream()
                .map(c -> new CosignatureDto(c.witnessId(), Base64Url.encode(c.publicKey()), c.cosignedAt().toEpochMilli(), Base64Url.encode(c.signature()), c.version())).toList());
    }

    private static List<String> proof(List<byte[]> nodes) { return nodes.stream().map(Base64Url::encode).toList(); }

    private static <T> ResponseEntity<T> noStore(T body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }
}
