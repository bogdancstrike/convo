package com.enclave.calls;

import java.time.LocalDate;
import java.util.List;

/** Read-only call totals for operators: counts per day, never who called whom. */
public interface CallsApi {

    /**
     * @param day calendar day (UTC)
     * @param calls calls started that day
     * @param video of which with video
     * @param group of which group calls
     */
    record CallDay(LocalDate day, long calls, long video, long group) {}

    /** Calls started per day since {@code from} (days without calls are omitted). */
    List<CallDay> callsPerDay(LocalDate from);
}
