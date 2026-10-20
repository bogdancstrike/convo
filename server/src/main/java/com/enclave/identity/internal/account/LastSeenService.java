package com.enclave.identity.internal.account;

import java.time.Instant;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Opt-in, minute-precision activity metadata. Hiding clears the previously shared value atomically. */
@Service
public class LastSeenService {
    private final JdbcClient jdbc;

    public LastSeenService(JdbcClient jdbc) { this.jdbc = jdbc; }

    public boolean sharing(UUID accountId) {
        return jdbc.sql("SELECT share_last_seen FROM accounts WHERE account_id = :a")
                .param("a", accountId).query(Boolean.class).single();
    }

    @Transactional
    public void setSharing(UUID accountId, boolean enabled) {
        jdbc.sql("""
                UPDATE accounts SET share_last_seen = :s,
                    shared_last_seen_day = CASE WHEN :s THEN (now() AT TIME ZONE 'UTC')::date ELSE NULL END,
                    shared_last_seen_at = CASE WHEN :s THEN date_trunc('minute', now()) ELSE NULL END
                WHERE account_id = :a""")
                .param("s", enabled).param("a", accountId).update();
    }

    /** Called only by visible clients. Background mailbox polling does not publish activity. */
    @Transactional
    public void heartbeat(UUID accountId) {
        jdbc.sql("""
                UPDATE accounts SET shared_last_seen_day = (now() AT TIME ZONE 'UTC')::date,
                    shared_last_seen_at = date_trunc('minute', now())
                WHERE account_id = :a AND share_last_seen
                  AND shared_last_seen_at IS DISTINCT FROM date_trunc('minute', now())""")
                .param("a", accountId).update();
    }

    /** Privacy is checked at read time; never expose an owner-only device activity field. */
    public Instant visibleAt(UUID accountId) {
        return jdbc.sql("""
                SELECT shared_last_seen_at FROM accounts
                WHERE account_id = :a AND status = 'active' AND share_last_seen
                  AND shared_last_seen_at IS NOT NULL""")
                .param("a", accountId).query(Instant.class).optional().orElse(null);
    }
}
