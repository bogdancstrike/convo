package com.enclave.contracts;

/** Aggregate operational telemetry: no account, device, content, object or recipient identifiers. */
public record HandledOperation(Kind kind) {
    public enum Kind { CALL_STARTED, UPLOAD_STARTED }
}
