package com.enclave.communities.internal;

import com.enclave.communities.CommunitiesApi;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/** {@link CommunitiesApi} over the community tables. */
@Service
class CommunitiesApiAdapter implements CommunitiesApi {
    private final JdbcClient jdbc;

    CommunitiesApiAdapter(JdbcClient jdbc) { this.jdbc = jdbc; }

    @Override
    public long count() { return jdbc.sql("SELECT count(*) FROM communities").query(Long.class).single(); }
}
