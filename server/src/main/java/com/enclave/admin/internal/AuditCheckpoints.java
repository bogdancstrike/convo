package com.enclave.admin.internal;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Writes the audit chain head to an independent append-only file ({@code seq head time} lines)
 * and reads it back for verification. Because the file lives outside the database, a privileged
 * rewrite of {@code admin_audit} — even one that recomputes every hash — no longer matches the
 * recorded heads.
 */
@Component
class AuditCheckpoints {
    record Checkpoint(long seq, String head) {}

    private static final Logger log = LoggerFactory.getLogger(AuditCheckpoints.class);
    private final AuditLog audit;
    private final AdminProperties properties;
    private final Clock clock;

    AuditCheckpoints(AuditLog audit, AdminProperties properties, Clock clock) {
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    @Scheduled(fixedDelayString = "${enclave.admin.checkpoint-interval:PT15M}", initialDelayString = "PT1M")
    void checkpoint() {
        Path file = properties.checkpointPath();
        if (file == null) return;
        try {
            var verification = audit.verify();
            if (!verification.valid() || verification.entries() == 0) return; // never certify a broken chain
            List<Checkpoint> existing = read();
            if (!existing.isEmpty() && existing.get(existing.size() - 1).seq() == verification.entries()) return;
            Files.createDirectories(file.getParent());
            Files.writeString(file, verification.entries() + " " + verification.head() + " " + clock.instant() + "\n", StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND, StandardOpenOption.SYNC);
        } catch (IOException | RuntimeException e) {
            log.warn("Audit checkpoint failed ({})", e.getClass().getSimpleName());
        }
    }

    List<Checkpoint> read() throws IOException {
        Path file = properties.checkpointPath();
        if (file == null || !Files.exists(file)) return List.of();
        List<Checkpoint> list = new ArrayList<>();
        for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
            String[] parts = line.trim().split(" ");
            if (parts.length >= 2) list.add(new Checkpoint(Long.parseLong(parts[0]), parts[1]));
        }
        return list;
    }
}
