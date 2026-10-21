package com.enclave.identity.internal.account;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.IdentityAdminApi;
import com.enclave.identity.internal.device.DeviceService;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
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
            SELECT a.account_id, a.username, a.display_name, a.status,
                   (SELECT count(*) FROM devices d WHERE d.account_id = a.account_id AND d.revoked_at IS NULL) AS active_devices
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

    private static AccountSummary summary(ResultSet rs, int row) throws SQLException {
        return new AccountSummary(rs.getObject("account_id", UUID.class), rs.getString("username"), rs.getString("display_name"),
                rs.getString("status"), rs.getInt("active_devices"));
    }
}
