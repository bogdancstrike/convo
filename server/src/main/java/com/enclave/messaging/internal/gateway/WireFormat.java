package com.enclave.messaging.internal.gateway;

import static com.enclave.contracts.Base64Url.decode;
import static com.enclave.contracts.Base64Url.encode;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.messaging.internal.mailbox.Envelope;
import com.enclave.messaging.internal.mailbox.EnvelopeType;
import com.enclave.messaging.internal.submission.DirectSend;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * JSON wire format shared by the WebSocket gateway and the REST fallback. Field names mirror the
 * {@code enclave.ws.v1} protobuf schema of specs §9.2 so a later binary encoding is a pure
 * transport change. Binary values are unpadded base64url.
 */
public final class WireFormat {

    private WireFormat() {}

    /** Delivered envelope. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record EnvelopeDto(String guid, String type, UUID sourceAccount, Integer sourceDevice,
            long serverTimestamp, long expiresAt, boolean urgent, String content, String groupId, Long epoch,
            Long groupSeq) {

        /** @return wire form of a stored envelope */
        public static EnvelopeDto of(Envelope e) {
            return new EnvelopeDto(e.guid().toString(), e.type().name(),
                    e.source() == null ? null : e.source().accountId(),
                    e.source() == null ? null : e.source().deviceId(),
                    e.serverTimestamp().toEpochMilli(), e.expiresAt().toEpochMilli(), e.urgent(), encode(e.content()),
                    e.groupId() == null ? null : encode(e.groupId()), e.epoch(), e.groupSeq());
        }
    }

    /** One per-device ciphertext of a send request. */
    public record DeviceMessageDto(int deviceId, int registrationId, String type, String content) {}

    /** Direct send request ({@code SendRequest}). */
    public record SendRequestDto(UUID destination, String submissionId, List<DeviceMessageDto> messages,
            boolean urgent, int transientTtlSeconds) {

        /** @return validated domain command */
        public DirectSend toCommand() {
            if (messages == null) {
                throw new EnclaveException(ErrorCode.INVALID_REQUEST, "messages is required");
            }
            return new DirectSend(destination, decode(submissionId, "submissionId"), messages.stream()
                    .map(m -> new DirectSend.DeviceMessage(m.deviceId(), m.registrationId(),
                            EnvelopeType.parse(m.type()), decode(m.content(), "content")))
                    .toList(), urgent, transientTtlSeconds);
        }
    }

    /** Send outcome ({@code SendResult}); error fields are set on rejection. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SendResultDto(boolean ok, Boolean duplicate, String errorCode, List<?> missingDevices,
            List<?> extraDevices, List<?> staleDevices) {

        /** @return accepted result */
        public static SendResultDto accepted(boolean duplicate) {
            return new SendResultDto(true, duplicate, null, null, null, null);
        }

        /** @return rejected result carrying mismatch details */
        public static SendResultDto rejected(EnclaveException e) {
            Map<String, Object> p = e.properties();
            return new SendResultDto(false, null, e.code().name(), (List<?>) p.get("missing"),
                    (List<?>) p.get("extra"), (List<?>) p.get("stale"));
        }
    }

    /** Client → server frame. Exactly one body field is set. */
    public record ClientFrame(long requestId, SendRequestDto send, AckDto ack, Map<String, Object> ping) {}

    /** Acknowledgement of persisted envelopes. */
    public record AckDto(List<UUID> guids) {}

    /** Server → client frame. Exactly one body field is set. */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record ServerFrame(long requestId, EnvelopeDto envelope, SendResultDto sendResult, Map<String, Object> queueEmpty,
            DirectiveDto directive, Map<String, Object> pong, ErrorDto error) {

        static ServerFrame envelope(EnvelopeDto e) {
            return new ServerFrame(0, e, null, null, null, null, null);
        }

        static ServerFrame sendResult(long requestId, SendResultDto r) {
            return new ServerFrame(requestId, null, r, null, null, null, null);
        }

        static ServerFrame queueDrained() {
            return new ServerFrame(0, null, null, Map.of(), null, null, null);
        }

        static ServerFrame directive(Directive d) {
            return new ServerFrame(0, null, null, null, new DirectiveDto(d.name()), null, null);
        }

        static ServerFrame pong(long requestId) {
            return new ServerFrame(requestId, null, null, null, null, Map.of(), null);
        }

        static ServerFrame error(long requestId, String code, String detail) {
            return new ServerFrame(requestId, null, null, null, null, null, new ErrorDto(code, detail));
        }
    }

    /** Server directive. */
    public record DirectiveDto(String type) {}

    /** Frame-level error. */
    public record ErrorDto(String code, String detail) {}
}
