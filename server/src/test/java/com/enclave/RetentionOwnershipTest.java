package com.enclave;

import static org.assertj.core.api.Assertions.assertThat;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;

/** Retention is owned by external operations; adding another age-based app job must fail review. */
class RetentionOwnershipTest {
    @Test void onlyNonDestructiveOperationalSchedulesRemain() {
        Set<String> scheduled = new ClassFileImporter().importPackages("com.enclave").stream()
                .flatMap(c -> c.getMethods().stream()).filter(m -> m.isAnnotatedWith(Scheduled.class))
                .map(m -> m.getOwner().getSimpleName() + "." + m.getName()).collect(Collectors.toSet());
        assertThat(scheduled).containsExactlyInAnyOrder("AuditCheckpoints.checkpoint", "AuditNames.backfill", "IdentityAuditImporter.poll", "DeviceSessionRegistry.closeIdle");
    }
}
