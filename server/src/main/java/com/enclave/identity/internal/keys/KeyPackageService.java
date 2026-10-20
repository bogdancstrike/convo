package com.enclave.identity.internal.keys;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.KeyPackagesLow;
import com.enclave.identity.internal.IdentityProperties;
import com.enclave.identity.internal.account.AccountRepository;
import com.enclave.identity.internal.device.Device;
import com.enclave.identity.internal.device.DeviceRepository;
import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * MLS KeyPackage distribution (specs §6.9, §12.2). KeyPackages are public, single-use and
 * consumed atomically; the server does not parse them — clients validate credentials and
 * signatures when adding members.
 */
@Service
public class KeyPackageService {

    private final KeyPackageRepository keyPackages;
    private final DeviceRepository devices;
    private final AccountRepository accounts;
    private final IdentityProperties properties;
    private final ApplicationEventPublisher events;

    KeyPackageService(KeyPackageRepository keyPackages, DeviceRepository devices, AccountRepository accounts,
            IdentityProperties properties, ApplicationEventPublisher events) {
        this.keyPackages = keyPackages;
        this.devices = devices;
        this.accounts = accounts;
        this.properties = properties;
        this.events = events;
    }

    /** One uploaded KeyPackage: client-computed reference and encoded package. */
    public record Upload(byte[] ref, byte[] keyPackage) {}

    /** A claimed KeyPackage for one device. */
    public record Claimed(UUID accountId, int deviceId, byte[] keyPackage) {}

    /**
     * Stores KeyPackages for the calling device.
     *
     * @throws EnclaveException {@code PAYLOAD_TOO_LARGE} when count/size limits are exceeded
     */
    @Transactional
    public void upload(DeviceAddress device, List<Upload> uploads) {
        var limits = properties.keyPackages();
        if (uploads.size() > limits.maxPerUpload()
                || keyPackages.count(device.accountId(), device.deviceId()) + uploads.size() > limits.maxStored()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "too many key packages");
        }
        for (Upload u : uploads) {
            if (u.ref() == null || u.ref().length == 0 || u.ref().length > 64 || u.keyPackage() == null
                    || u.keyPackage().length == 0 || u.keyPackage().length > limits.maxBytes()) {
                throw new EnclaveException(ErrorCode.INVALID_REQUEST, "invalid key package");
            }
            keyPackages.insert(device.accountId(), device.deviceId(), u.ref(), u.keyPackage());
        }
    }

    /** @return remaining KeyPackages of the calling device */
    @Transactional(readOnly = true)
    public int remaining(DeviceAddress device) {
        return keyPackages.count(device.accountId(), device.deviceId());
    }

    /**
     * Claims one KeyPackage for every active device of the given accounts (the caller's own device
     * excluded). Devices without a KeyPackage are reported so the caller can surface them.
     */
    @Transactional
    public ClaimResult claim(DeviceAddress caller, Collection<UUID> accountIds) {
        if (accountIds.size() > properties.keyPackages().maxAccountsPerClaim()) {
            throw new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "too many accounts in one claim");
        }
        List<Claimed> claimed = new ArrayList<>();
        List<DeviceAddress> unavailable = new ArrayList<>();
        for (UUID accountId : new LinkedHashSet<>(accountIds)) {
            if (accounts.findById(accountId).filter(a -> !a.disabled()).isEmpty()) {
                throw new EnclaveException(ErrorCode.NOT_FOUND, "unknown account");
            }
            for (Device d : devices.findActive(accountId)) {
                DeviceAddress address = new DeviceAddress(accountId, d.deviceId());
                if (address.equals(caller)) {
                    continue;
                }
                var kp = keyPackages.pop(accountId, d.deviceId());
                if (kp.isPresent()) {
                    claimed.add(new Claimed(accountId, d.deviceId(), kp.get()));
                } else {
                    unavailable.add(address);
                }
                int left = keyPackages.count(accountId, d.deviceId());
                if (left < properties.keyPackages().lowWatermark()) {
                    events.publishEvent(new KeyPackagesLow(address, left));
                }
            }
        }
        return new ClaimResult(claimed, unavailable);
    }

    /** Deletes a revoked device's KeyPackages so it can never be added to groups again. */
    @Transactional
    public void deleteAll(DeviceAddress device) {
        keyPackages.deleteAll(device.accountId(), device.deviceId());
    }

    /**
     * @param keyPackages claimed packages
     * @param unavailable active devices that currently have no KeyPackage
     */
    public record ClaimResult(List<Claimed> keyPackages, List<DeviceAddress> unavailable) {}
}
