package com.enclave.identity.internal.account;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class UsernamePolicyTest {

    @ParameterizedTest
    @CsvSource({
        "alice, alice",
        "Ana.Popescu@example.ro, ana.popescu",
        "Ștefan Țăran, stefantaran",
        "x, fallback",
        "'', fallback",
    })
    void normalizesClaimsIntoValidHandles(String claim, String expected) {
        String handle = UsernamePolicy.normalize(claim, "fallback");
        assertThat(handle).isEqualTo(expected);
        assertThat(UsernamePolicy.VALID.matcher(handle).matches()).isTrue();
    }

    @Test
    void truncatesLongHandlesAndSuffixesWithinLimit() {
        String base = UsernamePolicy.normalize("a".repeat(50), "fallback");
        assertThat(base).hasSize(32);
        assertThat(UsernamePolicy.withSuffix(base, 12)).hasSize(32).endsWith("-12");
    }
}
