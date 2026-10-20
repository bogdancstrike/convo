package com.enclave.identity.internal.provisioning;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for {@code provisioning_sessions}. */
@Repository
class ProvisioningRepository {

    private static final String COLUMNS = """
            provisioning_id, account_id, reservation_id, ephemeral_public, client_label, status, code_hash,
            approver_device, message_public, message, created_at, expires_at""";

    private final JdbcClient jdbc;

    ProvisioningRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void insert(ProvisioningSession s) {
        jdbc.sql("""
                INSERT INTO provisioning_sessions (provisioning_id, account_id, reservation_id, ephemeral_public,
                                                   client_label, expires_at)
                VALUES (:id, :a, :r, :e, :l, :x)""")
                .param("id", s.provisioningId()).param("a", s.accountId()).param("r", s.reservationId())
                .param("e", s.ephemeralPublic()).param("l", s.clientLabel()).param("x", Timestamp.from(s.expiresAt()))
                .update();
    }

    Optional<ProvisioningSession> find(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM provisioning_sessions WHERE provisioning_id = :id")
                .param("id", id).query(ProvisioningRepository::map).optional();
    }

    Optional<ProvisioningSession> lock(UUID id) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM provisioning_sessions WHERE provisioning_id = :id FOR UPDATE")
                .param("id", id).query(ProvisioningRepository::map).optional();
    }

    List<ProvisioningSession> openForAccount(UUID accountId) {
        return jdbc.sql("SELECT " + COLUMNS + """
                 FROM provisioning_sessions
                WHERE account_id = :a AND status IN ('pending', 'approved') AND expires_at > now()
                ORDER BY created_at""")
                .param("a", accountId).query(ProvisioningRepository::map).list();
    }

    void setCode(UUID id, byte[] codeHash, int approverDevice) {
        jdbc.sql("UPDATE provisioning_sessions SET code_hash = :h, approver_device = :d WHERE provisioning_id = :id")
                .param("h", codeHash).param("d", approverDevice).param("id", id).update();
    }

    void setMessage(UUID id, byte[] messagePublic, byte[] message) {
        jdbc.sql("""
                UPDATE provisioning_sessions SET message_public = :p, message = :m, status = 'approved'
                 WHERE provisioning_id = :id""")
                .param("p", messagePublic).param("m", message).param("id", id).update();
    }

    void setStatus(UUID id, String status) {
        jdbc.sql("UPDATE provisioning_sessions SET status = :s WHERE provisioning_id = :id")
                .param("s", status).param("id", id).update();
    }

    /** Removes the relayed ciphertext once the session finished (it contains the account IK). */
    void clearMessage(UUID id) {
        jdbc.sql("UPDATE provisioning_sessions SET message = NULL, message_public = NULL WHERE provisioning_id = :id")
                .param("id", id).update();
    }

    int purgeExpired() {
        return jdbc.sql("DELETE FROM provisioning_sessions WHERE expires_at < now() - interval '1 day'").update();
    }

    private static ProvisioningSession map(ResultSet rs, int row) throws SQLException {
        Integer approver = rs.getObject("approver_device", Integer.class);
        return new ProvisioningSession(rs.getObject("provisioning_id", UUID.class), rs.getObject("account_id", UUID.class),
                rs.getObject("reservation_id", UUID.class), rs.getBytes("ephemeral_public"), rs.getString("client_label"),
                rs.getString("status"), rs.getBytes("code_hash"), approver,
                rs.getBytes("message_public"), rs.getBytes("message"), rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("expires_at").toInstant());
    }
}
