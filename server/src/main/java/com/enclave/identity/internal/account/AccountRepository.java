package com.enclave.identity.internal.account;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for the {@code accounts} table. All methods must run on the primary. */
@Repository
public class AccountRepository {

    private static final String COLUMNS =
            "account_id, username, device_list_version, identity_key, status, display_name, phone,"
            // Unqualified oidc_subject resolves to the outer row (account_guests has no such column).
            + " (SELECT g.expires_at FROM account_guests g WHERE g.subject = oidc_subject) AS guest_until";

    private final JdbcClient jdbc;

    AccountRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param issuer OIDC issuer
     * @param subject OIDC subject
     * @return account mapped to this external identity
     */
    public Optional<Account> findByOidc(String issuer, String subject) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM accounts WHERE oidc_issuer = :iss AND oidc_subject = :sub")
                .param("iss", issuer).param("sub", subject)
                .query(AccountRepository::map).optional();
    }

    /**
     * @param accountId account ID
     * @return the account, if present
     */
    public Optional<Account> findById(UUID accountId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM accounts WHERE account_id = :id")
                .param("id", accountId).query(AccountRepository::map).optional();
    }

    /**
     * @param accountId account ID
     * @return the account's OIDC subject ({@code sub}) at the canonical issuer, if present
     */
    public Optional<String> findOidcSubject(UUID accountId) {
        return jdbc.sql("SELECT oidc_subject FROM accounts WHERE account_id = :id")
                .param("id", accountId).query(String.class).optional();
    }

    /**
     * Loads the account row with {@code FOR UPDATE}, serializing device-list mutations.
     *
     * @param accountId account ID
     * @return locked account
     */
    public Optional<Account> lock(UUID accountId) {
        return jdbc.sql("SELECT " + COLUMNS + " FROM accounts WHERE account_id = :id FOR UPDATE")
                .param("id", accountId).query(AccountRepository::map).optional();
    }

    /** @return {@code true} if the handle is already taken (case-insensitive) */
    public boolean usernameExists(String username) {
        return jdbc.sql("SELECT EXISTS (SELECT 1 FROM accounts WHERE username = :u)")
                .param("u", username).query(Boolean.class).single();
    }

    /**
     * Inserts a new account, ignoring a concurrent insert of the same OIDC identity.
     *
     * @return {@code true} if this call created the row
     */
    public boolean insert(UUID accountId, String issuer, String subject, String username) {
        return jdbc.sql("""
                INSERT INTO accounts (account_id, oidc_issuer, oidc_subject, username)
                VALUES (:id, :iss, :sub, :u)
                ON CONFLICT (oidc_issuer, oidc_subject) DO NOTHING""")
                .param("id", accountId).param("iss", issuer).param("sub", subject).param("u", username)
                .update() == 1;
    }

    /**
     * Atomically allocates the next never-reused device ID.
     *
     * @return allocated device ID
     */
    public int allocateDeviceId(UUID accountId) {
        return jdbc.sql("""
                UPDATE accounts SET next_device_id = next_device_id + 1
                 WHERE account_id = :id RETURNING next_device_id - 1""")
                .param("id", accountId).query(Integer.class).single();
    }

    /** Sets the account identity key (first registration or explicit re-registration). */
    public void setIdentityKey(UUID accountId, byte[] identityKey) {
        jdbc.sql("UPDATE accounts SET identity_key = :ik WHERE account_id = :id")
                .param("ik", identityKey).param("id", accountId).update();
    }

    /**
     * Increments the device-list version.
     *
     * @return the new version
     */
    public long bumpDeviceListVersion(UUID accountId) {
        return jdbc.sql("""
                UPDATE accounts SET device_list_version = device_list_version + 1
                 WHERE account_id = :id RETURNING device_list_version""")
                .param("id", accountId).query(Long.class).single();
    }

    private static Account map(ResultSet rs, int row) throws SQLException {
        return new Account(rs.getObject("account_id", UUID.class), rs.getString("username"),
                rs.getLong("device_list_version"), rs.getBytes("identity_key"), rs.getString("status"),
                rs.getString("display_name"), rs.getString("phone"),
                java.util.Optional.ofNullable(rs.getTimestamp("guest_until")).map(java.sql.Timestamp::toInstant).orElse(null));
    }

    /** Updates IdP-sourced directory attributes; no-op when unchanged. */
    public void updateDirectory(UUID accountId, String displayName, String phone) {
        jdbc.sql("""
                UPDATE accounts SET display_name = :n, phone = :p, phone_digits = :d, search_text = :s
                 WHERE account_id = :id
                   AND (display_name IS DISTINCT FROM :n OR phone IS DISTINCT FROM :p)""")
                .param("n", displayName).param("p", phone).param("d", DirectoryText.phoneDigits(phone))
                .param("s", DirectoryText.fold(displayName)).param("id", accountId)
                .update();
    }

    /**
     * Directory search by handle prefix or name (word-prefix, diacritic-insensitive) over active
     * accounts with at least one active device.
     */
    public List<Account> searchByName(String folded, int limit) {
        String like = escapeLike(folded);
        return jdbc.sql("SELECT " + COLUMNS + """
                 FROM accounts a
                WHERE a.status = 'active'
                  AND (a.username LIKE :prefix OR a.search_text LIKE :prefix OR a.search_text LIKE :word)
                  AND EXISTS (SELECT 1 FROM devices d WHERE d.account_id = a.account_id AND d.revoked_at IS NULL)
                ORDER BY (a.username LIKE :prefix) DESC, a.search_text, a.username LIMIT :l""")
                .param("prefix", like + "%").param("word", "% " + like + "%").param("l", limit)
                .query(AccountRepository::map).list();
    }

    /** Directory search by phone digits (substring, so national/international forms both match). */
    public List<Account> searchByPhone(String digits, int limit) {
        return jdbc.sql("SELECT " + COLUMNS + """
                 FROM accounts a
                WHERE a.status = 'active' AND a.phone_digits LIKE :q
                  AND EXISTS (SELECT 1 FROM devices d WHERE d.account_id = a.account_id AND d.revoked_at IS NULL)
                ORDER BY a.search_text, a.username LIMIT :l""")
                .param("q", "%" + digits + "%").param("l", limit)
                .query(AccountRepository::map).list();
    }

    private static String escapeLike(String value) {
        return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_");
    }
}
