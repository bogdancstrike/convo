package com.enclave.messaging.internal.gateway;

import com.enclave.contracts.DeviceAddress;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for {@code ws_tickets}; only ticket hashes are stored. */
@Repository
class TicketRepository {

    private final JdbcClient jdbc;

    TicketRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void insert(byte[] hash, DeviceAddress device, String origin, Instant expiresAt) {
        jdbc.sql("INSERT INTO ws_tickets (ticket_hash, account_id, device_id, origin, expires_at) VALUES (:h, :a, :d, :o, :e)")
                .param("h", hash).param("a", device.accountId()).param("d", device.deviceId())
                .param("o", origin).param("e", Timestamp.from(expiresAt))
                .update();
    }

    /** Atomically consumes an unexpired ticket. */
    Optional<Consumed> consume(byte[] hash) {
        return jdbc.sql("DELETE FROM ws_tickets WHERE ticket_hash = :h AND expires_at > now() RETURNING account_id, device_id, origin")
                .param("h", hash)
                .query((rs, i) -> new Consumed(new DeviceAddress(rs.getObject(1, UUID.class), rs.getInt(2)), rs.getString(3)))
                .optional();
    }

    int purgeExpired() {
        return jdbc.sql("DELETE FROM ws_tickets WHERE expires_at < now()").update();
    }

    record Consumed(DeviceAddress device, String origin) {}
}
