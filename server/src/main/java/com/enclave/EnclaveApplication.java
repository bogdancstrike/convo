package com.enclave;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;
import org.springframework.modulith.Modulith;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Entry point of the single Enclave Spring Modulith runtime.
 *
 * <p>Every direct sub-package of {@code com.enclave} is an application module (identity,
 * messaging, platform, ...). Module boundaries are verified by {@code ModularityTests};
 * see {@code docs.md} in this package for the module map.
 */
@Modulith(sharedModules = "contracts")
@SpringBootApplication
@ConfigurationPropertiesScan
@EnableScheduling
@EnableAsync
public class EnclaveApplication {

    /**
     * Starts the backend.
     *
     * @param args standard Spring Boot command-line arguments
     */
    public static void main(String[] args) {
        SpringApplication.run(EnclaveApplication.class, args);
    }
}
