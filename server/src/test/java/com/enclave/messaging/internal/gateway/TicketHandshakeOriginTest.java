package com.enclave.messaging.internal.gateway;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.enclave.contracts.DeviceAddress;
import com.enclave.messaging.internal.MessagingProperties;
import java.util.HashMap;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.http.server.ServletServerHttpRequest;
import org.springframework.http.server.ServletServerHttpResponse;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** WebSocket upgrade origin rules: same origin means same host, port and scheme (or a configured origin). */
class TicketHandshakeOriginTest {

    private static boolean handshake(String origin, String host, String forwardedProto, String requestScheme, List<String> allowed) {
        var tickets = mock(WebSocketTicketService.class);
        when(tickets.redeem(any(), any())).thenReturn(Optional.of(new DeviceAddress(UUID.randomUUID(), 1)));
        var properties = mock(MessagingProperties.class, RETURNS_DEEP_STUBS);
        when(properties.websocket().allowedOrigins()).thenReturn(allowed);
        var servlet = new MockHttpServletRequest("GET", "/v1/ws");
        servlet.setScheme(requestScheme);
        if (origin != null) servlet.addHeader("Origin", origin);
        servlet.addHeader("Host", host);
        if (forwardedProto != null) servlet.addHeader("X-Forwarded-Proto", forwardedProto);
        servlet.addHeader("Sec-WebSocket-Protocol", "enclave.v1, ticket.abc");
        var interceptor = new TicketHandshakeInterceptor(tickets, properties);
        return interceptor.beforeHandshake(new ServletServerHttpRequest(servlet), new ServletServerHttpResponse(new MockHttpServletResponse()), null, new HashMap<>());
    }

    @ParameterizedTest(name = "{0} on {1} (proxy {2}, request {3}) -> {4}")
    @CsvSource(nullValues = "-", value = {
            "https://convo.example.org, convo.example.org, https, http, true",
            "http://convo.example.org,  convo.example.org, https, http, false",
            "https://localhost:8443,    localhost:8443,    https, http, true",
            "http://localhost:8443,     localhost:8443,    https, http, false",
            "http://localhost:8080,     localhost:8080,    -,     http, true",
            "https://localhost:8080,    localhost:8080,    -,     http, false",
            "https://evil.example,      convo.example.org, https, http, false",
            "https://convo.example.org:444, convo.example.org, https, http, false",
            "https://CONVO.example.org, convo.example.org, https, http, true",
            "null,                      convo.example.org, https, http, false",
            "-,                         convo.example.org, https, http, true",
            "https://convo.example.org, convo.example.org, 'https,http', http, true",
    })
    void sameOriginRequiresHostPortAndScheme(String origin, String host, String forwardedProto, String scheme, boolean allowed) {
        assertThat(handshake(origin, host, forwardedProto, scheme, List.of())).isEqualTo(allowed);
    }

    @ParameterizedTest(name = "configured origins: {0} -> {1}")
    @CsvSource({ "https://app.example.org, true", "https://other.example.org, false", "http://app.example.org, false" })
    void configuredOriginsAreExact(String origin, boolean allowed) {
        assertThat(handshake(origin, "api.example.org", "https", "http", List.of("https://app.example.org"))).isEqualTo(allowed);
    }
}
