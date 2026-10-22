package com.enclave.push.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.messaging.MailWaiting;
import com.enclave.push.internal.PushIntentStore.Claimed;
import com.enclave.push.internal.PushIntentStore.Target;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.mockito.Answers;
import org.springframework.jdbc.core.simple.JdbcClient;

class PushServiceTest {
    private static final String ENDPOINT = "http://convo.example:8091/upX?up=1";
    private final PushProperties properties = new PushProperties(true, List.of("http://convo.example:8091"), "http://ntfy:80",
            Duration.ofSeconds(30), Duration.ofSeconds(3), Duration.ofSeconds(5), 4, Duration.ofSeconds(2),
            Duration.ofHours(1), Duration.ofSeconds(60), Duration.ofSeconds(1), Duration.ofSeconds(30), 50, Duration.ofHours(24), webPush(false));
    private final DeviceAddress device = new DeviceAddress(UUID.randomUUID(), 1);
    private final Instant now = Instant.parse("2026-10-21T12:00:00Z");
    private final Clock clock = Clock.fixed(now, ZoneOffset.UTC);

    @Test void onlyAllowListedDistributorsAreAcceptedAndReachedInternally() {
        var push = new PushService(mock(JdbcClient.class), properties, clock);
        assertThat(push.allowed(ENDPOINT)).isTrue();
        assertThat(push.allowed("http://evil.example:8091/upAbC123")).isFalse();
        assertThat(push.allowed("http://user:pw@convo.example:8091/up")).isFalse();
        assertThat(push.allowed("http://169.254.169.254/latest")).isFalse();
        assertThat(push.internal(ENDPOINT)).isEqualTo("http://ntfy:80/upX?up=1");
        assertThatThrownBy(() -> push.register(device, "https://attacker.example/x")).isInstanceOf(EnclaveException.class);
        assertThat(PushService.WAKE).doesNotContain("from").doesNotContain("conversation");
    }

    @Test void attemptsClassifyDistributorAnswers() {
        List<String> urls = new ArrayList<>();
        for (var c : List.of(new Object[] {200, PushService.Outcome.DELIVERED}, new Object[] {503, PushService.Outcome.RETRY},
                new Object[] {429, PushService.Outcome.RETRY}, new Object[] {410, PushService.Outcome.GONE}, new Object[] {400, PushService.Outcome.REJECTED})) {
            var push = new PushService(mock(JdbcClient.class), properties, clock, (url, payload, headers) -> { urls.add(url); return (Integer) c[0]; });
            assertThat(push.attempt(ENDPOINT, PushService.WAKE)).isEqualTo(c[1]);
        }
        var down = new PushService(mock(JdbcClient.class), properties, clock, (url, payload, headers) -> { throw new java.net.ConnectException(); });
        assertThat(down.attempt(ENDPOINT, PushService.WAKE)).isEqualTo(PushService.Outcome.RETRY);
        assertThat(urls).allMatch(u -> u.equals("http://ntfy:80/upX?up=1"));
    }

    // --- Web Push ----------------------------------------------------------------------------

    private static final java.security.KeyPair VAPID_KEYS;
    static {
        try {
            var generator = java.security.KeyPairGenerator.getInstance("EC");
            generator.initialize(new java.security.spec.ECGenParameterSpec("secp256r1"));
            VAPID_KEYS = generator.generateKeyPair();
        } catch (Exception e) { throw new IllegalStateException(e); }
    }

    static String publicKey() {
        var w = ((java.security.interfaces.ECPublicKey) VAPID_KEYS.getPublic()).getW();
        byte[] point = new byte[65]; point[0] = 4;
        System.arraycopy(fixed(w.getAffineX()), 0, point, 1, 32); System.arraycopy(fixed(w.getAffineY()), 0, point, 33, 32);
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(point);
    }

    private static byte[] fixed(java.math.BigInteger v) {
        byte[] raw = v.toByteArray(), out = new byte[32];
        System.arraycopy(raw, Math.max(0, raw.length - 32), out, Math.max(0, 32 - raw.length), Math.min(32, raw.length));
        return out;
    }

