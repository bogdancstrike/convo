package com.enclave.messaging.internal.submission;

/**
 * Outcome of an accepted submission (specs §9.2 {@code SendResult}). Rejections are signalled by
 * {@link com.enclave.contracts.EnclaveException}s carrying {@code missing}/{@code extra}/
 * {@code stale} properties.
 *
 * @param ok always {@code true} for accepted submissions
 * @param duplicate {@code true} if this was an idempotent replay of an earlier accepted submission
 */
public record SendResult(boolean ok, boolean duplicate) {}
