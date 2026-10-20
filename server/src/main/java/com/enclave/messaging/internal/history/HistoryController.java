package com.enclave.messaging.internal.history;

import com.enclave.contracts.Base64Url;
import com.enclave.identity.AuthenticatedDevice;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Device-authenticated, account-scoped history. No caller-supplied account IDs. */
@RestController
class HistoryController {
    private final HistoryService history;
    HistoryController(HistoryService history) { this.history = history; }
    record Upload(String ciphertext) {}
    record Entry(long seq, UUID id, String ciphertext) {}
    @PutMapping("/v1/history/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void append(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID id, @RequestBody Upload body) {
        history.append(me.accountId(), id, Base64Url.decode(body.ciphertext(), "ciphertext"));
    }
    @GetMapping("/v1/history")
    ResponseEntity<List<Entry>> page(@AuthenticationPrincipal AuthenticatedDevice me, @RequestParam(defaultValue="0") long after) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(history.page(me.accountId(), after).stream()
                .map(e -> new Entry(e.seq(), e.id(), Base64Url.encode(e.ciphertext()))).toList());
    }
}
