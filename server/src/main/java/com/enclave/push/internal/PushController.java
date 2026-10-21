package com.enclave.push.internal;

import com.enclave.identity.AuthenticatedDevice;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Device-authenticated registration of this device's UnifiedPush endpoint. */
@RestController
class PushController {
    record Endpoint(@NotBlank @Size(max = 512) String endpoint) {}

    private final PushService push;
    PushController(PushService push) { this.push = push; }

    @PutMapping("/v1/push/endpoint")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void register(@AuthenticationPrincipal AuthenticatedDevice me, @Valid @RequestBody Endpoint body) {
        push.register(me.address(), body.endpoint());
    }

    @DeleteMapping("/v1/push/endpoint")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void unregister(@AuthenticationPrincipal AuthenticatedDevice me) {
        push.unregister(me.address());
    }
}
