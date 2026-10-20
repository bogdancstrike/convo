ALTER TABLE enrollment_reservations DROP CONSTRAINT enrollment_reservations_purpose_check;
ALTER TABLE enrollment_reservations ADD CONSTRAINT enrollment_reservations_purpose_check CHECK (purpose IN ('primary','link','recovery'));
CREATE TABLE account_recovery (
    account_id uuid PRIMARY KEY REFERENCES accounts ON DELETE CASCADE,
    ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 29 AND 8192),
    authorization_hash bytea NOT NULL CHECK (octet_length(authorization_hash)=32),
    updated_at timestamptz NOT NULL DEFAULT now()
);
