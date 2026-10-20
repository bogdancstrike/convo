package com.enclave.identity.internal.enrollment;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for {@code enrollment_reservations}. */
@Repository
class ReservationRepository {

    private final JdbcClient jdbc;

    ReservationRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void insert(Reservation r) {
        jdbc.sql("""
                INSERT INTO enrollment_reservations (reservation_id, account_id, device_id, purpose, challenge, expires_at)
                VALUES (:id, :a, :d, :p, :c, :e)""")
                .param("id", r.reservationId()).param("a", r.accountId()).param("d", r.deviceId())
                .param("p", r.purpose()).param("c", r.challenge()).param("e", Timestamp.from(r.expiresAt()))
                .update();
    }

    /** Loads a reservation with a row lock so consumption is serialized. */
    Optional<Reservation> lock(UUID reservationId) {
        return select(reservationId, " FOR UPDATE");
    }

    /** Loads a reservation without locking (read-only use). */
    Optional<Reservation> find(UUID reservationId) {
        return select(reservationId, "");
    }

    private Optional<Reservation> select(UUID reservationId, String suffix) {
        return jdbc.sql("""
                SELECT reservation_id, account_id, device_id, purpose, challenge, expires_at, consumed_at, accepted_key
                  FROM enrollment_reservations WHERE reservation_id = :id""" + suffix)
                .param("id", reservationId)
                .query((rs, i) -> {
                    Timestamp consumed = rs.getTimestamp("consumed_at");
                    return new Reservation(rs.getObject("reservation_id", UUID.class),
                            rs.getObject("account_id", UUID.class), rs.getInt("device_id"), rs.getString("purpose"),
                            rs.getBytes("challenge"), rs.getTimestamp("expires_at").toInstant(),
                            consumed == null ? null : consumed.toInstant(), rs.getBytes("accepted_key"));
                })
                .optional();
    }

    void markConsumed(UUID reservationId, byte[] acceptedKey, Instant at) {
        jdbc.sql("UPDATE enrollment_reservations SET consumed_at = :t, accepted_key = :k WHERE reservation_id = :id")
                .param("t", Timestamp.from(at)).param("k", acceptedKey).param("id", reservationId)
                .update();
    }

    /** Deletes unconsumed reservations that expired; consumed rows remain as replay tombstones. */
    int purgeExpired() {
        return jdbc.sql("DELETE FROM enrollment_reservations WHERE consumed_at IS NULL AND expires_at < now() - interval '1 day'")
                .update();
    }
}