    static PushProperties.WebPush webPush(boolean enabled) {
        String d = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(fixed(((java.security.interfaces.ECPrivateKey) VAPID_KEYS.getPrivate()).getS()));
        return new PushProperties.WebPush(enabled, publicKey(), d, "mailto:ops@example.test",
                List.of("fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "*.notify.windows.com"));
    }

    private PushProperties withWebPush() {
        return new PushProperties(true, properties.allowedOrigins(), properties.internalOrigin(), properties.minInterval(), properties.urgentMinInterval(),
                properties.timeout(), properties.maxAttempts(), properties.retryBackoff(), properties.intentTtl(), properties.urgentTtl(),
                properties.pollInterval(), properties.lease(), properties.batchSize(), properties.deadLetterRetention(), webPush(true));
    }

    @Test void webPushEndpointsAreAcceptedOnlyForKnownPushServicesWhenEnabled() {
        String fcm = "https://fcm.googleapis.com/fcm/send/abc:def";
        assertThat(new PushService(mock(JdbcClient.class), properties, clock).allowed(fcm)).isFalse();
        var push = new PushService(mock(JdbcClient.class), withWebPush(), clock);
        assertThat(push.allowed(fcm)).isTrue();
        assertThat(push.allowed("https://wns2-db5p.notify.windows.com/w/?token=x")).isTrue();
        assertThat(push.allowed("http://fcm.googleapis.com/fcm/send/x")).isFalse();
        assertThat(push.allowed("https://fcm.googleapis.com:8443/x")).isFalse();
        assertThat(push.allowed("https://fcm.googleapis.com.evil.example/x")).isFalse();
        assertThat(push.allowed("https://notify.windows.com.evil.example/x")).isFalse();
        assertThat(push.allowed(ENDPOINT)).isTrue();
    }

    @Test void webPushWakesAreEmptyVapidSignedRequests() throws Exception {
        String endpoint = "https://updates.push.services.mozilla.com/wpush/v2/gAAAA";
        List<java.util.Map<String, String>> sent = new ArrayList<>();
        List<String> bodies = new ArrayList<>();
        var push = new PushService(mock(JdbcClient.class), withWebPush(), clock, (url, body, headers) -> {
            assertThat(url).isEqualTo(endpoint); bodies.add(body); sent.add(headers); return 201; });
        assertThat(push.attempt(endpoint, PushService.WAKE)).isEqualTo(PushService.Outcome.DELIVERED);
        assertThat(push.attempt(endpoint, PushService.URGENT)).isEqualTo(PushService.Outcome.DELIVERED);
        assertThat(bodies).containsOnly("");
        assertThat(sent.get(0)).containsEntry("TTL", "3600").containsEntry("Urgency", "normal");
        assertThat(sent.get(1)).containsEntry("TTL", "60").containsEntry("Urgency", "high");

        String auth = sent.get(0).get("Authorization");
        assertThat(auth).startsWith("vapid t=").endsWith(", k=" + publicKey());
        String[] jwt = auth.substring("vapid t=".length(), auth.indexOf(',')).split("\\.");
        String claims = new String(java.util.Base64.getUrlDecoder().decode(jwt[1]));
        assertThat(claims).contains("\"aud\":\"https://updates.push.services.mozilla.com\"").contains("\"sub\":\"mailto:ops@example.test\"")
                .contains("\"exp\":" + now.plus(Duration.ofHours(12)).getEpochSecond());
        var verifier = java.security.Signature.getInstance("SHA256withECDSAinP1363Format");
        verifier.initVerify(VAPID_KEYS.getPublic());
        verifier.update((jwt[0] + "." + jwt[1]).getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        assertThat(verifier.verify(java.util.Base64.getUrlDecoder().decode(jwt[2]))).isTrue();
        assertThat(sent.get(1).get("Authorization")).isEqualTo(auth); // cached per push service
    }

    @Test void mailForAnOfflineDeviceRecordsOneCoalescedIntent() {
        JdbcClient jdbc = mock(JdbcClient.class, Answers.RETURNS_DEEP_STUBS);
        new PushService(jdbc, properties, clock).on(new MailWaiting(device, false));
        verify(jdbc).sql(contains("ON CONFLICT (account_id, device_id, urgent) DO NOTHING"));
        JdbcClient disabled = mock(JdbcClient.class);
        new PushService(disabled, new PushProperties(false, List.of(), "", Duration.ofSeconds(30), Duration.ofSeconds(3), Duration.ofSeconds(5), 4,
                Duration.ofSeconds(2), Duration.ofHours(1), Duration.ofSeconds(60), Duration.ofSeconds(1), Duration.ofSeconds(30), 50, Duration.ofHours(24), webPush(false)), clock)
                .on(new MailWaiting(device, false));
        verifyNoInteractions(disabled);
    }

    // --- dispatcher -------------------------------------------------------------------------

    private final PushIntentStore store = mock(PushIntentStore.class);

    private PushDispatcher dispatcher(int status) {
        return new PushDispatcher(store, new PushService(mock(JdbcClient.class), properties, clock, (url, payload, headers) -> status), properties, clock);
    }

    private Claimed claimed(int attempts, boolean urgent) {
        return new Claimed(7, device.accountId(), device.deviceId(), urgent, attempts, now.plusSeconds(60));
    }

    @Test void aDeliveredWakeIsRemovedAndStampsTheRateLimit() {
        when(store.target(any())).thenReturn(Optional.of(new Target(ENDPOINT, null, null)));
        var c = claimed(1, false);
        dispatcher(200).handle(c);
        verify(store).delivered(c, now);
    }

    @Test void transientFailuresBackOffThenDeadLetter() {
        when(store.target(any())).thenReturn(Optional.of(new Target(ENDPOINT, null, null)));
        var first = claimed(1, false);
        dispatcher(503).handle(first);
        verify(store).retryAt(first, now.plusSeconds(2));
        var third = claimed(3, false);
        dispatcher(503).handle(third);
        verify(store).retryAt(third, now.plusSeconds(8));
        var last = claimed(4, false);
        dispatcher(503).handle(last);
        verify(store).dead(last, "gave_up", now);
    }

    @Test void rejectedGoneAndExpiredIntents() {
        when(store.target(any())).thenReturn(Optional.of(new Target(ENDPOINT, null, null)));
        var rejected = claimed(1, false);
        dispatcher(400).handle(rejected);
        verify(store).dead(rejected, "rejected", now);
        var gone = claimed(1, false);
        dispatcher(410).handle(gone);
        verify(store).forgetEndpoint(gone, ENDPOINT);
        var expired = new Claimed(8, device.accountId(), device.deviceId(), true, 1, now.minusSeconds(1));
        dispatcher(200).handle(expired);
        verify(store).dead(expired, "expired", now);
        verify(store, never()).target(expired);
    }

    @Test void aRecentWakeCoalescesAndAMissingEndpointDropsTheIntent() {
        var c = claimed(1, false);
        when(store.target(c)).thenReturn(Optional.of(new Target(ENDPOINT, now.minusSeconds(10), null)));
        dispatcher(200).handle(c);
        verify(store).remove(c);
        verify(store, never()).delivered(any(), any());
        var urgent = claimed(1, true); // the urgent limit is separate (3 s), so a call still rings
        when(store.target(urgent)).thenReturn(Optional.of(new Target(ENDPOINT, now.minusSeconds(10), null)));
        dispatcher(200).handle(urgent);
        verify(store).delivered(urgent, now);
        var orphan = new Claimed(9, device.accountId(), 2, false, 1, now.plusSeconds(60));
        when(store.target(orphan)).thenReturn(Optional.empty());
        dispatcher(200).handle(orphan);
        verify(store).remove(orphan);
    }
}
