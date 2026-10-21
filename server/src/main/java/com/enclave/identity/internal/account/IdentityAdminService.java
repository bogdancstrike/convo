package com.enclave.identity.internal.account;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.IdentityAdminApi;
import com.enclave.identity.internal.device.DeviceService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** {@link IdentityAdminApi} over the identity tables (metadata only). */
@Service
class IdentityAdminService implements IdentityAdminApi {
    private static final String SUMMARY = """
            SELECT a.account_id, a.username, a.display_name, a.status, a.created_at,
                   (SELECT count(*) FROM devices d WHERE d.account_id = a.account_id AND d.revoked_at IS NULL) AS active_devices,
                   (SELECT max(d.last_seen_day) FROM devices d WHERE d.account_id = a.account_id) AS last_seen_day
            FROM accounts a""";
    private final JdbcClient jdbc;
    private final DeviceService devices;

    IdentityAdminService(JdbcClient jdbc, DeviceService devices) {
        this.jdbc = jdbc;
        this.devices = devices;
    }

    @Override
    @Transactional(readOnly = true)
    public List<AccountSummary> searchAccounts(String query, int limit) {
        String q = "%" + (query == null ? "" : query.strip().toLowerCase(Locale.ROOT).replace("%", "").replace("_", "")) + "%";
        return jdbc.sql(SUMMARY + " WHERE lower(a.username) LIKE :q OR lower(coalesce(a.display_name, '')) LIKE :q ORDER BY a.username LIMIT :limit")
                .param("q", q).param("limit", Math.max(1, Math.min(limit, 200))).query(IdentityAdminService::summary).list();
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<AccountSummary> account(UUID accountId) {
        return jdbc.sql(SUMMARY + " WHERE a.account_id = :id").param("id", accountId).query(IdentityAdminService::summary).optional();
    }

    @Override
    @Transactional(readOnly = true)
    public List<DeviceSummary> devices(UUID accountId) {
        return devices.listActive(accountId).stream()
                .map(d -> new DeviceSummary(d.deviceId(), d.platform(), d.createdAt(), d.lastSeenDay())).toList();
    }

    @Override
    @Transactional
    public void setDisabled(UUID accountId, boolean disabled) {
        int updated = jdbc.sql("UPDATE accounts SET status = :s WHERE account_id = :id").param("s", disabled ? "disabled" : "active").param("id", accountId).update();
        if (updated == 0) throw new EnclaveException(ErrorCode.NOT_FOUND, "unknown account");
    }

    @Override
    public void revokeDevice(UUID accountId, int deviceId, String reason) {
        devices.revoke(accountId, deviceId, reason);
    }

    @Override
    @Transactional(readOnly = true)
    public DirectoryStats directoryStats(LocalDate today) {
        return jdbc.sql("""
                WITH seen AS (SELECT account_id, max(last_seen_day) AS day FROM devices GROUP BY account_id)
                SELECT (SELECT count(*) FROM accounts) AS accounts,
                       (SELECT count(*) FROM accounts WHERE status = 'disabled') AS disabled,
                       (SELECT count(*) FROM devices WHERE revoked_at IS NULL) AS devices,
                       (SELECT count(*) FROM seen WHERE day >= :today) AS seen_today,
                       (SELECT count(*) FROM seen WHERE day >= :d7) AS seen_7d,
                       (SELECT count(*) FROM seen WHERE day >= :d30) AS seen_30d""")
                .param("today", today).param("d7", today.minusDays(6)).param("d30", today.minusDays(29))
                .query((rs, i) -> new DirectoryStats(rs.getLong("accounts"), rs.getLong("disabled"), rs.getLong("devices"),
                        rs.getLong("seen_today"), rs.getLong("seen_7d"), rs.getLong("seen_30d"))).single();
    }

    @Override
    @Transactional(readOnly = true)
    public List<DayCount> newAccountsPerDay(LocalDate from) {
        return jdbc.sql("SELECT created_at::date AS day, count(*) AS n FROM accounts WHERE created_at >= :from GROUP BY 1 ORDER BY 1")
                .param("from", from).query((rs, i) -> new DayCount(rs.getObject("day", LocalDate.class), rs.getLong("n"))).list();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AccountSummary> leastRecentlySeen(int limit) {
        return jdbc.sql("SELECT * FROM (" + SUMMARY + " WHERE a.status = 'active') s ORDER BY s.last_seen_day ASC NULLS FIRST, s.username LIMIT :limit")
                .param("limit", Math.max(1, Math.min(limit, 100))).query(IdentityAdminService::summary).list();
    }

    @Override
    @Transactional(readOnly = true)
    public List<AccountSummary> accounts(Collection<UUID> accountIds) {
        if (accountIds.isEmpty()) return List.of();
        return jdbc.sql(SUMMARY + " WHERE a.account_id IN (:ids)").param("ids", List.copyOf(accountIds)).query(IdentityAdminService::summary).list();
    }

    @Override
    @Transactional(readOnly = true)
    public Map<String, UUID> accountsBySubject(Collection<String> subjects) {
        if (subjects.isEmpty()) return Map.of();
        Map<String, UUID> out = new HashMap<>();
        jdbc.sql("SELECT oidc_subject, account_id FROM accounts WHERE oidc_subject IN (:s)").param("s", List.copyOf(subjects))
                .query(rs -> { out.put(rs.getString("oidc_subject"), rs.getObject("account_id", UUID.class)); });
        return out;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<String> subject(UUID accountId) {
        return jdbc.sql("SELECT oidc_subject FROM accounts WHERE account_id = :id").param("id", accountId).query(String.class).optional();
    }

    @Override
    @Transactional
    public boolean revokeRecovery(UUID accountId) {
        return jdbc.sql("DELETE FROM account_recovery WHERE account_id = :id").param("id", accountId).update() > 0;
    }

    private static AccountSummary summary(ResultSet rs, int row) throws SQLException {
        return new AccountSummary(rs.getObject("account_id", UUID.class), rs.getString("username"), rs.getString("display_name"),
                rs.getString("status"), rs.getInt("active_devices"), rs.getTimestamp("created_at").toInstant(), rs.getObject("last_seen_day", LocalDate.class));
    }
}
