package com.enclave.platform.config;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** Infrastructure beans shared by all modules. */
@Configuration(proxyBeanMethods = false)
class InfrastructureConfig {

    /**
     * Single time source so tests can substitute a fixed clock. Persistence code should prefer
     * database {@code now()} for expiry comparisons evaluated in SQL.
     *
     * @return UTC system clock
     */
    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}
