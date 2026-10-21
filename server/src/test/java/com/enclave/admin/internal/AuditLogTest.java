package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class AuditLogTest {
    @Test void everyFieldAndThePreviousHashAreBoundIntoTheChain() {
        Instant at = Instant.parse("2026-10-21T10:00:00.123456Z");
        byte[] base = AuditLog.hash(AuditLog.GENESIS, 1, at, "sub (admin)", "account.disable", "acc", "policy breach");
        assertThat(base).hasSize(32);
        assertThat(AuditLog.hash(AuditLog.GENESIS, 1, at, "sub (admin)", "account.disable", "acc", "policy breach")).isEqualTo(base);
        assertThat(AuditLog.hash(AuditLog.GENESIS, 2, at, "sub (admin)", "account.disable", "acc", "policy breach")).isNotEqualTo(base);
        assertThat(AuditLog.hash(AuditLog.GENESIS, 1, at, "sub (admin)", "account.enable", "acc", "policy breach")).isNotEqualTo(base);
        assertThat(AuditLog.hash(AuditLog.GENESIS, 1, at, "sub (admin)", "account.disable", "acc", "edited reason")).isNotEqualTo(base);
        assertThat(AuditLog.hash(base, 1, at, "sub (admin)", "account.disable", "acc", "policy breach")).isNotEqualTo(base);
    }
}
