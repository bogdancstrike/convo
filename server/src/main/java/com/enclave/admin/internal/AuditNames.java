package com.enclave.admin.internal;

import com.enclave.identity.IdentityAdminApi;
import java.time.Clock;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;

/** Readable projections; signed actor/target fields and exported chain bytes are never rewritten. */
@Component
class AuditNames {
    record View(long seq, java.time.Instant at, String actor, String action, String target, String reason, String hash, String actorName, String targetName) {}
    private record Cached(String name, long until) {}
    private static final Pattern ID = Pattern.compile("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}");
    private final IdentityAdminApi identity;
    private final KeycloakUsers idp;
    private final Clock clock;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    AuditNames(IdentityAdminApi identity, KeycloakUsers idp, Clock clock) { this.identity = identity; this.idp = idp; this.clock = clock; }

    List<View> resolve(List<AuditLog.Entry> entries) {
        var ids = new LinkedHashSet<String>();
        for (var e : entries) { collect(e.actor(), ids); collect(e.target(), ids); }
        Map<String, String> names = new HashMap<>();
        var subjects = identity.accountsBySubject(ids);
        var accounts = new LinkedHashSet<UUID>(ids.stream().map(UUID::fromString).toList());
        accounts.addAll(subjects.values());
        for (var a : identity.accounts(accounts)) names.put(a.accountId().toString(), a.username());
        subjects.forEach((subject, account) -> { if (names.containsKey(account.toString())) names.put(subject, names.get(account.toString())); });
        // Historical readable snapshots also cover accounts that have since been removed.
        for (var e : entries) for (var raw : List.of(e.actor(), e.target())) {
            String id = firstId(raw), saved = snapshot(raw);
            if (id != null && saved != null) names.putIfAbsent(id, saved);
        }
        boolean lookup = idp.available();
        for (String id : ids) {
            if (names.containsKey(id)) continue;
            Cached stored = cache.get(id);
            if (stored != null && stored.until() > clock.millis()) { if (stored.name() != null) names.put(id, stored.name()); continue; }
            if (!lookup) continue;
            try {
                String username = idp.username(id);
                names.put(id, username); cache.put(id, new Cached(username, clock.millis() + 300_000));
            } catch (com.enclave.contracts.EnclaveException error) {
                if (error.code() == com.enclave.contracts.ErrorCode.NOT_FOUND) cache.put(id, new Cached(null, clock.millis() + 60_000));
                else lookup = false; // One outage must not make a page wait for a timeout per row.
            }
        }
        if (cache.size() > 10_000) cache.clear();
        return entries.stream().map(e -> new View(e.seq(), e.at(), e.actor(), e.action(), e.target(), e.reason(), e.hash(), label(e.actor(), names), label(e.target(), names))).toList();
    }

    /** Name searches resolve to identifiers before SQL filtering/pagination. */
    List<String> matchingIds(String query) {
        if (query == null || query.strip().length() < 2 || query.length() > 100) return List.of();
        var out = new ArrayList<String>();
        for (var account : identity.searchAccounts(query, 100)) {
            out.add(account.accountId().toString()); identity.subject(account.accountId()).ifPresent(out::add);
        }
        if (idp.available()) try { for (var u : idp.search(query, 100)) out.add(u.id()); } catch (com.enclave.contracts.EnclaveException ignored) { /* raw audit search remains available */ }
        return out;
    }
    private static void collect(String raw, java.util.Set<String> ids) { var m = ID.matcher(raw); while (m.find()) ids.add(m.group().toLowerCase(java.util.Locale.ROOT)); }
    private static String firstId(String raw) { var m = ID.matcher(raw); return m.find() ? m.group().toLowerCase(java.util.Locale.ROOT) : null; }
    private static String snapshot(String raw) { int start = raw.indexOf(" ("); int end = raw.lastIndexOf(')'); return start >= 0 && end > start + 2 ? raw.substring(start + 2, end) : null; }
    static String label(String raw, Map<String, String> names) {
        if (raw.equals("console")) return "Admin console";
        String id = firstId(raw);
        if (id == null) return snapshot(raw) != null ? snapshot(raw) : raw.equals("idp:unknown") ? "Unknown sign-in account" : raw;
        String name = names.getOrDefault(id, snapshot(raw) == null ? "Unavailable account" : snapshot(raw));
        if (raw.startsWith("system:")) return "System · " + name;
        String suffix = raw.substring(raw.indexOf(id) + id.length());
        if (suffix.matches("\\.\\d+")) return name + " · device " + suffix.substring(1);
        int device = raw.indexOf("device:");
        return device >= 0 ? name + " · device " + raw.substring(device + 7) : name;
    }
}
