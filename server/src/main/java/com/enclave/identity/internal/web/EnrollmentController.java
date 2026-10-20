package com.enclave.identity.internal.web;

import static com.enclave.contracts.Base64Url.decode;
import static com.enclave.contracts.Base64Url.encode;

import com.enclave.contracts.DeploymentProperties;
import com.enclave.identity.internal.enrollment.EnrollmentService;
import com.enclave.identity.internal.enrollment.PrimaryRegistration;
import com.enclave.identity.internal.enrollment.Reservation;
import com.enclave.identity.internal.web.IdentityDtos.PreKeyDto;
import com.enclave.identity.internal.web.IdentityDtos.PrimaryRegistrationRequest;
import com.enclave.identity.internal.web.IdentityDtos.RegistrationResponse;
import com.enclave.identity.internal.web.IdentityDtos.ReservationRequest;
import com.enclave.identity.internal.web.IdentityDtos.ReservationResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Enrollment endpoints authenticated with a Keycloak bearer token ({@code K} in specs §12.1).
 */
@RestController
@RequestMapping("/v1/devices")
class EnrollmentController {

    private final EnrollmentService enrollment;
    private final OidcIdentityResolver identities;
    private final DeploymentProperties deployment;

    EnrollmentController(EnrollmentService enrollment, OidcIdentityResolver identities, DeploymentProperties deployment) {
        this.enrollment = enrollment;
        this.identities = identities;
        this.deployment = deployment;
    }

    /** Reserves a device address and enrollment challenge. */
    @PostMapping("/reservations")
    @ResponseStatus(HttpStatus.CREATED)
    ReservationResponse reserve(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody ReservationRequest body) {
        if ("recovery".equals(body.purpose())) throw new com.enclave.contracts.EnclaveException(
                com.enclave.contracts.ErrorCode.INVALID_REQUEST, "use the authorized recovery endpoint");
        Reservation r = enrollment.reserve(identities.resolve(jwt), body.purpose());
        return new ReservationResponse(r.reservationId(), r.accountId(), r.deviceId(), encode(r.challenge()),
                deployment.id(), r.expiresAt());
    }

    /** Registers the account's first device. */
    @PostMapping("/primary")
    @ResponseStatus(HttpStatus.CREATED)
    RegistrationResponse registerPrimary(@AuthenticationPrincipal Jwt jwt, @Valid @RequestBody PrimaryRegistrationRequest body) {
        var result = enrollment.registerPrimary(identities.resolve(jwt), new PrimaryRegistration(
                body.reservationId(),
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
}
