package com.enclave.admin.internal;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.Duration;
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
    record View(List<ThroughputStore.Minute> minutes, Instant recordingSince, Instant capturedAt, boolean enabled, int bucketMinutes, Instant from, Instant to) {}
    private final AdminGuard guard;
    private final ThroughputStore store;
    private final Clock clock;
    private final AdminProperties properties;
    ThroughputController(AdminGuard guard, ThroughputStore store, Clock clock, AdminProperties properties) { this.guard = guard; this.store = store; this.clock = clock; this.properties = properties; }
    @GetMapping("/v1/admin/stats/throughput") ResponseEntity<View> throughput(@AuthenticationPrincipal Jwt admin, @RequestParam(defaultValue = "60") int minutes,
            @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate from, @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate to) {
        guard.require(admin, AdminPermissions.Permission.STATS_READ);
        Instant now = clock.instant(), end = now.truncatedTo(ChronoUnit.MINUTES).plus(1, ChronoUnit.MINUTES), start;
        int bucket = 1;
        boolean ranged = from != null || to != null;
        if (ranged) {
            var range = StatsRange.of(1, from, to, LocalDate.ofInstant(now, ZoneOffset.UTC));
            start = range.from().atStartOfDay().toInstant(ZoneOffset.UTC);
            Instant requestedEnd = range.to().plusDays(1).atStartOfDay().toInstant(ZoneOffset.UTC);
            if (requestedEnd.isBefore(end)) end = requestedEnd;
            long requestedBucket = (Duration.between(start, end).toMinutes() + 1439) / 1440;
            for (int candidate : new int[]{1, 5, 15, 30, 60, 180, 360, 720, 1440, 10080}) { bucket = candidate; if (candidate >= requestedBucket) break; }
        } else start = end.minus(Math.max(15, Math.min(1440, minutes)), ChronoUnit.MINUTES);
        final int interval = bucket;
        var rows = ranged ? store.between(start, end, interval) : store.since(start);
        var recorded = rows.stream().collect(Collectors.toMap(ThroughputStore.Minute::minute, Function.identity()));
        List<ThroughputStore.Minute> out = new ArrayList<>();
        for (Instant at = start; at.isBefore(end); at = at.plus(interval, ChronoUnit.MINUTES)) out.add(recorded.getOrDefault(at, new ThroughputStore.Minute(at, 0, 0, 0)));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new View(out, store.startedAt(), now, properties.activity().enabled(), interval, start, end));
    }
    ResponseEntity<View> throughput(Jwt admin, int minutes) { return throughput(admin, minutes, null, null); }
}
