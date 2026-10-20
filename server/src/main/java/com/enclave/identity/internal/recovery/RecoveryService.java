package com.enclave.identity.internal.recovery;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** The server holds an encrypted identity backup and a one-way authorization verifier only. */
@Service
public class RecoveryService {
    private final JdbcClient jdbc;
    public RecoveryService(JdbcClient jdbc) { this.jdbc = jdbc; }

    @Transactional
    public void save(UUID accountId, byte[] ciphertext, byte[] authorizationHash) {
        if (ciphertext.length < 29 || ciphertext.length > 8192 || authorizationHash.length != 32) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "invalid recovery backup");
        }
        jdbc.sql("""
                INSERT INTO account_recovery(account_id,ciphertext,authorization_hash) VALUES (:a,:c,:h)
                ON CONFLICT (account_id) DO UPDATE SET ciphertext=:c,authorization_hash=:h,updated_at=now()
                """)
                .param("a", accountId).param("c", ciphertext).param("h", authorizationHash).update();
    }

    @Transactional(readOnly=true)
    public byte[] backup(UUID accountId) {
        return jdbc.sql("SELECT ciphertext FROM account_recovery WHERE account_id=:a").param("a", accountId)
                .query(byte[].class).optional().orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "recovery has not been configured"));
    }

    @Transactional(readOnly=true)
    public boolean configured(UUID accountId) {
        return jdbc.sql("SELECT EXISTS(SELECT 1 FROM account_recovery WHERE account_id=:a)").param("a", accountId).query(Boolean.class).single();
    }

    /** Caller must separately authenticate the owning Keycloak account. */
    @Transactional(readOnly=true)
    public void authorize(UUID accountId, byte[] authorizationKey) {
        if (authorizationKey.length != 32) throw new EnclaveException(ErrorCode.UNAUTHENTICATED, "recovery code not accepted");
        byte[] expected = jdbc.sql("SELECT authorization_hash FROM account_recovery WHERE account_id=:a")
                .param("a", accountId).query(byte[].class).optional().orElse(new byte[32]);
        try {
            if (!MessageDigest.isEqual(expected, MessageDigest.getInstance("SHA-256").digest(authorizationKey))) {
                throw new EnclaveException(ErrorCode.UNAUTHENTICATED, "recovery code not accepted");
            }
        } catch (NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }
}
