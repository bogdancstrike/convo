package com.enclave.communities.internal;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

/** Data access for {@code communities} and {@code community_group_links}. */
@Repository
class CommunityRepository {
    record Community(UUID communityId, byte[] rootGroupId, long version) {}
    record Link(UUID communityId, byte[] groupId, String visibility, String status, UUID proposedBy, long version) {}

    private final JdbcClient jdbc;
    CommunityRepository(JdbcClient jdbc) { this.jdbc = jdbc; }

    void insert(UUID id, byte[] rootGroupId, UUID createdBy) {
        jdbc.sql("INSERT INTO communities (community_id, root_group_id, created_by) VALUES (:id, :g, :by)")
                .param("id", id).param("g", rootGroupId).param("by", createdBy).update();
    }

    Optional<Community> find(UUID id) {
        return jdbc.sql("SELECT community_id, root_group_id, version FROM communities WHERE community_id = :id").param("id", id)
                .query((rs, i) -> new Community(rs.getObject(1, UUID.class), rs.getBytes(2), rs.getLong(3))).optional();
    }

    List<Community> all() {
        return jdbc.sql("SELECT community_id, root_group_id, version FROM communities ORDER BY created_at")
                .query((rs, i) -> new Community(rs.getObject(1, UUID.class), rs.getBytes(2), rs.getLong(3))).list();
    }

    boolean isRoot(byte[] groupId) {
        return jdbc.sql("SELECT count(*) FROM communities WHERE root_group_id = :g").param("g", groupId).query(Long.class).single() > 0;
    }

    Optional<Link> linkOf(byte[] groupId) {
        return jdbc.sql("SELECT community_id, group_id, visibility, status, proposed_by, version FROM community_group_links WHERE group_id = :g")
                .param("g", groupId).query(CommunityRepository::link).optional();
    }

    List<Link> links(UUID communityId) {
        return jdbc.sql("SELECT community_id, group_id, visibility, status, proposed_by, version FROM community_group_links WHERE community_id = :c ORDER BY updated_at")
                .param("c", communityId).query(CommunityRepository::link).list();
    }

    long countLinks(UUID communityId) {
        return jdbc.sql("SELECT count(*) FROM community_group_links WHERE community_id = :c").param("c", communityId).query(Long.class).single();
    }

    void propose(UUID communityId, byte[] groupId, String visibility, UUID by, boolean accepted) {
        jdbc.sql("""
                INSERT INTO community_group_links (community_id, group_id, visibility, status, proposed_by, accepted_by)
                VALUES (:c, :g, :v, :s, :by, :acc)""")
                .param("c", communityId).param("g", groupId).param("v", visibility).param("s", accepted ? "active" : "proposed")
                .param("by", by).param("acc", accepted ? by : null).update();
        bump(communityId);
    }

    void accept(UUID communityId, byte[] groupId, UUID by) {
        jdbc.sql("UPDATE community_group_links SET status = 'active', accepted_by = :by, version = version + 1, updated_at = now() WHERE community_id = :c AND group_id = :g")
                .param("c", communityId).param("g", groupId).param("by", by).update();
        bump(communityId);
    }

    void unlink(UUID communityId, byte[] groupId) {
        jdbc.sql("DELETE FROM community_group_links WHERE community_id = :c AND group_id = :g").param("c", communityId).param("g", groupId).update();
        bump(communityId);
    }

    private void bump(UUID communityId) {
        jdbc.sql("UPDATE communities SET version = version + 1 WHERE community_id = :c").param("c", communityId).update();
    }

    private static Link link(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Link(rs.getObject(1, UUID.class), rs.getBytes(2), rs.getString(3), rs.getString(4), rs.getObject(5, UUID.class), rs.getLong(6));
    }
}
