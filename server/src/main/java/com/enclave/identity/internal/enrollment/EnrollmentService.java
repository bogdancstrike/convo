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
import com.enclave.identity.internal.provisioning.ProvisioningService;
import com.enclave.identity.internal.provisioning.ProvisioningSession;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Device enrollment use cases: address reservation, first-device registration and linked-device
 * registration (specs §4.3–4.4, §27.1; tasks ID-01/02).
 *
 * <p>Both registration paths end in {@link #complete}, which verifies key formats and the
 * transcript proof, then atomically inserts the device and prekeys, consumes the reservation,
 * bumps the device-list version and publishes {@link DeviceRegistered}.
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
    private final ProvisioningService provisioning;
    private final IdentityProperties properties;
    private final DeploymentProperties deployment;
    private final ApplicationEventPublisher events;
    private final Clock clock;
    private final com.enclave.identity.internal.recovery.RecoveryService recovery;
    private final com.enclave.identity.internal.device.DeviceService deviceService;
    private final SecureRandom random = new SecureRandom();

    EnrollmentService(AccountService accountService, AccountRepository accounts, DeviceRepository devices,
            ReservationRepository reservations, PrekeyService prekeys, ProvisioningService provisioning,
            IdentityProperties properties, DeploymentProperties deployment, ApplicationEventPublisher events, Clock clock,
            com.enclave.identity.internal.recovery.RecoveryService recovery, com.enclave.identity.internal.device.DeviceService deviceService) {
        this.accountService = accountService;
        this.accounts = accounts;
        this.devices = devices;
        this.reservations = reservations;
        this.prekeys = prekeys;
        this.provisioning = provisioning;
        this.properties = properties;
        this.deployment = deployment;
        this.events = events;
        this.clock = clock;
        this.recovery = recovery;
        this.deviceService = deviceService;
    }

    /**
     * Reserves a device address for a signed-in user.
     *
     * @param identity verified OIDC identity
     * @param purpose {@code primary} (first device) or {@code link}
     * @return the reservation
     * @throws EnclaveException {@code ACCOUNT_HAS_DEVICES} for a primary reservation on an account
     *     with devices, {@code ENROLLMENT_INVALID} for a link reservation on an account without
     *     devices, {@code DEVICE_LIMIT} when the account is full
     */
    @Transactional
    public Reservation reserve(OidcIdentity identity, String purpose) {
        if (!"primary".equals(purpose) && !"link".equals(purpose) && !"recovery".equals(purpose)) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "purpose must be primary or link");
        }
        Account account = accountService.resolveOrProvision(identity);
        accounts.lock(account.accountId());
        int active = devices.countActive(account.accountId());
        if ("primary".equals(purpose) && (active > 0 || account.identityKey() != null)) {
            throw new EnclaveException(ErrorCode.ACCOUNT_HAS_DEVICES, "account already has devices; link instead");
        }
        if ("link".equals(purpose) && active == 0) {
            throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "no trusted device to link from; register instead");
        }
        if (!"recovery".equals(purpose) && active >= properties.maxDevicesPerAccount()) {
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

    /** Returns a reservation of the account (used to build the provisioning transcript). */
    @Transactional(readOnly = true)
    public Reservation reservation(UUID accountId, UUID reservationId) {
        return reservations.find(reservationId).filter(r -> r.accountId().equals(accountId))
                .orElseThrow(() -> new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "unknown reservation"));
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
        Reservation reservation = lockReservation(account, cmd.reservationId(), "primary");
        return complete(account, reservation, cmd, true);
    }

    /**
     * Registers an additional device approved through a provisioning session (specs §4.4). The
     * caller must hold a Keycloak token of the account <em>and</em> the code an existing device
     * obtained for exactly this session.
     */
    @Transactional
    public Registered registerLinked(OidcIdentity identity, LinkRegistration cmd) {
        Account account = accountService.resolveOrProvision(identity);
        accounts.lock(account.accountId());
        ProvisioningSession session = provisioning.authorizeLink(account.accountId(), cmd.provisioningId(),
                cmd.provisioningCode());
        Reservation reservation = lockReservation(account, session.reservationId(), "link");
        Registered registered = complete(account, reservation, cmd, false);
        provisioning.complete(session.provisioningId());
        return registered;
    }

    /** Recovery authenticates with SSO and an independent code before revoking lost devices. */
    @Transactional
    public Registered registerRecovered(OidcIdentity identity, PrimaryRegistration cmd, byte[] authorizationKey) {
        Account account = accountService.resolveOrProvision(identity);
        accounts.lock(account.accountId());
        recovery.authorize(account.accountId(), authorizationKey);
        Reservation reservation = lockReservation(account, cmd.reservationId(), "recovery");
        if (reservation.consumedAt() == null) {
            // Validate the recovered identity and proof before changing existing device access.
            if (account.identityKey() == null || !MessageDigest.isEqual(account.identityKey(), cmd.identityKey())) {
                throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "recovered identity does not match account");
            }
            for (Device device : devices.findActive(account.accountId())) {
                deviceService.revoke(account.accountId(), device.deviceId(), "account-recovery");
            }
        }
        return complete(account, reservation, cmd, false);
    }

    /** Explicit maintenance helper for abandoned reservations; never scheduled. */
    @Transactional
    void purgeAbandonedReservations() {
        reservations.purgeExpired();
    }

    private Reservation lockReservation(Account account, UUID reservationId, String purpose) {
        return reservations.lock(reservationId)
                .filter(r -> r.accountId().equals(account.accountId()) && purpose.equals(r.purpose()))
                .orElseThrow(() -> new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "unknown reservation"));
    }

    /**
     * Shared enrollment completion. Caller holds the account row lock and the reservation row lock.
     *
     * @param primary {@code true} for first-device registration (sets the account identity key),
     *     {@code false} for linking (identity key must match the account's)
     */
    private Registered complete(Account account, Reservation reservation, EnrollmentKeys keys, boolean primary) {
        DeviceAddress address = new DeviceAddress(account.accountId(), reservation.deviceId());
        byte[] keyDigest = EnrollmentTranscript.sha256(keys.signingKey());

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
        int active = devices.countActive(account.accountId());
        if (primary && (active > 0 || account.identityKey() != null)) {
            throw new EnclaveException(ErrorCode.ACCOUNT_HAS_DEVICES, "account already has devices; link instead");
        }
        if (active >= properties.maxDevicesPerAccount()) {
            throw new EnclaveException(ErrorCode.DEVICE_LIMIT, "maximum number of devices reached");
        }
        validate(keys);
        if (!primary && (account.identityKey() == null || !MessageDigest.isEqual(account.identityKey(), keys.identityKey()))) {
            throw new EnclaveException(ErrorCode.ENROLLMENT_INVALID, "identity key does not match the account");
        }
        DeviceKeyProfile profile = DeviceKeyProfile.fromId(keys.signingKeyProfile());
        profile.parsePublicKey(keys.signingKey());
        byte[] transcript = EnrollmentTranscript.build(deployment.id(), account.accountId(), reservation.deviceId(),
                reservation.reservationId(), reservation.challenge(), keys.identityKey(), keys.registrationId(),
                keys.signingKey());
        if (!profile.verify(keys.signingKey(), transcript, keys.registrationProof())) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "registration proof does not verify");
        }

        devices.insert(new Device(account.accountId(), reservation.deviceId(), keys.registrationId(), keys.signingKey(),
                profile.id(), keys.nameEnc(), keys.platform(), now, null, null));
        if (primary) {
            accounts.setIdentityKey(account.accountId(), keys.identityKey());
        }
        prekeys.upload(address, keys.signedPreKey(), keys.oneTimePreKeys());
        reservations.markConsumed(reservation.reservationId(), keyDigest, now);
        long version = accounts.bumpDeviceListVersion(account.accountId());
        events.publishEvent(new DeviceRegistered(address, version));
        log.info("Registered {} device {}", primary ? "primary" : "linked", address);
        return new Registered(address, version);
    }

    private static void validate(EnrollmentKeys keys) {
        if (keys.identityKey() == null || keys.identityKey().length != IDENTITY_KEY_LENGTH
                || keys.identityKey()[0] != DJB_KEY_TYPE) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "identityKey must be a serialized Curve25519 key");
        }
        if (keys.registrationId() < 1 || keys.registrationId() > 16383) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "registrationId out of range");
        }
        if (keys.signedPreKey() == null) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "signedPreKey is required");
        }
        if (!PLATFORMS.contains(keys.platform())) {
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
