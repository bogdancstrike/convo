package com.enclave.identity.internal.keys;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.PrekeysLow;
import com.enclave.identity.internal.IdentityProperties;
import com.enclave.identity.internal.account.Account;
import com.enclave.identity.internal.account.AccountRepository;
import com.enclave.identity.internal.device.Device;
import com.enclave.identity.internal.device.DeviceRepository;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Prekey upload, status and claims (specs §5.1, §12.2).
 *
 * <p>The server cannot verify XEdDSA signed-prekey signatures without the Signal library on the
 * JVM; clients verify every bundle under the peer's identity key before use (specs §4.6).
 */
@Service
public class PrekeyService {

    private final PrekeyRepository prekeys;
    private final DeviceRepository devices;
    private final AccountRepository accounts;
    private final IdentityProperties properties;
    private final ApplicationEventPublisher events;

    PrekeyService(PrekeyRepository prekeys, DeviceRepository devices, AccountRepository accounts,
            IdentityProperties properties, ApplicationEventPublisher events) {
        this.prekeys = prekeys;
        this.devices = devices;
        this.accounts = accounts;
        this.properties = properties;
        this.events = events;
    }

    /**
     * Stores a new signed prekey and/or additional one-time prekeys for the calling device.
     *
     * @param device calling device
     * @param signed new signed prekey, or {@code null} to keep the current one
     * @param oneTime one-time prekeys to add
     * @throws EnclaveException {@code PAYLOAD_TOO_LARGE} when limits are exceeded
     */
    @Transactional
    public void upload(DeviceAddress device, SignedPreKey signed, List<OneTimePreKey> oneTime) {
        if (oneTime.size() > properties.maxPrekeysPerUpload()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "too many prekeys in one upload");
        }
        int stored = prekeys.countOneTime(device.accountId(), device.deviceId());
        if (stored + oneTime.size() > properties.maxStoredPrekeys()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "prekey storage limit reached");
        }
        if (signed != null) {
            prekeys.upsertSigned(device.accountId(), device.deviceId(), signed);
        }
        prekeys.insertOneTime(device.accountId(), device.deviceId(), oneTime);
    }

    /** @return remaining one-time prekeys of the calling device */
    @Transactional(readOnly = true)
    public int remaining(DeviceAddress device) {
        return prekeys.countOneTime(device.accountId(), device.deviceId());
    }

    /**
     * Claims one bundle per selected active device of {@code target}. The caller's own device is
     * never included.
     *
     * @param caller requesting device
     * @param target account whose devices are claimed
     * @param deviceIds optional subset; empty means all active devices
     * @return the identity key and bundles
     */
    @Transactional
    public Claim claim(DeviceAddress caller, UUID target, Collection<Integer> deviceIds) {
        Account account = accounts.findById(target).filter(a -> !a.disabled())
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown account"));
        Set<Integer> wanted = Set.copyOf(deviceIds);
        List<PreKeyBundle> bundles = new ArrayList<>();
        for (Device d : devices.findActive(target)) {
            if ((!wanted.isEmpty() && !wanted.contains(d.deviceId()))
                    || (target.equals(caller.accountId()) && d.deviceId() == caller.deviceId())) {
                continue;
            }
            var signed = prekeys.findSigned(target, d.deviceId());
            if (signed.isEmpty()) {
                continue; // incomplete enrollment: not addressable yet
            }
            var oneTime = prekeys.popOneTime(target, d.deviceId());
            bundles.add(new PreKeyBundle(d.deviceId(), d.registrationId(), signed.get(), oneTime.orElse(null)));
            int left = prekeys.countOneTime(target, d.deviceId());
            if (left < properties.prekeyLowWatermark()) {
                events.publishEvent(new PrekeysLow(new DeviceAddress(target, d.deviceId()), left));
            }
        }
        return new Claim(account.identityKey(), account.deviceListVersion(), bundles);
    }

    /**
     * Result of a claim.
     *
     * @param identityKey account identity public key
     * @param deviceListVersion device-list version observed during the claim
     * @param bundles one bundle per claimed device
     */
    public record Claim(byte[] identityKey, long deviceListVersion, List<PreKeyBundle> bundles) {}
}
