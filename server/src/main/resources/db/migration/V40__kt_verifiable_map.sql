-- Key transparency verifiable map (sparse Merkle tree, account -> newest leaf): its root is signed
-- per head (separate signature, so existing head signatures stay valid for older clients), and
-- witnesses co-sign version 2 (head + map root) after recomputing the map from the log's leaves.
ALTER TABLE kt_heads ADD COLUMN map_root bytea, ADD COLUMN map_signature bytea;
ALTER TABLE kt_cosignatures ADD COLUMN version int NOT NULL DEFAULT 1 CHECK (version IN (1, 2));
