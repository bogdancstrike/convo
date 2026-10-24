package com.enclave.attachments.internal;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for the {@code attachments} registry. */
@Repository
class AttachmentRepository {

    private final JdbcClient jdbc;

    AttachmentRepository(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    void insert(UUID id, String objectKey, long size, Instant expiresAt) {
        jdbc.sql("INSERT INTO attachments (attachment_id, object_key, size_bytes, expires_at) VALUES (:id, :k, :s, :e)")
                .param("id", id).param("k", objectKey).param("s", size).param("e", Timestamp.from(expiresAt))
                .update();
    }

    void insertMultipart(UUID id, String objectKey, long size, Instant expiresAt, String uploadId, byte[] secretHash, Instant deadline) {
        jdbc.sql("""
                INSERT INTO attachments (attachment_id, object_key, size_bytes, expires_at, upload_id, upload_secret_hash, upload_deadline)
                VALUES (:id, :k, :s, :e, :u, :h, :d)""")
                .param("id", id).param("k", objectKey).param("s", size).param("e", Timestamp.from(expiresAt))
                .param("u", uploadId).param("h", secretHash).param("d", Timestamp.from(deadline)).update();
    }

    /** An open or completed multipart upload. */
    record Multipart(String objectKey, long size, String uploadId, byte[] secretHash, Instant deadline, boolean completed) {}

    Optional<Multipart> findMultipart(UUID id) {
        return jdbc.sql("""
                SELECT object_key, size_bytes, upload_id, upload_secret_hash, upload_deadline, completed_at IS NOT NULL AS done
                FROM attachments WHERE attachment_id = :id AND upload_id IS NOT NULL""")
                .param("id", id)
                .query((rs, i) -> new Multipart(rs.getString(1), rs.getLong(2), rs.getString(3), rs.getBytes(4), rs.getTimestamp(5).toInstant(), rs.getBoolean(6)))
                .optional();
    }

    void markCompleted(UUID id) {
        jdbc.sql("UPDATE attachments SET completed_at = now() WHERE attachment_id = :id AND completed_at IS NULL").param("id", id).update();
    }

    /** Incomplete multipart uploads past their deadline: (object key, upload ID). */
    List<String[]> abandonedMultiparts(int limit) {
        return jdbc.sql("""
                SELECT object_key, upload_id FROM attachments
                WHERE upload_id IS NOT NULL AND completed_at IS NULL AND upload_deadline < now() ORDER BY upload_deadline LIMIT :l""")
                .param("l", limit).query((rs, i) -> new String[] {rs.getString(1), rs.getString(2)}).list();
    }

    /** @return object key of a retained attachment (multipart uploads only once completed) */
    Optional<String> findLiveObjectKey(UUID id) {
        return jdbc.sql("SELECT object_key FROM attachments WHERE attachment_id = :id AND (upload_id IS NULL OR completed_at IS NOT NULL)")
                .param("id", id).query(String.class).optional();
    }

    /** @return up to {@code limit} expired object keys */
    List<String> expiredObjectKeys(int limit) {
        return jdbc.sql("SELECT object_key FROM attachments WHERE expires_at < now() ORDER BY expires_at LIMIT :l")
                .param("l", limit).query(String.class).list();
    }

    void deleteByObjectKey(String objectKey) {
        jdbc.sql("DELETE FROM attachments WHERE object_key = :k").param("k", objectKey).update();
    }
}
