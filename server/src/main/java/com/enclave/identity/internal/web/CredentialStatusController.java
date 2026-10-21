package com.enclave.identity.internal.web;

import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.internal.credentials.CredentialStatusService;
import com.enclave.identity.internal.credentials.CredentialStatusService.CredentialStatus;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Own-account credential types (passkey / authenticator app) for client lock gating. */
@RestController
class CredentialStatusController {
    private final CredentialStatusService service;
    CredentialStatusController(CredentialStatusService service) { this.service = service; }

    @GetMapping("/v1/account/credentials")
    ResponseEntity<CredentialStatus> credentials(@AuthenticationPrincipal AuthenticatedDevice me,
            @org.springframework.web.bind.annotation.RequestParam(defaultValue = "false") boolean refresh) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(service.status(me.accountId(), refresh));
    }
}
