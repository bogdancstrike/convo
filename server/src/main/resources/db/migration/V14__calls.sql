-- Call authorization records (no media, no content). A direct call stores its two accounts; a
-- group call is authorized against current group membership at token time.
CREATE TABLE calls (
    call_id     uuid PRIMARY KEY,
    room        text NOT NULL UNIQUE,
    created_by  uuid NOT NULL,
    peer        uuid,
    group_id    bytea,
    video       boolean NOT NULL,
    created_at  timestamptz NOT NULL,
    ended_at    timestamptz,
    CHECK ((peer IS NULL) <> (group_id IS NULL))
);
CREATE INDEX calls_created_at ON calls (created_at);
