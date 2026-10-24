package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.time.Duration;
import java.util.Arrays;
import org.junit.jupiter.api.Test;

class NetworkHealthTest {
    @Test void acceptsOnlyExpectedResponsesAndNeverFollowsRedirectsOrExposesErrorBodies() throws Exception {
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/good", e -> { byte[] body = "ready".getBytes(java.nio.charset.StandardCharsets.UTF_8); e.sendResponseHeaders(200, body.length); e.getResponseBody().write(body); e.close(); });
        server.createContext("/bad", e -> { byte[] body = "private details".getBytes(java.nio.charset.StandardCharsets.UTF_8); e.sendResponseHeaders(503, body.length); e.getResponseBody().write(body); e.close(); });
        server.createContext("/redirect", e -> { e.getResponseHeaders().set("Location", "/good"); e.sendResponseHeaders(302, -1); e.close(); });
        server.start();
        try {
            var network = new NetworkHealth(Duration.ofSeconds(1));
            String base = "http://127.0.0.1:" + server.getAddress().getPort();
            assertThat(network.http(base + "/good", "ready"::equals).status()).isEqualTo(SystemHealth.State.UP);
            assertThat(network.http(base + "/good", "unexpected"::equals).status()).isEqualTo(SystemHealth.State.DOWN);
            var bad = network.http(base + "/bad", s -> true);
            assertThat(bad.detail()).contains("503").doesNotContain("private details");
            assertThat(network.http(base + "/redirect", s -> true).status()).isEqualTo(SystemHealth.State.DOWN);
        } finally { server.stop(0); }
    }
    @Test void exchangesBindingDatagramsAndChecksTheTransaction() throws Exception {
        try (var server = new DatagramSocket(new InetSocketAddress("127.0.0.1", 0))) {
            var task = java.util.concurrent.CompletableFuture.runAsync(() -> {
                try {
                    var packet = new DatagramPacket(new byte[1024], 1024); server.receive(packet);
                    byte[] response = Arrays.copyOf(packet.getData(), 20); ByteBuffer.wrap(response).putShort((short) 0x0101);
                    server.send(new DatagramPacket(response, response.length, packet.getSocketAddress()));
                } catch (Exception e) { throw new IllegalStateException(e); }
            });
            assertThat(new NetworkHealth(Duration.ofSeconds(1)).stun("127.0.0.1", server.getLocalPort()).status()).isEqualTo(SystemHealth.State.UP);
            task.get(2, java.util.concurrent.TimeUnit.SECONDS);
        }
    }
    @Test void rejectsMalformedOrUnrelatedStunReplies() {
        byte[] request = new byte[20]; ByteBuffer.wrap(request).putShort((short) 1).putShort((short) 0).putInt(0x2112A442); request[19] = 7;
        byte[] response = request.clone(); ByteBuffer.wrap(response).putShort((short) 0x0101);
        assertThat(NetworkHealth.validStun(request, response)).isTrue();
        response[19] = 8; assertThat(NetworkHealth.validStun(request, response)).isFalse();
        assertThat(NetworkHealth.validStun(request, new byte[10])).isFalse();
        response = request.clone(); assertThat(NetworkHealth.validStun(request, response)).isFalse();
        ByteBuffer.wrap(response).putShort((short) 0x0101).putShort((short) 4); assertThat(NetworkHealth.validStun(request, response)).isFalse();
    }
}
