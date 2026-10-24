package com.enclave.admin.internal;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Arrays;
import java.util.function.Predicate;

/** Read-only transport checks with fixed targets, no redirects, and sanitized results. */
final class NetworkHealth {
    private final Duration timeout;
    private final HttpClient http;
    NetworkHealth(Duration timeout) {
        this.timeout = timeout;
        this.http = HttpClient.newBuilder().connectTimeout(timeout).followRedirects(HttpClient.Redirect.NEVER).build();
    }
    SystemHealth.Observation http(String address, Predicate<String> validBody) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(address)).timeout(timeout).header("User-Agent", "Convo-Health").GET().build();
        var response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) return new SystemHealth.Observation(SystemHealth.State.DOWN, "Health endpoint returned HTTP " + response.statusCode() + ".");
        return validBody.test(response.body()) ? SystemHealth.Observation.up("Health endpoint responded successfully.")
                : new SystemHealth.Observation(SystemHealth.State.DOWN, "Health endpoint did not return the expected readiness response.");
    }
    /** RFC 8489 binding check: validates success class, framing, cookie and transaction ID. */
    SystemHealth.Observation stun(String host, int port) throws Exception {
        byte[] request = new byte[20];
        new SecureRandom().nextBytes(request);
        ByteBuffer.wrap(request).putShort((short) 0x0001).putShort((short) 0).putInt(0x2112A442);
        try (var socket = new DatagramSocket()) {
            socket.connect(new InetSocketAddress(host, port));
            socket.setSoTimeout(Math.toIntExact(timeout.toMillis()));
            socket.send(new DatagramPacket(request, request.length));
            var packet = new DatagramPacket(new byte[1024], 1024);
            socket.receive(packet);
            byte[] response = Arrays.copyOf(packet.getData(), packet.getLength());
            if (!validStun(request, response)) return new SystemHealth.Observation(SystemHealth.State.DOWN, "TURN/STUN did not return a valid binding success response.");
            return SystemHealth.Observation.up("UDP STUN binding succeeded. Relay allocation and external media routes are not exercised.");
        }
    }
    static boolean validStun(byte[] request, byte[] response) {
        if (response.length < 20 || request.length != 20) return false;
        var header = ByteBuffer.wrap(response);
        int type = Short.toUnsignedInt(header.getShort()), length = Short.toUnsignedInt(header.getShort());
        return type == 0x0101 && length % 4 == 0 && length + 20 == response.length && header.getInt() == 0x2112A442
                && Arrays.equals(Arrays.copyOfRange(request, 8, 20), Arrays.copyOfRange(response, 8, 20));
    }
}
