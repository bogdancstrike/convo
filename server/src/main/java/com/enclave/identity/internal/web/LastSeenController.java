package com.enclave.identity.internal.web;

import com.enclave.identity.AuthenticatedDevice;
import com.fasterxml.jackson.annotation.JsonInclude;
import com.enclave.identity.internal.account.LastSeenService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import java.time.LocalDate;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Device-authenticated, single-account lookups. No directory/bulk activity feed. */
@RestController
class LastSeenController {
    private final LastSeenService service;
    LastSeenController(LastSeenService service) { this.service = service; }
    record Privacy(@NotNull Boolean shareLastSeen) {}
    @JsonInclude(JsonInclude.Include.ALWAYS)
    record LastSeen(LocalDate day, Instant at) {}

    @GetMapping("/v1/privacy/last-seen")
    ResponseEntity<Privacy> privacy(@AuthenticationPrincipal AuthenticatedDevice me) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new Privacy(service.sharing(me.accountId())));
    }
    @PutMapping("/v1/privacy/last-seen")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void privacy(@AuthenticationPrincipal AuthenticatedDevice me, @Valid @RequestBody Privacy body) {
        service.setSharing(me.accountId(), body.shareLastSeen());
    }
    @PostMapping("/v1/privacy/last-seen/heartbeat")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void heartbeat(@AuthenticationPrincipal AuthenticatedDevice me) { service.heartbeat(me.accountId()); }

    @GetMapping("/v1/accounts/{accountId}/last-seen")
    ResponseEntity<LastSeen> seen(@PathVariable UUID accountId) {
        Instant at = service.visibleAt(accountId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new LastSeen(at == null ? null : at.atZone(ZoneOffset.UTC).toLocalDate(), at));
    }
}
