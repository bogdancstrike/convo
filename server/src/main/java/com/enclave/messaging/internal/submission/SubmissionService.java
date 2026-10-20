package com.enclave.messaging.internal.submission;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.contracts.Uuids;
import com.enclave.identity.DeviceRoster;
import com.enclave.identity.IdentityApi;
import com.enclave.messaging.internal.MessagingProperties;
import com.enclave.messaging.internal.mailbox.Envelope;
import com.enclave.messaging.internal.mailbox.EnvelopeType;
import com.enclave.messaging.internal.mailbox.MailboxRepository;
import com.enclave.messaging.internal.submission.DirectSend.DeviceMessage;
import java.io.ByteArrayOutputStream;
import java.io.DataOutputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Idempotent direct submission (specs §5.3, §26.1; task MSG-01).
 *
 * <p>In one transaction: dedupe by {@code (origin device, submission_id)} and payload digest,
 * validate the destination's active device roster (all-or-nothing fan-out), enforce size/quota
 * limits, insert one envelope per device, and record the idempotency result. Online devices are
 * signalled after commit via {@link EnvelopesStored}.
 */
@Service
public class SubmissionService {

    private static final Set<EnvelopeType> DIRECT_TYPES = Set.of(EnvelopeType.CIPHERTEXT, EnvelopeType.PREKEY_MESSAGE);
    private static final String ACCEPTED = "{\"ok\":true}";

    private final IdentityApi identity;
    private final MailboxRepository mailbox;
    private final SubmissionRepository submissions;
    private final MessagingProperties properties;
    private final ApplicationEventPublisher events;
    private final Clock clock;

    SubmissionService(IdentityApi identity, MailboxRepository mailbox, SubmissionRepository submissions,
            MessagingProperties properties, ApplicationEventPublisher events, Clock clock) {
        this.identity = identity;
        this.mailbox = mailbox;
        this.submissions = submissions;
        this.properties = properties;
        this.events = events;
        this.clock = clock;
    }

    /**
     * Accepts a direct submission.
     *
     * @param sender authenticated sending device
     * @param send command
     * @return the result; a replay of an accepted submission returns {@code duplicate = true}
     * @throws EnclaveException {@code DEVICE_MISMATCH}, {@code STALE_DEVICES},
     *     {@code IDEMPOTENCY_CONFLICT}, {@code PAYLOAD_TOO_LARGE}, {@code NOT_FOUND}, {@code INVALID_REQUEST}
     */
    @Transactional
    public SendResult submitDirect(DeviceAddress sender, DirectSend send) {
        validateShape(send);
        byte[] digest = digest(send);
        var prior = submissions.findDigest(sender, send.submissionId());
        if (prior.isPresent()) {
            return replay(prior.get(), digest);
        }

        DeviceRoster roster = identity.activeRoster(send.destination())
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown destination account"));
        validateRoster(sender, send, roster);

        Instant now = clock.instant();
        Duration ttl = send.transientTtlSeconds() > 0
                ? Duration.ofSeconds(send.transientTtlSeconds()) : properties.envelopeTtl();
        List<DeviceAddress> recipients = new ArrayList<>();
        for (DeviceMessage m : send.messages()) {
            DeviceAddress to = new DeviceAddress(send.destination(), m.deviceId());
            if (mailbox.queuedBytes(to) + m.content().length > properties.maxMailboxBytes()) {
                throw new EnclaveException(ErrorCode.RATE_LIMITED, "recipient mailbox is full");
            }
            mailbox.insert(new Envelope(to, Uuids.v7(), m.type(), sender, now, now.plus(ttl), send.urgent(), m.content()));
            recipients.add(to);
        }
        if (!submissions.insert(sender, send.submissionId(), digest, ACCEPTED, now.plus(properties.submissionRetention()))) {
            // A concurrent request with the same ID won the race; roll back our envelopes.
            throw new EnclaveException(ErrorCode.IDEMPOTENCY_CONFLICT, "concurrent submission with the same ID");
        }
        events.publishEvent(new EnvelopesStored(List.copyOf(recipients)));
        return new SendResult(true, false);
    }

    /** Deletes expired idempotency records. */
    @Scheduled(fixedDelayString = "${enclave.messaging.submission-purge-interval:PT1H}")
    @Transactional
    public void purgeExpired() {
        submissions.purgeExpired();
    }

