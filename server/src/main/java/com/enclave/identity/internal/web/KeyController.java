package com.enclave.identity.internal.web;

import static com.enclave.contracts.Base64Url.encode;

import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.internal.keys.PrekeyService;
import com.enclave.identity.internal.web.IdentityDtos.BundleDto;
import com.enclave.identity.internal.web.IdentityDtos.ClaimRequest;
import com.enclave.identity.internal.web.IdentityDtos.ClaimResponse;
import com.enclave.identity.internal.web.IdentityDtos.KeyStatusResponse;
import com.enclave.identity.internal.web.IdentityDtos.KeysUploadRequest;
import com.enclave.identity.internal.web.IdentityDtos.PreKeyDto;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Signal prekey endpoints (specs §12.2). */
@RestController
@RequestMapping("/v1/keys")
class KeyController {

    private final PrekeyService prekeys;

    KeyController(PrekeyService prekeys) {
        this.prekeys = prekeys;
    }

    /** Uploads a replacement signed prekey and/or more one-time prekeys. */
    @PutMapping
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void upload(@AuthenticationPrincipal AuthenticatedDevice me, @Valid @RequestBody KeysUploadRequest body) {
        prekeys.upload(me.address(), body.signedPreKey() == null ? null : body.signedPreKey().toDomain(),
                body.preKeys().stream().map(PreKeyDto::toDomain).toList());
    }

    /** Remaining one-time prekeys for the calling device. */
    @GetMapping("/status")
    KeyStatusResponse status(@AuthenticationPrincipal AuthenticatedDevice me) {
        return new KeyStatusResponse(prekeys.remaining(me.address()));
    }

    /** Claims one bundle per selected active device of an account. */
    @PostMapping("/{accountId}/claim")
    ClaimResponse claim(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID accountId,
            @Valid @RequestBody(required = false) ClaimRequest body) {
        List<Integer> ids = body == null || body.deviceIds() == null ? List.of() : body.deviceIds();
        var claim = prekeys.claim(me.address(), accountId, ids);
        return new ClaimResponse(accountId, claim.identityKey() == null ? null : encode(claim.identityKey()),
                claim.deviceListVersion(), claim.bundles().stream().map(BundleDto::of).toList());
    }
}
