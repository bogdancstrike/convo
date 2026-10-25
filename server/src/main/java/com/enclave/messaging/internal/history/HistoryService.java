package com.enclave.messaging.internal.history;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.security.MessageDigest;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Durable account-owned encrypted archive; it never interprets plaintext or encryption keys. */
@Service
class HistoryService {
    private final JdbcClient jdbc;
    private final org.springframework.context.ApplicationEventPublisher events;
    HistoryService(JdbcClient jdbc, org.springframework.context.ApplicationEventPublisher events) { this.jdbc = jdbc; this.events = events; }
    record Entry(long seq, UUID id, byte[] ciphertext) {}

    @Transactional
    void append(com.enclave.contracts.DeviceAddress device, UUID id, byte[] ciphertext) {
        UUID account = device.accountId();
        if (ciphertext == null || ciphertext.length < 29 || ciphertext.length > 262144) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "archive entry size out of range");
        }
        jdbc.sql("INSERT INTO account_history_heads(account_id) VALUES (:a) ON CONFLICT DO NOTHING").param("a", account).update();
        // Allocate while holding the account lock, preventing pagination past uncommitted entries.
        long seq = jdbc.sql("SELECT next_seq FROM account_history_heads WHERE account_id=:a FOR UPDATE")
                .param("a", account).query(Long.class).single();
        var prior = jdbc.sql("SELECT ciphertext FROM account_history WHERE account_id=:a AND entry_id=:i")
                .param("a", account).param("i", id).query(byte[].class).optional();
        if (prior.isPresent()) {
            if (!MessageDigest.isEqual(prior.get(), ciphertext)) {
                throw new EnclaveException(ErrorCode.IDEMPOTENCY_CONFLICT, "archive entry ID already used");
            }
            return;
        }
        jdbc.sql("INSERT INTO account_history(account_id,seq,entry_id,ciphertext) VALUES (:a,:s,:i,:c)")
                .param("a", account).param("s", seq).param("i", id).param("c", ciphertext).update();
        jdbc.sql("UPDATE account_history_heads SET next_seq=next_seq+1 WHERE account_id=:a").param("a", account).update();
        events.publishEvent(new HistoryAppended(device)); // other devices pull after commit
    }

    @Transactional(readOnly = true)
    List<Entry> page(UUID account, long after) {
        if (after < 0) throw new EnclaveException(ErrorCode.INVALID_REQUEST, "invalid archive cursor");
        return jdbc.sql("SELECT seq,entry_id,ciphertext FROM account_history WHERE account_id=:a AND seq>:s ORDER BY seq LIMIT 100")
                .param("a", account).param("s", after)
                .query((rs, i) -> new Entry(rs.getLong(1), rs.getObject(2, UUID.class), rs.getBytes(3))).list();
    }
}
