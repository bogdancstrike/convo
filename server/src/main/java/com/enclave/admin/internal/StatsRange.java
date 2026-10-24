package com.enclave.admin.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;

/** Inclusive UTC reporting range. Query limits do not imply a data-retention policy. */
record StatsRange(LocalDate from, LocalDate to, int days) {
    static StatsRange of(int days, LocalDate from, LocalDate to, LocalDate today) {
        if ((from == null) != (to == null)) throw invalid("Both start and end dates are required.");
        LocalDate end = to == null ? today : to;
        LocalDate start = from == null ? end.minusDays(Math.max(1, Math.min(3660, days)) - 1L) : from;
        long count = ChronoUnit.DAYS.between(start, end) + 1;
        if (count < 1) throw invalid("Start date must be on or before end date.");
        if (count > 3660) throw invalid("Select at most ten years per chart query.");
        if (end.isAfter(today)) throw invalid("The reporting range cannot end in the future.");
        return new StatsRange(start, end, (int) count);
    }
    static LocalDate parse(String value) {
        if (value == null || value.isBlank()) return null;
        try { return LocalDate.parse(value); } catch (java.time.format.DateTimeParseException e) { throw invalid("Dates must use YYYY-MM-DD."); }
    }
    private static EnclaveException invalid(String message) { return new EnclaveException(ErrorCode.INVALID_REQUEST, message); }
}
