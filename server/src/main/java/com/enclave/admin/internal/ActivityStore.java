package com.enclave.admin.internal;

import com.enclave.messaging.SenderActivity;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Repository;

/**
 * Day-granular activity counts for the admin dashboard (V25). Incremented synchronously inside the
 * submission transaction (one upsert per accepted item), purged after the retention window. When
 * {@code enclave.admin.activity.enabled=false} nothing is recorded and per-user activity is empty.
 */
@Repository
class ActivityStore {
    /** Items and distinct active senders for one day. */
    record Day(LocalDate day, long items, long activeAccounts) {}
    /** One account's totals over a window. */
    record AccountActivity(UUID accountId, long items, int activeDays, LocalDate lastActiveDay) {}
    /** One account's items on one day. */
    record AccountDay(LocalDate day, long items) {}

    private final JdbcClient jdbc;
    private final AdminProperties properties;
    private final Clock clock;

    ActivityStore(JdbcClient jdbc, AdminProperties properties, Clock clock) {
        this.jdbc = jdbc;
        this.properties = properties;
        this.clock = clock;
    }

    LocalDate today() { return LocalDate.ofInstant(clock.instant(), ZoneOffset.UTC); }

    @EventListener
    void on(SenderActivity event) {
        if (!properties.activity().enabled()) return;
        jdbc.sql("""
                INSERT INTO account_activity_daily (account_id, day, items) VALUES (:a, :d, 1)
                ON CONFLICT (account_id, day) DO UPDATE SET items = account_activity_daily.items + 1""")
                .param("a", event.accountId()).param("d", today()).update();
    }

    @Scheduled(fixedDelayString = "PT6H", initialDelayString = "PT5M")
    int purge() {
        return jdbc.sql("DELETE FROM account_activity_daily WHERE day < :cutoff")
                .param("cutoff", today().minusDays(properties.activity().retention().toDays())).update();
    }

    /** Totals per day since {@code from} (days without activity are omitted). */
    List<Day> daily(LocalDate from) {
        return jdbc.sql("SELECT day, sum(items) AS items, count(*) AS accounts FROM account_activity_daily WHERE day >= :from GROUP BY day ORDER BY day")
                .param("from", from).query((rs, i) -> new Day(rs.getObject("day", LocalDate.class), rs.getLong("items"), rs.getLong("accounts"))).list();
    }

    /** Most active accounts since {@code from}. */
    List<AccountActivity> top(LocalDate from, int limit) {
        return jdbc.sql("""
                SELECT account_id, sum(items) AS items, count(*) AS days, max(day) AS last_day FROM account_activity_daily
                WHERE day >= :from GROUP BY account_id ORDER BY items DESC, account_id LIMIT :n""")
                .param("from", from).param("n", Math.max(1, Math.min(limit, 100))).query(ActivityStore::activity).list();
    }

    /** Totals for some accounts since {@code from} (accounts without activity are absent). */
    List<AccountActivity> of(List<UUID> accountIds, LocalDate from) {
        if (accountIds.isEmpty()) return List.of();
        return jdbc.sql("""
                SELECT account_id, sum(items) AS items, count(*) AS days, max(day) AS last_day FROM account_activity_daily
                WHERE day >= :from AND account_id IN (:ids) GROUP BY account_id""")
                .param("from", from).param("ids", accountIds).query(ActivityStore::activity).list();
    }

    /** One account's daily items since {@code from}. */
    List<AccountDay> account(UUID accountId, LocalDate from) {
        return jdbc.sql("SELECT day, items FROM account_activity_daily WHERE account_id = :a AND day >= :from ORDER BY day")
                .param("a", accountId).param("from", from).query((rs, i) -> new AccountDay(rs.getObject("day", LocalDate.class), rs.getLong("items"))).list();
    }

    private static AccountActivity activity(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new AccountActivity(rs.getObject("account_id", UUID.class), rs.getLong("items"), rs.getInt("days"), rs.getObject("last_day", LocalDate.class));
    }
}
