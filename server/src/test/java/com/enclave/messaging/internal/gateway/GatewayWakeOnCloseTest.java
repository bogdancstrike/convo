package com.enclave.messaging.internal.gateway;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.enclave.contracts.DeviceAddress;
import com.enclave.messaging.MailWaiting;
import com.enclave.messaging.internal.MessagingProperties;
import com.enclave.messaging.internal.mailbox.MailboxService;
import com.enclave.messaging.internal.submission.SubmissionService;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

/**
 * A half-open socket (killed app, lost network) swallows the push wake for mail that arrives
 * before the idle timeout closes it; closing the last session must wake for what is still waiting.
 */
class GatewayWakeOnCloseTest {
    private final DeviceAddress device = new DeviceAddress(UUID.randomUUID(), 1);
    private final DeviceSessionRegistry registry = new DeviceSessionRegistry(mock(MessagingProperties.class));
    private final MailboxService mailbox = mock(MailboxService.class);
    private final HintBus hints = mock(HintBus.class);
    private final ApplicationEventPublisher events = mock(ApplicationEventPublisher.class);
    private final GatewayWebSocketHandler handler = new GatewayWebSocketHandler(registry, mailbox, mock(SubmissionService.class), hints,
            mock(MessagingProperties.class), new ObjectMapper(), events);

    private WebSocketSession connected() {
        DeviceSession session = mock(DeviceSession.class);
        when(session.device()).thenReturn(device);
        registry.register(session);
        WebSocketSession raw = mock(WebSocketSession.class);
        Map<String, Object> attributes = new HashMap<>();
        attributes.put("enclave.session", session);
        when(raw.getAttributes()).thenReturn(attributes);
        return raw;
    }

    @Test void lastSessionClosingWithUndeliveredMailWakesTheDevice() throws Exception {
        when(mailbox.hasPending(device)).thenReturn(true);
        handler.afterConnectionClosed(connected(), CloseStatus.SESSION_NOT_RELIABLE);
        verify(events).publishEvent(new MailWaiting(device, false));
    }

    @Test void noWakeWithoutMailOrWhileAnotherSessionStillDelivers() throws Exception {
        handler.afterConnectionClosed(connected(), CloseStatus.NORMAL);
        when(mailbox.hasPending(device)).thenReturn(true);
        WebSocketSession first = connected(); connected();
        handler.afterConnectionClosed(first, CloseStatus.NORMAL);
        verify(events, never()).publishEvent(any(Object.class));
    }

    @Test void noWakeWhileAnotherReplicaHoldsTheDevice() throws Exception {
        when(mailbox.hasPending(device)).thenReturn(true);
        when(hints.isPresent(device)).thenReturn(true);
        handler.afterConnectionClosed(connected(), CloseStatus.NORMAL);
        verify(events, never()).publishEvent(any(Object.class));
    }
}
