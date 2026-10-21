package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** Defaults apply when nothing is configured: activity counting on, 90-day retention. */
class AdminPropertiesTest {
    @EnableConfigurationProperties(AdminProperties.class)
    static class Config {}

    @Test void nestedDefaultsBind() {
        new ApplicationContextRunner().withUserConfiguration(Config.class).run(ctx -> {
            AdminProperties p = ctx.getBean(AdminProperties.class);
            assertThat(p.activity().enabled()).isTrue();
            assertThat(p.activity().retention().toDays()).isEqualTo(90);
            assertThat(p.idp().clientId()).isEqualTo("convo-admin-ops");
        });
    }
}
