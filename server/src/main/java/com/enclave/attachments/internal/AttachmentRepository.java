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

    /** @return object key of an unexpired attachment */
    Optional<String> findLiveObjectKey(UUID id) {
        return jdbc.sql("SELECT object_key FROM attachments WHERE attachment_id = :id AND expires_at > now()")
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
