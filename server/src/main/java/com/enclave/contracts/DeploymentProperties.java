package com.enclave.contracts;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.validation.annotation.Validated;

/**
 * Deployment identity ({@code enclave.deployment.*}). The deployment ID is bound into every
 * signed enrollment/request transcript so signatures cannot be replayed against another
 * installation (specs §27.1).
 *
 * @param id stable, unique deployment identifier (e.g. {@code acme-prod}); never change after
 *     first enrollment
 * @param displayName organization name shown on the sign-in screen
 * @param publicBaseUrl externally visible HTTPS base URL clients connect to
 */
@Validated
@ConfigurationProperties("enclave.deployment")
public record DeploymentProperties(
        @NotBlank @Pattern(regexp = "[a-z0-9][a-z0-9.-]{1,62}") @DefaultValue("enclave-dev") String id,
        @NotBlank @DefaultValue("Enclave") String displayName,
        @NotBlank @DefaultValue("http://localhost:8088") String publicBaseUrl) {}
