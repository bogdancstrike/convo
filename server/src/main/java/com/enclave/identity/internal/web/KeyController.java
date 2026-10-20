package com.enclave.identity.internal.web;

import static com.enclave.contracts.Base64Url.decode;
import static com.enclave.contracts.Base64Url.encode;

import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.internal.keys.KeyPackageService;
import com.enclave.identity.internal.keys.PrekeyService;
import com.enclave.identity.internal.web.IdentityDtos.BundleDto;
import com.enclave.identity.internal.web.IdentityDtos.ClaimRequest;
import com.enclave.identity.internal.web.IdentityDtos.ClaimResponse;
import com.enclave.identity.internal.web.IdentityDtos.ClaimedKeyPackageDto;
import com.enclave.identity.internal.web.IdentityDtos.DeviceRefDto;
import com.enclave.identity.internal.web.IdentityDtos.KeyPackageClaimRequest;
import com.enclave.identity.internal.web.IdentityDtos.KeyPackageClaimResponse;
import com.enclave.identity.internal.web.IdentityDtos.KeyPackagesUploadRequest;
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

/** Signal prekey and MLS KeyPackage endpoints (specs §12.2). */
@RestController
@RequestMapping("/v1")
class KeyController {

    private final PrekeyService prekeys;
    private final KeyPackageService keyPackages;

    KeyController(PrekeyService prekeys, KeyPackageService keyPackages) {
        this.prekeys = prekeys;
        this.keyPackages = keyPackages;
    }

    /** Uploads a replacement signed prekey and/or more one-time prekeys. */
    @PutMapping("/keys")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void upload(@AuthenticationPrincipal AuthenticatedDevice me, @Valid @RequestBody KeysUploadRequest body) {
        prekeys.upload(me.address(), body.signedPreKey() == null ? null : body.signedPreKey().toDomain(),
                body.preKeys().stream().map(PreKeyDto::toDomain).toList());
    }

    /** Remaining one-time prekeys for the calling device. */
    @GetMapping("/keys/status")
    KeyStatusResponse status(@AuthenticationPrincipal AuthenticatedDevice me) {
        return new KeyStatusResponse(prekeys.remaining(me.address()));
    }

    /** Uploads MLS KeyPackages for the calling device. */
    @PutMapping("/keypackages")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void uploadKeyPackages(@AuthenticationPrincipal AuthenticatedDevice me, @Valid @RequestBody KeyPackagesUploadRequest body) {
        keyPackages.upload(me.address(), body.keyPackages().stream()
                .map(k -> new KeyPackageService.Upload(decode(k.ref(), "ref"), decode(k.keyPackage(), "keyPackage")))
                .toList());
    }

    /** Remaining KeyPackages of the calling device. */
    @GetMapping("/keypackages/status")
    KeyStatusResponse keyPackageStatus(@AuthenticationPrincipal AuthenticatedDevice me) {
        return new KeyStatusResponse(keyPackages.remaining(me.address()));
    }

    /** Claims one KeyPackage per active device of each account (caller device excluded). */
    @PostMapping("/keypackages/claim")
    KeyPackageClaimResponse claimKeyPackages(@AuthenticationPrincipal AuthenticatedDevice me,
            @Valid @RequestBody KeyPackageClaimRequest body) {
        var result = keyPackages.claim(me.address(), body.accountIds());
        return new KeyPackageClaimResponse(
                result.keyPackages().stream().map(k -> new ClaimedKeyPackageDto(k.accountId(), k.deviceId(), encode(k.keyPackage()))).toList(),
                result.unavailable().stream().map(d -> new DeviceRefDto(d.accountId(), d.deviceId())).toList());
    }

    /** Claims one bundle per selected active device of an account. */
    @PostMapping("/keys/{accountId}/claim")
    ClaimResponse claim(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID accountId,
            @Valid @RequestBody(required = false) ClaimRequest body) {
        List<Integer> ids = body == null || body.deviceIds() == null ? List.of() : body.deviceIds();
        var claim = prekeys.claim(me.address(), accountId, ids);
        return new ClaimResponse(accountId, claim.identityKey() == null ? null : encode(claim.identityKey()),
                claim.deviceListVersion(), claim.bundles().stream().map(BundleDto::of).toList());
    }
}
