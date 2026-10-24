-- Operational counts per UTC minute, intentionally without account or recipient dimensions.
CREATE TABLE admin_throughput_minute (
    minute timestamptz PRIMARY KEY,
    items bigint NOT NULL DEFAULT 0,
    calls bigint NOT NULL DEFAULT 0,
    uploads bigint NOT NULL DEFAULT 0
);
CREATE TABLE admin_throughput_start (
    singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
    started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin_throughput_start(singleton) VALUES (true);
