package com.enclave.identity.internal.device;

import com.enclave.contracts.DeviceAddress;
import com.enclave.identity.DeviceRoster;
import com.enclave.identity.IdentityApi;
import com.enclave.identity.internal.account.AccountRepository;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Default {@link IdentityApi} implementation backed by the identity tables. */
@Service
class IdentityApiImpl implements IdentityApi {

    private final AccountRepository accounts;
    private final DeviceRepository devices;

    IdentityApiImpl(AccountRepository accounts, DeviceRepository devices) {
        this.accounts = accounts;
        this.devices = devices;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<DeviceRoster> activeRoster(UUID accountId) {
        return accounts.findById(accountId)
                .filter(a -> !a.disabled())
                .map(a -> new DeviceRoster(accountId, a.deviceListVersion(), devices.findActive(accountId).stream()
                        .map(d -> new DeviceRoster.Entry(d.deviceId(), d.registrationId()))
                        .toList()));
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<KeyState> keyState(UUID accountId) {
        return accounts.findById(accountId).filter(a -> a.identityKey() != null)
                .map(a -> new KeyState(a.identityKey(), new DeviceRoster(accountId, a.deviceListVersion(), a.disabled() ? java.util.List.of()
                        : devices.findActive(accountId).stream().map(d -> new DeviceRoster.Entry(d.deviceId(), d.registrationId())).toList())));
    }

    @Override
    @Transactional(readOnly = true)
    public java.util.List<UUID> accountsWithIdentityKey() { return accounts.withIdentityKey(); }

    @Override
    @Transactional(readOnly = true)
    public boolean isActive(DeviceAddress address) {
        return accounts.findById(address.accountId()).filter(a -> !a.disabled()).isPresent()
                && devices.find(address.accountId(), address.deviceId()).map(Device::active).orElse(false);
    }
}
