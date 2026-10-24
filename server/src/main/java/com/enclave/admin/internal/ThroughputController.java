package com.enclave.admin.internal;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
class ThroughputController {
    record View(List<ThroughputStore.Minute> minutes, Instant recordingSince, Instant capturedAt, boolean enabled) {}
    private final AdminGuard guard;
    private final ThroughputStore store;
    private final Clock clock;
    private final AdminProperties properties;
    ThroughputController(AdminGuard guard, ThroughputStore store, Clock clock, AdminProperties properties) { this.guard = guard; this.store = store; this.clock = clock; this.properties = properties; }
    @GetMapping("/v1/admin/stats/throughput") ResponseEntity<View> throughput(@AuthenticationPrincipal Jwt admin, @RequestParam(defaultValue = "60") int minutes) {
        guard.require(admin, AdminPermissions.Permission.STATS_READ);
        int window = Math.max(15, Math.min(1440, minutes));
        Instant now = clock.instant(), last = now.truncatedTo(ChronoUnit.MINUTES), from = last.minus(window - 1L, ChronoUnit.MINUTES);
        var recorded = store.since(from).stream().collect(Collectors.toMap(ThroughputStore.Minute::minute, Function.identity()));
        List<ThroughputStore.Minute> out = new ArrayList<>();
        for (int i = 0; i < window; i++) { Instant at = from.plus(i, ChronoUnit.MINUTES); out.add(recorded.getOrDefault(at, new ThroughputStore.Minute(at, 0, 0, 0))); }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new View(out, store.startedAt(), now, properties.activity().enabled()));
    }
}
