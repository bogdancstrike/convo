package com.enclave.messaging.internal.gateway;

import com.enclave.messaging.internal.MessagingProperties;
import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.server.HandshakeInterceptor;

/**
 * Authenticates the WebSocket upgrade with a one-use ticket presented as a
 * {@code ticket.<value>} entry of {@code Sec-WebSocket-Protocol}, and enforces exact origin rules
 * (specs §9.1, §28).
 */
@Component
class TicketHandshakeInterceptor implements HandshakeInterceptor {

    static final String TICKET_PREFIX = "ticket.";

    private final WebSocketTicketService tickets;
    private final MessagingProperties properties;

    TicketHandshakeInterceptor(WebSocketTicketService tickets, MessagingProperties properties) {
        this.tickets = tickets;
        this.properties = properties;
    }

    @Override
    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler,
            Map<String, Object> attributes) {
        String origin = request.getHeaders().getOrigin();
        if (!originAllowed(origin, request)) {
            response.setStatusCode(HttpStatus.FORBIDDEN);
            return false;
        }
        String ticket = request.getHeaders().getOrEmpty("Sec-WebSocket-Protocol").stream()
                .flatMap(v -> Arrays.stream(v.split(",")))
                .map(String::strip)
                .filter(v -> v.startsWith(TICKET_PREFIX))
                .map(v -> v.substring(TICKET_PREFIX.length()))
                .findFirst().orElse(null);
        var device = ticket == null ? java.util.Optional.<com.enclave.contracts.DeviceAddress>empty()
                : tickets.redeem(ticket, origin);
        if (device.isEmpty()) {
            response.setStatusCode(HttpStatus.UNAUTHORIZED);
            return false;
        }
        attributes.put(GatewayWebSocketHandler.DEVICE_ATTRIBUTE, device.get());
        return true;
    }

    @Override
    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response, WebSocketHandler handler,
            Exception exception) {
        // nothing to do
    }

    /**
     * Non-browser clients send no {@code Origin}. Browsers must match a configured origin, or —
     * when none are configured — the request's own host (same-origin deployment behind a proxy).
     */
    private boolean originAllowed(String origin, ServerHttpRequest request) {
        if (origin == null) {
            return true;
        }
        List<String> allowed = properties.websocket().allowedOrigins();
        if (!allowed.isEmpty()) {
            return allowed.contains(origin);
        }
        String host = request.getHeaders().getFirst("Host");
        // Same origin means same scheme too: the one the client used (the proxy's X-Forwarded-Proto,
        // otherwise this request's own), so an http:// origin cannot pass for an https:// site.
        String forwarded = request.getHeaders().getFirst("X-Forwarded-Proto");
        String scheme = forwarded != null && !forwarded.isBlank() ? forwarded.split(",")[0].strip() : request.getURI().getScheme();
        String expectedScheme = "wss".equalsIgnoreCase(scheme) ? "https" : "ws".equalsIgnoreCase(scheme) ? "http" : scheme;
        try {
            URI uri = URI.create(origin);
            String authority = uri.getPort() == -1 ? uri.getHost() : uri.getHost() + ":" + uri.getPort();
            return host != null && host.equalsIgnoreCase(authority) && uri.getScheme() != null && uri.getScheme().equalsIgnoreCase(expectedScheme);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
