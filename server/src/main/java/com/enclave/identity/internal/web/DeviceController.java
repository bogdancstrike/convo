package com.enclave.identity.internal.web;

import static com.enclave.contracts.Base64Url.encode;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.internal.device.DeviceService;
import com.enclave.identity.internal.web.IdentityDtos.DeviceDto;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Own-device management ({@code D}-authenticated, specs §12.1). */
@RestController
@RequestMapping("/v1/devices")
class DeviceController {

    private final DeviceService devices;

    DeviceController(DeviceService devices) {
        this.devices = devices;
    }

    /** Lists the caller's active devices; labels are owner-encrypted. */
    @GetMapping
    List<DeviceDto> list(@AuthenticationPrincipal AuthenticatedDevice me) {
        return devices.listActive(me.accountId()).stream()
                .map(d -> new DeviceDto(d.deviceId(), d.platform(), d.nameEnc() == null ? null : encode(d.nameEnc()),
                        d.createdAt(), d.lastSeenDay(), d.deviceId() == me.deviceId()))
                .toList();
    }

    /** Unlinks another device of the caller's account. */
    @DeleteMapping("/{deviceId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void unlink(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable int deviceId) {
        if (deviceId == me.deviceId()) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "use DELETE /v1/devices/self to unregister this device");
        }
        devices.revoke(me.accountId(), deviceId, "unlinked");
    }

    /** Unregisters the calling device. */
    @DeleteMapping("/self")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void unregisterSelf(@AuthenticationPrincipal AuthenticatedDevice me) {
        devices.revoke(me.accountId(), me.deviceId(), "self");
    }
}
