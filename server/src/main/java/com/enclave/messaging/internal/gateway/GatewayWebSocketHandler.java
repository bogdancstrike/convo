package com.enclave.messaging.internal.gateway;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.messaging.MailWaiting;
import com.enclave.messaging.internal.MessagingProperties;
import com.enclave.messaging.internal.gateway.WireFormat.ClientFrame;
import com.enclave.messaging.internal.gateway.WireFormat.SendResultDto;
import com.enclave.messaging.internal.gateway.WireFormat.ServerFrame;
import com.enclave.messaging.internal.mailbox.MailboxService;
import com.enclave.messaging.internal.submission.SubmissionService;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.SubProtocolCapable;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/**
 * Device WebSocket endpoint {@code /v1/ws} (specs §9.2–9.3). The handshake was already
 * authenticated by {@link TicketHandshakeInterceptor}; this handler multiplexes send/ack/ping
 * frames and drives mailbox delivery.
 */
@Component
class GatewayWebSocketHandler extends TextWebSocketHandler implements SubProtocolCapable {

    /** Negotiated application subprotocol. */
    static final String SUBPROTOCOL = "enclave.v1";
    static final String DEVICE_ATTRIBUTE = "enclave.device";
    private static final String SESSION_ATTRIBUTE = "enclave.session";
    private static final Logger log = LoggerFactory.getLogger(GatewayWebSocketHandler.class);

    private final DeviceSessionRegistry registry;
    private final MailboxService mailbox;
    private final SubmissionService submissions;
    private final HintBus hints;
    private final MessagingProperties properties;
    private final ObjectMapper mapper;
    private final ApplicationEventPublisher events;
    private final String replicaId = UUID.randomUUID().toString();

    GatewayWebSocketHandler(DeviceSessionRegistry registry, MailboxService mailbox, SubmissionService submissions,
            HintBus hints, MessagingProperties properties, ObjectMapper mapper, ApplicationEventPublisher events) {
        this.registry = registry;
        this.mailbox = mailbox;
        this.submissions = submissions;
        this.hints = hints;
        this.properties = properties;
        this.mapper = mapper;
        this.events = events;
    }

    @Override
    public List<String> getSubProtocols() {
        return List.of(SUBPROTOCOL);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession raw) {
        DeviceAddress device = (DeviceAddress) raw.getAttributes().get(DEVICE_ATTRIBUTE);
        var ws = properties.websocket();
        raw.setTextMessageSizeLimit(ws.maxFrameBytes());
        WebSocketSession socket = new ConcurrentWebSocketSessionDecorator(raw,
                (int) ws.sendTimeLimit().toMillis(), ws.sendBufferBytes());
        DeviceSession session = new DeviceSession(device, socket, mailbox, mapper, properties.drainPageSize());
        raw.getAttributes().put(SESSION_ATTRIBUTE, session);
        registry.register(session);
        hints.markPresent(device, replicaId, ws.idleTimeout());
        session.drainIfIdle();
    }

    @Override
    protected void handleTextMessage(WebSocketSession raw, TextMessage message) {
        DeviceSession session = (DeviceSession) raw.getAttributes().get(SESSION_ATTRIBUTE);
        if (session == null) {
            return;
        }
        session.touch();
        ClientFrame frame;
        try {
            frame = mapper.readValue(message.getPayload(), ClientFrame.class);
        } catch (JacksonException e) {
            session.send(ServerFrame.error(0, "INVALID_REQUEST", "malformed frame"));
            return;
        }
        if (frame.send() != null) {
            handleSend(session, frame);
        } else if (frame.ack() != null && frame.ack().guids() != null) {
            session.acknowledge(frame.ack().guids());
        } else if (frame.ping() != null) {
            session.send(ServerFrame.pong(frame.requestId()));
            hints.markPresent(session.device(), replicaId, properties.websocket().idleTimeout());
            session.drainIfIdle(); // keepalive mailbox safety net (specs §9.3)
        } else {
            session.send(ServerFrame.error(frame.requestId(), "INVALID_REQUEST", "unknown frame"));
        }
    }

    private void handleSend(DeviceSession session, ClientFrame frame) {
        SendResultDto result;
        try {
            var r = submissions.submitDirect(session.device(), frame.send().toCommand());
            result = SendResultDto.accepted(r.duplicate());
        } catch (EnclaveException e) {
            result = SendResultDto.rejected(e);
        } catch (RuntimeException e) {
            log.error("Send failed", e);
            session.send(ServerFrame.error(frame.requestId(), "INTERNAL", "send failed"));
            return;
        }
        session.send(ServerFrame.sendResult(frame.requestId(), result));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession raw, CloseStatus status) {
        DeviceSession session = (DeviceSession) raw.getAttributes().get(SESSION_ATTRIBUTE);
        if (session != null) {
            registry.unregister(session);
            if (!registry.isLocal(session.device())) {
                hints.clearPresence(session.device(), replicaId);
                wakeIfMailWaiting(session.device());
            }
        }
    }

    /**
     * Mail that arrived while the device still looked connected — a killed app or a phone that lost
     * its network keeps a half-open socket until the idle timeout — got no push wake, because the
     * live session was expected to deliver it. Once the device's last session is gone, wake it for
     * whatever is still undelivered so the notification is not delayed until the app is reopened.
     */
    private void wakeIfMailWaiting(DeviceAddress device) {
        try {
            if (!hints.isPresent(device) && mailbox.hasPending(device)) events.publishEvent(new MailWaiting(device, false));
        } catch (RuntimeException e) {
            log.debug("Wake after disconnect skipped: {}", e.toString());
        }
    }

    @Override
    public void handleTransportError(WebSocketSession raw, Throwable exception) {
        log.debug("Transport error: {}", exception.toString());
    }
}
