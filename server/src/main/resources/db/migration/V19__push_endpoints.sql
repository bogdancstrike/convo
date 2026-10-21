-- UnifiedPush endpoints per device (MSG-02). Endpoint URLs are capability-like: treat as secrets.
CREATE TABLE push_endpoints (
    account_id  uuid        NOT NULL,
    device_id   int         NOT NULL,
    endpoint    text        NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, device_id)
);
