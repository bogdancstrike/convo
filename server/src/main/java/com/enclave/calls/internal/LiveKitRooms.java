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
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();

    LiveKitRooms(CallsProperties properties, LiveKitTokens tokens, ObjectMapper json) {
        this.properties = properties;
        this.tokens = tokens;
        this.json = json;
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