    private void validateShape(DirectSend send) {
        if (send.destination() == null) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "destination is required");
        }
        if (send.submissionId() == null || send.submissionId().length != 16) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "submissionId must be 16 bytes");
        }
        if (send.messages() == null || send.messages().isEmpty()) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "at least one device message is required");
        }
        if (send.messages().size() > properties.maxDevicesPerSend()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "too many device messages");
        }
        long maxTransient = properties.maxTransientTtl().toSeconds();
        if (send.transientTtlSeconds() < 0 || send.transientTtlSeconds() > maxTransient) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "transientTtlSeconds out of range");
        }
        Set<Integer> seen = new TreeSet<>();
        for (DeviceMessage m : send.messages()) {
            if (!seen.add(m.deviceId())) {
                throw new EnclaveException(ErrorCode.INVALID_REQUEST, "duplicate device in submission");
            }
            if (!DIRECT_TYPES.contains(m.type())) {
                throw new EnclaveException(ErrorCode.INVALID_REQUEST, "envelope type not allowed for direct sends");
            }
            if (m.content() == null || m.content().length == 0) {
                throw new EnclaveException(ErrorCode.INVALID_REQUEST, "empty ciphertext");
            }
            if (m.content().length > properties.maxEnvelopeBytes()) {
                throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "ciphertext exceeds envelope limit");
            }
        }
    }

    /**
     * All-or-nothing roster comparison (specs §5.3). The sender's own device is never a valid
     * destination.
     */
    private static void validateRoster(DeviceAddress sender, DirectSend send, DeviceRoster roster) {
        Map<Integer, Integer> expected = new HashMap<>();
        for (DeviceRoster.Entry e : roster.devices()) {
            boolean self = send.destination().equals(sender.accountId()) && e.deviceId() == sender.deviceId();
            if (!self) {
                expected.put(e.deviceId(), e.registrationId());
            }
        }
        Set<Integer> provided = new TreeSet<>();
        Set<Integer> extra = new TreeSet<>();
        Set<Integer> stale = new TreeSet<>();
        for (DeviceMessage m : send.messages()) {
            provided.add(m.deviceId());
            Integer registrationId = expected.get(m.deviceId());
            if (registrationId == null) {
                extra.add(m.deviceId());
            } else if (registrationId != m.registrationId()) {
                stale.add(m.deviceId());
            }
        }
        Set<Integer> missing = new TreeSet<>(expected.keySet());
        missing.removeAll(provided);
        if (!missing.isEmpty() || !extra.isEmpty()) {
            throw new EnclaveException(ErrorCode.DEVICE_MISMATCH, "recipient device list changed",
                    Map.of("missing", List.copyOf(missing), "extra", List.copyOf(extra),
                            "deviceListVersion", roster.deviceListVersion()));
        }
        if (!stale.isEmpty()) {
            throw new EnclaveException(ErrorCode.STALE_DEVICES, "recipient devices were re-registered",
                    Map.of("stale", List.copyOf(stale)));
        }
    }

    private static SendResult replay(byte[] stored, byte[] digest) {
        if (!MessageDigest.isEqual(stored, digest)) {
            throw new EnclaveException(ErrorCode.IDEMPOTENCY_CONFLICT, "submission ID reused with different content");
        }
        return new SendResult(true, true);
    }

    /** Canonical digest: destination, flags and device messages sorted by device ID. */
    static byte[] digest(DirectSend send) {
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                DataOutputStream out = new DataOutputStream(bytes)) {
            out.writeUTF("ENCLAVE-SUBMIT-V1");
            out.writeUTF(send.destination().toString());
            out.writeBoolean(send.urgent());
            out.writeInt(send.transientTtlSeconds());
            List<DeviceMessage> sorted = new ArrayList<>(send.messages());
            sorted.sort(Comparator.comparingInt(DeviceMessage::deviceId));
            for (DeviceMessage m : sorted) {
                out.writeInt(m.deviceId());
                out.writeInt(m.registrationId());
                out.writeInt(m.type().code());
                out.writeInt(m.content().length);
                out.write(m.content());
            }
            out.flush();
            return MessageDigest.getInstance("SHA-256").digest(bytes.toByteArray());
        } catch (IOException | NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
