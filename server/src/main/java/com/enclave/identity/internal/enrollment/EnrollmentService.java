package com.enclave.identity.internal.enrollment;

import com.enclave.contracts.DeploymentProperties;
import com.enclave.contracts.DeviceAddress;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.DeviceRegistered;
import com.enclave.identity.internal.IdentityProperties;
import com.enclave.identity.internal.account.Account;
import com.enclave.identity.internal.account.AccountRepository;
import com.enclave.identity.internal.account.AccountService;
import com.enclave.identity.internal.account.OidcIdentity;
import com.enclave.identity.internal.auth.DeviceKeyProfile;
import com.enclave.identity.internal.device.Device;
import com.enclave.identity.internal.device.DeviceRepository;
import com.enclave.identity.internal.keys.PrekeyService;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Device enrollment use cases: address reservation and first-device registration
 * (specs §4.3, §27.1; task ID-01).
 *
 * <p>Idempotency: a retried registration with the same reservation and the same device signing
 * key returns the original result instead of creating a second device; any other reuse of a
 * consumed reservation fails with {@code ENROLLMENT_INVALID}.
 */
@Service
public class EnrollmentService {

    private static final Logger log = LoggerFactory.getLogger(EnrollmentService.class);
    private static final Set<String> PLATFORMS = Set.of("android", "web", "desktop", "ios");
    private static final int IDENTITY_KEY_LENGTH = 33;
    private static final byte DJB_KEY_TYPE = 0x05;

    private final AccountService accountService;
    private final AccountRepository accounts;
    private final DeviceRepository devices;
    private final ReservationRepository reservations;
    private final PrekeyService prekeys;
    private final IdentityProperties properties;
    private final DeploymentProperties deployment;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    EnrollmentService(AccountService accountService, AccountRepository accounts, DeviceRepository devices,
            ReservationRepository reservations, PrekeyService prekeys, IdentityProperties properties,
            DeploymentProperties deployment, ApplicationEventPublisher events, Clock clock) {
        this.accountService = accountService;
        this.accounts = accounts;
        this.devices = devices;
        this.reservations = reservations;
        this.prekeys = prekeys;
        this.properties = properties;
        this.deployment = deployment;
        this.events = events;
        this.clock = clock;
    }

    /**
     * Reserves a device address for a signed-in user.
     *
     * @param identity verified OIDC identity
     * @param purpose {@code primary} (first device) or {@code link}
     * @return the reservation
     * @throws EnclaveException {@code ACCOUNT_HAS_DEVICES} for a primary reservation on an account
     *     with devices, {@code DEVICE_LIMIT} when the account is full
     */
    @Transactional
    public Reservation reserve(OidcIdentity identity, String purpose) {
        if (!"primary".equals(purpose) && !"link".equals(purpose)) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "purpose must be primary or link");
        }
        Account account = accountService.resolveOrProvision(identity);
        accounts.lock(account.accountId());
        int active = devices.countActive(account.accountId());
        if ("primary".equals(purpose) && active > 0) {
            throw new EnclaveException(ErrorCode.ACCOUNT_HAS_DEVICES, "account already has devices; link instead");
        }
        if (active >= properties.maxDevicesPerAccount()) {
            throw new EnclaveException(ErrorCode.DEVICE_LIMIT, "maximum number of devices reached");
        }
        byte[] challenge = new byte[32];
        random.nextBytes(challenge);
        Reservation reservation = new Reservation(UUID.randomUUID(), account.accountId(),
                accounts.allocateDeviceId(account.accountId()), purpose, challenge,
                clock.instant().plus(properties.reservationTtl()), null, null);
        reservations.insert(reservation);
        return reservation;
    }

    /**
     * Registers the first device of an account.
     *
     * @param identity verified OIDC identity (must own the reservation)
     * @param cmd registration command
     * @return the registered address and device-list version
     */
    @Transactional
    public Registered registerPrimary(OidcIdentity identity, PrimaryRegistration cmd) {
        Account account = accountService.resolveOrProvision(identity);
        accounts.lock(account.accountId());
        Reservation reservation = reservations.lock(cmd.reservationId())
                .filter(r -> r.accountId().equals(account.accountId()) && "primary".equals(r.purpose()))
                .orElseThrow(() -> new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "unknown reservation"));
        DeviceAddress address = new DeviceAddress(account.accountId(), reservation.deviceId());
        byte[] keyDigest = EnrollmentTranscript.sha256(cmd.signingKey());

        if (reservation.consumedAt() != null) {
            if (reservation.acceptedKey() != null && MessageDigest.isEqual(reservation.acceptedKey(), keyDigest)) {
                Account current = accounts.findById(account.accountId()).orElseThrow();
                return new Registered(address, current.deviceListVersion());
            }
            throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "reservation already used");
        }
        Instant now = clock.instant();
        if (reservation.expiresAt().isBefore(now)) {
            throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "reservation expired");
        }
        if (devices.countActive(account.accountId()) > 0) {
            throw new EnclaveException(ErrorCode.ACCOUNT_HAS_DEVICES, "account already has devices; link instead");
        }
        validate(cmd);
        DeviceKeyProfile profile = DeviceKeyProfile.fromId(cmd.signingKeyProfile());
        profile.parsePublicKey(cmd.signingKey());
        byte[] transcript = EnrollmentTranscript.build(deployment.id(), account.accountId(), reservation.deviceId(),
                reservation.reservationId(), reservation.challenge(), cmd.identityKey(), cmd.registrationId(),
                cmd.signingKey());
        if (!profile.verify(cmd.signingKey(), transcript, cmd.registrationProof())) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "registration proof does not verify");
        }

        devices.insert(new Device(account.accountId(), reservation.deviceId(), cmd.registrationId(), cmd.signingKey(),
                profile.id(), cmd.nameEnc(), cmd.platform(), now, null, null));
        accounts.setIdentityKey(account.accountId(), cmd.identityKey());
        prekeys.upload(address, cmd.signedPreKey(), cmd.oneTimePreKeys());
        reservations.markConsumed(reservation.reservationId(), keyDigest, now);
        long version = accounts.bumpDeviceListVersion(account.accountId());
        events.publishEvent(new DeviceRegistered(address, version));
        log.info("Registered primary device {}", address);
        return new Registered(address, version);
    }

    /** Daily cleanup of abandoned reservations. */
    @Scheduled(fixedDelayString = "${enclave.identity.reservation-purge-interval:PT6H}")
    void purgeAbandonedReservations() {
        reservations.purgeExpired();
    }

    private static void validate(PrimaryRegistration cmd) {
        if (cmd.identityKey() == null || cmd.identityKey().length != IDENTITY_KEY_LENGTH
                || cmd.identityKey()[0] != DJB_KEY_TYPE) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "identityKey must be a serialized Curve25519 key");
        }
        if (cmd.registrationId() < 1 || cmd.registrationId() > 16383) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "registrationId out of range");
        }
        if (cmd.signedPreKey() == null) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "signedPreKey is required");
        }
        if (!PLATFORMS.contains(cmd.platform())) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "unsupported platform");
        }
    }

    /**
     * Registration result.
     *
     * @param address registered device address
     * @param deviceListVersion device-list version after registration
     */
    public record Registered(DeviceAddress address, long deviceListVersion) {}
}
