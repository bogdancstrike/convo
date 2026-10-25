package com.enclave.transparency.internal;

import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * {@code enclave.kt.*}.
 *
 * @param signingKey log signing key (base64 PKCS#8 Ed25519; from the environment). Empty: a key is
 *     generated once and stored in {@code kt_signing_key} (development only)
 * @param witnesses trusted witnesses as {@code id:base64-raw-ed25519-public-key}; their
 *     co-signatures are stored and served to clients
 * @param maxWitnessAge clients treat the log as unwitnessed when the newest co-signed head is older
 *     (served as a hint; client policy decides whether that blocks sending)
 */
@Validated
@ConfigurationProperties("enclave.kt")
record KeyTransparencyProperties(
        @DefaultValue("") String signingKey,
        @DefaultValue({}) List<String> witnesses,
        @DefaultValue("7d") @NotNull Duration maxWitnessAge) {}
