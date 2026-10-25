package com.enclave.calls.internal;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Minimal client for LiveKit's RoomService (Twirp/JSON over HTTP), authorized per request with a
 * one-minute room-admin token. Used only to remove participants who lost access.
 */
@Component
class LiveKitRooms {
    private final CallsProperties properties;
    private final LiveKitTokens tokens;
    private final ObjectMapper json;
    private final HttpClient http;

    LiveKitRooms(CallsProperties properties, LiveKitTokens tokens, ObjectMapper json) {
        this.properties = properties;
        this.tokens = tokens;
        this.json = json;
        var builder = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER);
        if (!properties.livekitCertificate().isBlank()) builder.sslContext(pinned(properties.livekitCertificate()));
        this.http = builder.build();
    }

    /** TLS that trusts exactly the configured certificate (a self-signed LiveKit reached by IP). */
    static javax.net.ssl.SSLContext pinned(String pem) {
        try {
            var certificate = java.security.cert.CertificateFactory.getInstance("X.509")
                    .generateCertificate(new java.io.ByteArrayInputStream(pem.strip().getBytes(java.nio.charset.StandardCharsets.US_ASCII)));
            var store = java.security.KeyStore.getInstance(java.security.KeyStore.getDefaultType());
            store.load(null, null);
            store.setCertificateEntry("livekit", certificate);
            var trust = javax.net.ssl.TrustManagerFactory.getInstance(javax.net.ssl.TrustManagerFactory.getDefaultAlgorithm());
            trust.init(store);
            var context = javax.net.ssl.SSLContext.getInstance("TLS");
            context.init(null, trust.getTrustManagers(), null);
            return context;
        } catch (Exception e) {
            throw new IllegalStateException("invalid enclave.calls.livekit-certificate", e);
        }
    }

    boolean enabled() { return properties.usable() && !properties.livekitUrl().isBlank(); }

    /** Participant identities in a room (empty when the room does not exist). */
    List<String> participants(String room) throws Exception {
        JsonNode body = call(room, "ListParticipants", Map.of("room", room));
        List<String> identities = new ArrayList<>();
        if (body != null) body.path("participants").forEach(p -> identities.add(p.path("identity").asString()));
        return identities;
    }

    void remove(String room, String identity) throws Exception {
        call(room, "RemoveParticipant", Map.of("room", room, "identity", identity));
    }

    private JsonNode call(String room, String method, Map<String, String> payload) throws Exception {
        var request = HttpRequest.newBuilder(URI.create(properties.livekitUrl().replaceAll("/$", "") + "/twirp/livekit.RoomService/" + method))
                .timeout(Duration.ofSeconds(5)).header("Authorization", "Bearer " + tokens.issueAdmin(room)).header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(payload))).build();
        var response = http.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() == 404) return null; // room or participant already gone
        if (response.statusCode() >= 300) throw new IllegalStateException("LiveKit " + method + " failed: HTTP " + response.statusCode());
        return json.readTree(response.body());
    }
}
