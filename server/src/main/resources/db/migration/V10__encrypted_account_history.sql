-- Account archive contains only client-encrypted payloads, independent of mailbox retention.
CREATE TABLE account_history_heads (
    account_id uuid PRIMARY KEY,
    next_seq bigint NOT NULL DEFAULT 1
);
CREATE TABLE account_history (
    account_id uuid NOT NULL,
    seq bigint NOT NULL,
    entry_id uuid NOT NULL,
    ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 29 AND 262144),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, seq),
    UNIQUE (account_id, entry_id)
);
