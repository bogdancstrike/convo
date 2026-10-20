package com.enclave.messaging.internal.gateway;

import com.enclave.contracts.DeviceAddress;
import com.enclave.messaging.internal.gateway.WireFormat.EnvelopeDto;
import com.enclave.messaging.internal.gateway.WireFormat.ServerFrame;
import com.enclave.messaging.internal.mailbox.Envelope;
import com.enclave.messaging.internal.mailbox.MailboxService;
import java.io.IOException;
import java.time.Instant;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.locks.ReentrantLock;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

/**
 * One authenticated device connection and its bounded drain state.
 *
 * <p>Flow control: at most one page of envelopes is in flight. The next page is fetched only
 * after every in-flight envelope was acknowledged, so a slow client bounds server memory and a
 * lost hint is recovered on the next ack, hint or ping.
 */
final class DeviceSession {

    private static final Logger log = LoggerFactory.getLogger(DeviceSession.class);

    private final DeviceAddress device;
    private final WebSocketSession socket;
    private final MailboxService mailbox;
    private final ObjectMapper mapper;
    private final int pageSize;
    private final ReentrantLock drainLock = new ReentrantLock();
    private final Set<UUID> inFlight = new HashSet<>();
    private volatile Instant lastActivity = Instant.now();
    private boolean queueEmptySent;

    DeviceSession(DeviceAddress device, WebSocketSession socket, MailboxService mailbox, ObjectMapper mapper, int pageSize) {
        this.device = device;
        this.socket = socket;
        this.mailbox = mailbox;
        this.mapper = mapper;
        this.pageSize = pageSize;
    }

    DeviceAddress device() {
        return device;
    }

    String id() {
        return socket.getId();
    }

    Instant lastActivity() {
        return lastActivity;
    }

    void touch() {
        lastActivity = Instant.now();
    }

    /** Sends the next page if nothing is in flight; sends {@code queueEmpty} once the queue drains. */
    void drainIfIdle() {
        if (!socket.isOpen()) {
            return;
        }
        drainLock.lock();
        try {
            if (!inFlight.isEmpty()) {
                return;
            }
            List<Envelope> page = mailbox.page(device, pageSize);
            if (page.isEmpty()) {
                if (!queueEmptySent) {
                    send(ServerFrame.queueDrained());
                    queueEmptySent = true;
                }
                return;
            }
            queueEmptySent = false;
            for (Envelope e : page) {
                inFlight.add(e.guid());
                send(ServerFrame.envelope(EnvelopeDto.of(e)));
            }
        } finally {
            drainLock.unlock();
        }
    }

    /** Deletes acknowledged envelopes and continues draining. */
    void acknowledge(Collection<UUID> guids) {
        mailbox.ack(device, guids);
        drainLock.lock();
        try {
            guids.forEach(inFlight::remove);
        } finally {
            drainLock.unlock();
        }
        drainIfIdle();
    }

    /** Serializes and sends a frame; send failures close the session. */
    void send(ServerFrame frame) {
        try {
            socket.sendMessage(new TextMessage(mapper.writeValueAsString(frame)));
        } catch (IOException | RuntimeException e) {
            log.debug("Send to {} failed: {}", device, e.toString());
            close(CloseStatus.SESSION_NOT_RELIABLE);
        }
    }

    void close(CloseStatus status) {
        try {
            if (socket.isOpen()) {
                socket.close(status);
            }
        } catch (IOException e) {
            log.debug("Close of {} failed: {}", device, e.toString());
        }
    }
}
