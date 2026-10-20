package com.enclave.identity.internal.web;

import static com.enclave.contracts.Base64Url.*;
import com.enclave.contracts.DeploymentProperties;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.internal.account.AccountService;
import com.enclave.identity.internal.enrollment.EnrollmentService;
import com.enclave.identity.internal.enrollment.PrimaryRegistration;
import com.enclave.identity.internal.recovery.RecoveryService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
class RecoveryController {
    private final RecoveryService recovery;
    private final EnrollmentService enrollment;
    private final AccountService accounts;
    private final OidcIdentityResolver identities;
    private final DeploymentProperties deployment;
    RecoveryController(RecoveryService recovery, EnrollmentService enrollment, AccountService accounts,
            OidcIdentityResolver identities, DeploymentProperties deployment) {
        this.recovery=recovery; this.enrollment=enrollment; this.accounts=accounts; this.identities=identities; this.deployment=deployment;
    }
    record Save(@NotBlank String ciphertext, @NotBlank String authorizationHash) {}
    record Authorize(@NotBlank String authorizationKey) {}
    record Recover(@NotNull @Valid IdentityDtos.PrimaryRegistrationRequest registration, @NotBlank String authorizationKey) {}

    @PutMapping("/v1/recovery")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void save(@AuthenticationPrincipal AuthenticatedDevice me, @Valid @RequestBody Save body) {
        recovery.save(me.accountId(), decode(body.ciphertext(), "ciphertext"), decode(body.authorizationHash(), "authorizationHash"));
    }
    @GetMapping("/v1/recovery/status")
    Map<String, Boolean> status(@AuthenticationPrincipal AuthenticatedDevice me) {
        return Map.of("configured", recovery.configured(me.accountId()));
    }
    @GetMapping("/v1/recovery")
    Map<String, String> backup(@AuthenticationPrincipal Jwt jwt) {
        var account=accounts.resolveOrProvision(identities.resolve(jwt));
        return Map.of("accountId",account.accountId().toString(),"deploymentId",deployment.id(),"ciphertext",encode(recovery.backup(account.accountId())));
    }
    @PostMapping("/v1/recovery/reservations")
    IdentityDtos.ReservationResponse reserve(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Authorize body) {
        var identity=identities.resolve(jwt);
        recovery.authorize(accounts.resolveOrProvision(identity).accountId(), decode(body.authorizationKey(), "authorizationKey"));
        var r=enrollment.reserve(identity,"recovery");
        return new IdentityDtos.ReservationResponse(r.reservationId(),r.accountId(),r.deviceId(),encode(r.challenge()),deployment.id(),r.expiresAt());
    }
    @PostMapping("/v1/devices/recover")
    IdentityDtos.RegistrationResponse recover(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody Recover request) {
        var body=request.registration();
        var result=enrollment.registerRecovered(identities.resolve(jwt), new PrimaryRegistration(body.reservationId(),
                decode(body.identityKey(),"identityKey"),body.registrationId(),body.signedPreKey().toDomain(),
                body.preKeys().stream().map(IdentityDtos.PreKeyDto::toDomain).toList(),decode(body.signingKey(),"signingKey"),
                body.signingKeyProfile(),decode(body.registrationProof(),"registrationProof"),body.platform(),
                body.nameEnc()==null?null:decode(body.nameEnc(),"nameEnc")),decode(request.authorizationKey(),"authorizationKey"));
        return new IdentityDtos.RegistrationResponse(result.address().accountId(),result.address().deviceId(),result.deviceListVersion());
    }
}
