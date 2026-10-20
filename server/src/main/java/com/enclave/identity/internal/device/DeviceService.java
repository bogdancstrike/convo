package com.enclave.identity.internal.device;

import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.DeviceRevoked;
import com.enclave.identity.internal.account.AccountRepository;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Own-device listing and revocation (specs §4.7, §12.1). */
@Service
public class DeviceService {

    private static final Logger log = LoggerFactory.getLogger(DeviceService.class);

    private final DeviceRepository devices;
    private final AccountRepository accounts;
    private final ApplicationEventPublisher events;

    DeviceService(DeviceRepository devices, AccountRepository accounts, ApplicationEventPublisher events) {
        this.devices = devices;
        this.accounts = accounts;
        this.events = events;
    }

    /** @return the account's active devices */
    @Transactional(readOnly = true)
    public List<Device> listActive(UUID accountId) {
        return devices.findActive(accountId);
    }

    /**
     * Revokes a device of the caller's account. Credential invalidation, prekey deletion, the
     * device-list bump and the {@link DeviceRevoked} event commit atomically; consumers close the
     * socket and purge the mailbox.
     *
     * @param accountId owning account (from the authenticated principal)
     * @param deviceId device to revoke
     * @param reason sanitized reason recorded in the event
     * @throws EnclaveException {@code NOT_FOUND} if the device is not an active device of the account
     */
    @Transactional
    public void revoke(UUID accountId, int deviceId, String reason) {
        accounts.lock(accountId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown account"));
        if (!devices.revoke(accountId, deviceId)) {
            throw new EnclaveException(ErrorCode.NOT_FOUND, "no such active device");
        }
        long version = accounts.bumpDeviceListVersion(accountId);
        events.publishEvent(new DeviceRevoked(new DeviceAddress(accountId, deviceId), version, reason));
        log.info("Revoked device {}.{} ({})", accountId, deviceId, reason);
    }
}
