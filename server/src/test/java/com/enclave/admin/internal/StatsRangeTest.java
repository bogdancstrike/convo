package com.enclave.admin.internal;

import static org.assertj.core.api.Assertions.*;
import com.enclave.contracts.EnclaveException;
import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class StatsRangeTest {
    private final LocalDate today = LocalDate.of(2026, 10, 24);
    @Test void oneDayMeansExactlyOneDayAndHistoricalRangesAreNotLimitedToNinetyDaysAgo() {
        assertThat(StatsRange.of(1, null, null, today)).isEqualTo(new StatsRange(today, today, 1));
        assertThat(StatsRange.of(30, LocalDate.of(2010, 1, 1), LocalDate.of(2010, 1, 31), today).days()).isEqualTo(31);
        assertThat(StatsRange.of(7, null, null, today).from()).isEqualTo(today.minusDays(6));
    }
    @Test void rejectsIncompleteReversedFutureAndUnboundedQueryWindows() {
        assertThatThrownBy(() -> StatsRange.of(1, today, null, today)).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(() -> StatsRange.of(1, today, today.minusDays(1), today)).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(() -> StatsRange.of(1, today, today.plusDays(1), today)).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(() -> StatsRange.of(1, today.minusYears(20), today, today)).isInstanceOf(EnclaveException.class);
        assertThatThrownBy(() -> StatsRange.parse("invalid-date")).isInstanceOf(EnclaveException.class);
    }
}
