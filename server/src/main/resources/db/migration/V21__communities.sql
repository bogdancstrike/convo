-- Communities (COM-01, specs §30.3). Opaque IDs and relationships only: names, descriptions,
-- rules and announcements stay end-to-end encrypted in the root/subgroup MLS groups.
CREATE TABLE communities (
    community_id   uuid        PRIMARY KEY,
    root_group_id  bytea       NOT NULL UNIQUE,
    created_by     uuid        NOT NULL,
    version        bigint      NOT NULL DEFAULT 1,
    created_at     timestamptz NOT NULL DEFAULT now()
);

-- A P0 subgroup has at most one parent (UNIQUE group_id), never a root (checked in code).
CREATE TABLE community_group_links (
    community_id  uuid        NOT NULL REFERENCES communities ON DELETE CASCADE,
    group_id      bytea       NOT NULL UNIQUE,
    visibility    text        NOT NULL CHECK (visibility IN ('discoverable', 'private')),
    status        text        NOT NULL CHECK (status IN ('proposed', 'active')),
    proposed_by   uuid        NOT NULL,
    accepted_by   uuid,
    version       bigint      NOT NULL DEFAULT 1,
    updated_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (community_id, group_id)
);
