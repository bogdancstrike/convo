package com.enclave.identity.internal.web;

import static com.enclave.contracts.Base64Url.decode;
import static com.enclave.contracts.Base64Url.encode;

import com.enclave.contracts.DeploymentProperties;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.internal.account.Account;
import com.enclave.identity.internal.account.AccountService;
import com.enclave.identity.internal.enrollment.EnrollmentService;
import com.enclave.identity.internal.enrollment.LinkRegistration;
import com.enclave.identity.internal.enrollment.Reservation;
import com.enclave.identity.internal.provisioning.ProvisioningService;
import com.enclave.identity.internal.provisioning.ProvisioningSession;
import com.enclave.identity.internal.web.IdentityDtos.LinkRegistrationRequest;
import com.enclave.identity.internal.web.IdentityDtos.PendingProvisioningDto;
import com.enclave.identity.internal.web.IdentityDtos.PreKeyDto;
import com.enclave.identity.internal.web.IdentityDtos.ProvisioningCodeRequest;
import com.enclave.identity.internal.web.IdentityDtos.ProvisioningCodeResponse;
import com.enclave.identity.internal.web.IdentityDtos.ProvisioningMessageRequest;
import com.enclave.identity.internal.web.IdentityDtos.ProvisioningOpenRequest;
import com.enclave.identity.internal.web.IdentityDtos.ProvisioningOpenResponse;
import com.enclave.identity.internal.web.IdentityDtos.ProvisioningStatusResponse;
import com.enclave.identity.internal.web.IdentityDtos.RegistrationResponse;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Device linking endpoints (specs §4.4, §12.1). New-device routes use the Keycloak bearer token;
 * approving-device routes use the device signature. See {@code provisioning/docs.md}.
 */
@RestController
class ProvisioningController {

    private final EnrollmentService enrollment;
    private final ProvisioningService provisioning;
    private final AccountService accounts;
    private final OidcIdentityResolver identities;
    private final DeploymentProperties deployment;

    ProvisioningController(EnrollmentService enrollment, ProvisioningService provisioning, AccountService accounts,
            OidcIdentityResolver identities, DeploymentProperties deployment) {
        this.enrollment = enrollment;
        this.provisioning = provisioning;
        this.accounts = accounts;
        this.identities = identities;
        this.deployment = deployment;
    }

    // --- new device (Keycloak bearer) --------------------------------------------------------

    /** Opens a linking session and reserves the new device address. */
    @PostMapping("/v1/provisioning/sessions")
    @ResponseStatus(HttpStatus.CREATED)
    @Transactional
    ProvisioningOpenResponse open(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ProvisioningOpenRequest body) {
        var identity = identities.resolve(jwt);
        Reservation r = enrollment.reserve(identity, "link");
        ProvisioningSession s = provisioning.open(r.accountId(), r.reservationId(),
                decode(body.ephemeralPublicKey(), "ephemeralPublicKey"), body.clientLabel(), r.expiresAt());
        return new ProvisioningOpenResponse(s.provisioningId(), r.reservationId(), r.accountId(), r.deviceId(), encode(r.challenge()),
                deployment.id(), s.expiresAt());
    }

    /** Polls a session; the encrypted ProvisionMessage appears once an existing device approved. */
    @GetMapping("/v1/provisioning/sessions/{provisioningId}")
    ResponseEntity<ProvisioningStatusResponse> status(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID provisioningId) {
        Account account = accounts.resolveOrProvision(identities.resolve(jwt));
        ProvisioningSession s = provisioning.get(account.accountId(), provisioningId);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new ProvisioningStatusResponse(s.status(),
                s.messagePublic() == null ? null : encode(s.messagePublic()),
                s.message() == null ? null : encode(s.message())));
    }

    /** New device gives up. */
    @DeleteMapping("/v1/provisioning/sessions/{provisioningId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void cancel(@AuthenticationPrincipal Jwt jwt, @PathVariable UUID provisioningId) {
        Account account = accounts.resolveOrProvision(identities.resolve(jwt));
        provisioning.cancel(account.accountId(), provisioningId);
    }

    /** Registers the new device with keys and the decrypted provisioning code. */
    @PostMapping("/v1/devices/link")
    @ResponseStatus(HttpStatus.CREATED)
    RegistrationResponse link(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody LinkRegistrationRequest body) {
        var result = enrollment.registerLinked(identities.resolve(jwt), new LinkRegistration(
                body.provisioningId(),
                body.provisioningCode(),
                decode(body.identityKey(), "identityKey"),
                body.registrationId(),
                body.signedPreKey().toDomain(),
                body.preKeys().stream().map(PreKeyDto::toDomain).toList(),
                decode(body.signingKey(), "signingKey"),
                body.signingKeyProfile(),
                decode(body.registrationProof(), "registrationProof"),
                body.platform(),
                body.nameEnc() == null ? null : decode(body.nameEnc(), "nameEnc")));
        return new RegistrationResponse(result.address().accountId(), result.address().deviceId(), result.deviceListVersion());
    }

    // --- existing device (device signature) --------------------------------------------------

    /** Lists open link requests of the caller's account. */
    @GetMapping("/v1/provisioning/sessions")
    @Transactional(readOnly = true)
    List<PendingProvisioningDto> pending(@AuthenticationPrincipal AuthenticatedDevice me) {
        return provisioning.openSessions(me.accountId()).stream().map(s -> {
            Reservation r = enrollment.reservation(me.accountId(), s.reservationId());
            return new PendingProvisioningDto(s.provisioningId(), r.deviceId(), encode(s.ephemeralPublic()), s.clientLabel(),
                    encode(r.challenge()), deployment.id(), s.createdAt(), s.expiresAt());
        }).toList();
    }

    /** Issues the single-use code that proves this device approved the session. */
    @PostMapping("/v1/devices/provisioning-code")
    ProvisioningCodeResponse code(@AuthenticationPrincipal AuthenticatedDevice me, @Valid @RequestBody ProvisioningCodeRequest body) {
        return new ProvisioningCodeResponse(provisioning.issueCode(me.address(), body.provisioningId()));
    }

    /** Delivers the end-to-end encrypted ProvisionMessage. */
    @PostMapping("/v1/provisioning/sessions/{provisioningId}/message")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void deliver(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID provisioningId,
            @Valid @RequestBody ProvisioningMessageRequest body) {
        provisioning.deliver(me.address(), provisioningId, decode(body.ephemeralPublicKey(), "ephemeralPublicKey"),
                decode(body.message(), "message"));
    }

    /** Existing device declines a link request. */
    @DeleteMapping("/v1/provisioning/sessions/{provisioningId}/approval")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void decline(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID provisioningId) {
        provisioning.cancel(me.accountId(), provisioningId);
    }
}
