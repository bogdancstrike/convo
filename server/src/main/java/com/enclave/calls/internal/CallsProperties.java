package com.enclave.calls.internal;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * {@code enclave.calls.*}.
 *
 * @param enabled whether calls are offered (requires a LiveKit key/secret)
 * @param livekitPath path on the public origin that nginx proxies to LiveKit's signalling port
 * @param apiKey LiveKit API key
 * @param apiSecret LiveKit API secret (≥ 32 characters; from the environment only)
 * @param tokenTtl lifetime of a join token (LiveKit keeps connected participants after expiry)
 * @param maxCallAge after this a call can no longer be joined
 * @param maxGroupParticipants upper bound for group calls
 * @param livekitUrl LiveKit HTTP API as reachable from the server (room administration, e.g.
 *     removing a member who left the group); empty disables it
 */
@Validated
@ConfigurationProperties("enclave.calls")
public record CallsProperties(
        @DefaultValue("false") boolean enabled,
        @DefaultValue("/rtc") @NotBlank String livekitPath,
        @DefaultValue("convo") @NotBlank String apiKey,
        @DefaultValue("") String apiSecret,
        @DefaultValue("10m") @NotNull Duration tokenTtl,
        @DefaultValue("12h") @NotNull Duration maxCallAge,
        @DefaultValue("16") @Min(2) @Max(100) int maxGroupParticipants,
        @DefaultValue("") String livekitUrl) {

    boolean usable() { return enabled && apiSecret.length() >= 32; }
}
