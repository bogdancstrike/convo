package com.enclave.admin.internal;

import jakarta.annotation.PreDestroy;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** Cached, bounded, parallel probes. A failed dependency must not hide the other results. */
@Service
class SystemHealth {
    enum State { UP, DOWN, DEGRADED, DISABLED, UNKNOWN }
    record Observation(State status, String detail) {
        static Observation up(String detail) { return new Observation(State.UP, detail); }
    }
    @FunctionalInterface interface Operation { Observation run() throws Exception; }
    record Probe(String id, String name, String group, boolean required, String scope, Operation operation) {}
    record Check(String id, String name, String group, boolean required, String scope, State status, String detail, long latencyMs, Instant checkedAt) {}
    record Snapshot(State status, Instant checkedAt, long cacheSeconds, List<Check> components) {}
    private final SystemHealthProperties properties;
    private final List<Probe> probes;
    private final Clock clock;
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
    private Snapshot cached;

    @Autowired SystemHealth(SystemHealthProperties properties, ComponentProbes probes, Clock clock) {
        this(properties, probes.probes(), clock);
    }
    SystemHealth(SystemHealthProperties properties, List<Probe> probes, Clock clock) {
        this.properties = properties; this.probes = List.copyOf(probes); this.clock = clock;
    }
    synchronized Snapshot snapshot() {
        Instant now = clock.instant();
        if (cached != null && now.isBefore(cached.checkedAt().plus(properties.cacheTtl()))) return cached;
        List<Callable<Check>> tasks = probes.stream().<Callable<Check>>map(p -> () -> check(p)).toList();
        List<Check> results = new ArrayList<>();
        try {
            var futures = executor.invokeAll(tasks, properties.timeout().toMillis(), TimeUnit.MILLISECONDS);
            for (int i = 0; i < futures.size(); i++) {
                var future = futures.get(i);
                if (future.isCancelled()) results.add(result(probes.get(i), State.DOWN, "Check timed out. The component did not respond within the probe budget.", properties.timeout().toMillis()));
                else try { results.add(future.get()); }
                catch (java.util.concurrent.ExecutionException e) { results.add(result(probes.get(i), State.DOWN, "Check failed. Inspect the component's service logs.", 0)); }
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            for (var probe : probes) results.add(result(probe, State.UNKNOWN, "Health refresh was interrupted; retry the check.", 0));
        }
        cached = new Snapshot(overall(results), clock.instant(), properties.cacheTtl().toSeconds(), List.copyOf(results));
        return cached;
    }
    static State overall(List<Check> checks) {
        if (checks.stream().anyMatch(c -> c.required() && c.status() == State.DOWN)) return State.DOWN;
        if (checks.stream().anyMatch(c -> c.status() == State.DOWN || c.status() == State.DEGRADED || (c.required() && c.status() != State.UP))) return State.DEGRADED;
        return checks.isEmpty() ? State.UNKNOWN : State.UP;
    }
    private Check check(Probe probe) {
        long start = System.nanoTime();
        try {
            var observation = probe.operation().run();
            return result(probe, observation.status(), observation.detail(), TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start));
        } catch (Exception e) {
            if (e instanceof InterruptedException) Thread.currentThread().interrupt();
            // Exception messages, response bodies and configured URLs may contain credentials.
            return result(probe, State.DOWN, "Connection or service check failed. Inspect component availability, credentials and service logs.", TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start));
        }
    }
    private Check result(Probe p, State state, String detail, long elapsed) { return new Check(p.id(), p.name(), p.group(), p.required(), p.scope(), state, detail, elapsed, clock.instant()); }
    @PreDestroy void close() { executor.shutdownNow(); }
}
