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
    /** {@code ttlMinutes} is optional; the server default and maximum apply. */
    record CreateLink(String groupId, Integer ttlMinutes) {}

    private final CallService service;
    private final CallLinks links;
    CallController(CallService service, CallLinks links) { this.service = service; this.links = links; }

    /** A member creates a link to the group's call; the token is returned once. */
    @PostMapping("/v1/calls/links")
    ResponseEntity<CallLinks.Created> createLink(@AuthenticationPrincipal AuthenticatedDevice me, @RequestBody CreateLink body) {
        var ttl = body.ttlMinutes() == null ? null : java.time.Duration.ofMinutes(body.ttlMinutes());
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(links.create(me, Base64Url.decode(body.groupId(), "groupId"), ttl));
    }

    /** Members only: which group the link belongs to and its joinable call, if any. */
    @PostMapping("/v1/calls/links/{token}/resolve")
    ResponseEntity<CallLinks.Resolved> resolveLink(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String token) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(links.resolve(me, token));
    }

    @DeleteMapping("/v1/calls/links/{token}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void revokeLink(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable String token) { links.revoke(me, token); }

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
