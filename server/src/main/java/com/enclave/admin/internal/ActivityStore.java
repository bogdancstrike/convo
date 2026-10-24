package com.enclave.admin.internal;

import com.enclave.messaging.SenderActivity;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/**
 * Day-granular activity counts for the admin dashboard (V25). Incremented synchronously inside the
 * submission transaction (one upsert per accepted item). Retention is managed externally. When
 * {@code enclave.admin.activity.enabled=false} nothing is recorded and per-user activity is empty.
 */
@Repository
class ActivityStore {
    /**
     * One day across the organization.
     *
     * @param items encrypted items sent
     * @param activeAccounts people who opened Convo or sent something
     * @param senders people who sent at least one item
     * @param web people who used the web app
     * @param android people who used the Android app
     */
    record Day(LocalDate day, long items, long activeAccounts, long senders, long web, long android) {}
    /** One account's totals over a window. */
    record AccountActivity(UUID accountId, long items, int activeDays, LocalDate lastActiveDay) {}
    /** One account's day: items sent, whether Convo was opened, and on which platforms. */
    record AccountDay(LocalDate day, long items, boolean opened, boolean web, boolean android) {}

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

    /** First authenticated request of a device today: the person used Convo (and on which platform). */
    @EventListener
    void on(com.enclave.identity.DeviceActiveToday event) {
        if (!properties.activity().enabled()) return;
        boolean web = "web".equals(event.platform()), android = "android".equals(event.platform());
        jdbc.sql("""
                INSERT INTO account_activity_daily (account_id, day, items, opened, web, android) VALUES (:a, :d, 0, true, :w, :n)
                ON CONFLICT (account_id, day) DO UPDATE SET opened = true,
                    web = account_activity_daily.web OR EXCLUDED.web, android = account_activity_daily.android OR EXCLUDED.android""")
                .param("a", event.accountId()).param("d", today()).param("w", web).param("n", android).update();
    }

    int purge() {
        return jdbc.sql("DELETE FROM account_activity_daily WHERE day < :cutoff")
                .param("cutoff", today().minusDays(properties.activity().retention().toDays())).update();
    }

    /** Totals per day since {@code from} (days without activity are omitted). */
    List<Day> daily(LocalDate from) { return daily(from, today()); }

    List<Day> daily(LocalDate from, LocalDate to) {
        return jdbc.sql("""
                SELECT day, sum(items) AS items, count(*) AS accounts, count(*) FILTER (WHERE items > 0) AS senders,
                       count(*) FILTER (WHERE web) AS web, count(*) FILTER (WHERE android) AS android
                FROM account_activity_daily WHERE day >= :from AND day <= :to GROUP BY day ORDER BY day""")
                .param("from", from).param("to", to).query((rs, i) -> new Day(rs.getObject("day", LocalDate.class), rs.getLong("items"), rs.getLong("accounts"),
                        rs.getLong("senders"), rs.getLong("web"), rs.getLong("android"))).list();
    }

    /** Most active accounts since {@code from}. */
    List<AccountActivity> top(LocalDate from, int limit) { return top(from, today(), limit); }

    List<AccountActivity> top(LocalDate from, LocalDate to, int limit) {
        return jdbc.sql("""
                SELECT account_id, sum(items) AS items, count(*) AS days, max(day) AS last_day FROM account_activity_daily
                WHERE day >= :from AND day <= :to GROUP BY account_id ORDER BY items DESC, account_id LIMIT :n""")
                .param("from", from).param("to", to).param("n", Math.max(1, Math.min(limit, 100))).query(ActivityStore::activity).list();
    }

    /** Totals for some accounts since {@code from} (accounts without activity are absent). */
    List<AccountActivity> of(List<UUID> accountIds, LocalDate from) { return of(accountIds, from, today()); }

    List<AccountActivity> of(List<UUID> accountIds, LocalDate from, LocalDate to) {
        if (accountIds.isEmpty()) return List.of();
        return jdbc.sql("""
                SELECT account_id, sum(items) AS items, count(*) AS days, max(day) AS last_day FROM account_activity_daily
                WHERE day >= :from AND day <= :to AND account_id IN (:ids) GROUP BY account_id""")
                .param("from", from).param("to", to).param("ids", accountIds).query(ActivityStore::activity).list();
    }

    /** People per activity level since {@code from}: active-day thresholds for high and medium. */
    record LevelCounts(long high, long medium, long low) {}

    LevelCounts levels(LocalDate from, int highDays, int mediumDays) { return levels(from, today(), highDays, mediumDays); }

    LevelCounts levels(LocalDate from, LocalDate to, int highDays, int mediumDays) {
        return jdbc.sql("""
                SELECT count(*) FILTER (WHERE days >= :h) AS high, count(*) FILTER (WHERE days < :h AND days >= :m) AS medium,
                       count(*) FILTER (WHERE days < :m) AS low
                FROM (SELECT account_id, count(*) AS days FROM account_activity_daily WHERE day >= :from AND day <= :to GROUP BY account_id) a""")
                .param("from", from).param("to", to).param("h", highDays).param("m", mediumDays)
                .query((rs, i) -> new LevelCounts(rs.getLong("high"), rs.getLong("medium"), rs.getLong("low"))).single();
    }

    /** One account's daily items since {@code from}. */
    List<AccountDay> account(UUID accountId, LocalDate from) { return account(accountId, from, today()); }

    List<AccountDay> account(UUID accountId, LocalDate from, LocalDate to) {
        return jdbc.sql("SELECT day, items, opened, web, android FROM account_activity_daily WHERE account_id = :a AND day >= :from AND day <= :to ORDER BY day")
                .param("a", accountId).param("from", from).param("to", to).query((rs, i) -> new AccountDay(rs.getObject("day", LocalDate.class), rs.getLong("items"),
                        rs.getBoolean("opened"), rs.getBoolean("web"), rs.getBoolean("android"))).list();
    }

    private static AccountActivity activity(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new AccountActivity(rs.getObject("account_id", UUID.class), rs.getLong("items"), rs.getInt("days"), rs.getObject("last_day", LocalDate.class));
    }
}
