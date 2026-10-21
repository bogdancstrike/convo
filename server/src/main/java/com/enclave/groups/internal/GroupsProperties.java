package com.enclave.groups.internal;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Group limits ({@code enclave.groups.*}); defaults from specs §6.1 and §26.3.
 *
 * @param maxMembers maximum member accounts per group
 * @param maxDevices maximum devices (MLS leaves) per group
 * @param maxMessageBytes maximum application message size
 * @param maxHandshakeBytes maximum commit/welcome size
 * @param submissionRetention idempotency record retention
 * @param inviteTtl lifetime of an invite link
 * @param maxJoinRequests pending join requests per group (abuse bound)
 */
@Validated
@ConfigurationProperties("enclave.groups")
public record GroupsProperties(
        @DefaultValue("1000") @Min(2) int maxMembers,
        @DefaultValue("5000") @Min(2) int maxDevices,
        @DefaultValue("262144") @Min(1024) int maxMessageBytes,
        @DefaultValue("1048576") @Min(1024) int maxHandshakeBytes,
        @DefaultValue("31d") @NotNull Duration submissionRetention,
        @DefaultValue("7d") @NotNull Duration inviteTtl,
        @DefaultValue("200") @Min(1) int maxJoinRequests) {}
