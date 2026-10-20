package com.enclave.messaging;

import com.enclave.contracts.DeviceAddress;

/**
 * An MLS envelope to fan out to group devices, produced by the groups module.
 *
 * @param kind MLS message kind
 * @param source sending device
 * @param groupId MLS group ID (32 bytes)
 * @param epoch epoch the message belongs to
 * @param groupSeq accepted commit sequence (0 for application messages and welcomes)
 * @param content encoded MLSMessage, opaque to the server
 */
public record GroupEnvelope(Kind kind, DeviceAddress source, byte[] groupId, long epoch, long groupSeq, byte[] content) {

    /** MLS envelope kinds (map to the wire {@code Envelope.Type}). */
    public enum Kind {
        /** Group application message. */
        PRIVATE,
        /** Accepted commit. */
        COMMIT,
        /** Welcome for newly added devices. */
        WELCOME,
        /** Standalone proposal. */
        PROPOSAL
    }
}
