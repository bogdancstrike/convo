-- Operator statistics (ADM-01): encrypted items each account sent per UTC day. Only a count —
-- no recipients, conversations, sizes or content — and the server cannot tell messages from
-- receipts, reactions or typing signals. Kept for enclave.admin.activity.retention (default 90 d).
CREATE TABLE account_activity_daily (
    account_id  uuid    NOT NULL,
    day         date    NOT NULL,
    items       integer NOT NULL CHECK (items >= 0),
    PRIMARY KEY (account_id, day)
);
CREATE INDEX account_activity_daily_day ON account_activity_daily (day);
