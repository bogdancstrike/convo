package com.enclave.messaging.internal.submission;

import com.enclave.contracts.DeviceAddress;
import java.util.List;

/**
 * Internal event published inside the submission transaction; the gateway signals the listed
 * devices after commit.
 *
 * @param recipients devices that received new envelopes
 * @param urgent sender's priority hint (e.g. a call ring)
 */
public record EnvelopesStored(List<DeviceAddress> recipients, boolean urgent) {}
