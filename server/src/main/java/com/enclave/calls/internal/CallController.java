package com.enclave.calls.internal;

import com.enclave.contracts.Base64Url;
import com.enclave.identity.AuthenticatedDevice;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Device-authenticated call endpoints. Responses carry secrets (tokens): never cached. */
@RestController
class CallController {
    record CreateCall(UUID peer, String groupId, boolean video) {}

    private final CallService service;
    CallController(CallService service) { this.service = service; }

    @PostMapping("/v1/calls")
    ResponseEntity<CallService.Join> create(@AuthenticationPrincipal AuthenticatedDevice me, @RequestBody CreateCall body) {
        byte[] group = body.groupId() == null ? null : Base64Url.decode(body.groupId(), "groupId");
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.create(me, body.peer(), group, body.video()));
    }

    @PostMapping("/v1/calls/{callId}/join")
    ResponseEntity<CallService.Join> join(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID callId) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.join(me, callId));
    }

    @PostMapping("/v1/calls/{callId}/end")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void end(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID callId) { service.end(me, callId); }
}
