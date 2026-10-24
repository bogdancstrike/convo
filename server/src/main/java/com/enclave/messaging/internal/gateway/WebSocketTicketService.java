package com.enclave.messaging.internal.gateway;

import com.enclave.contracts.Base64Url;
import com.enclave.contracts.DeviceAddress;
import com.enclave.identity.IdentityApi;
import com.enclave.messaging.internal.MessagingProperties;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * One-use, short-lived, origin-bound browser WebSocket tickets (specs §9.1). Browsers cannot set
 * an {@code Authorization} header on the upgrade, so a device-signed REST call obtains a ticket
 * that is presented once in {@code Sec-WebSocket-Protocol}.
 */
@Service
public class WebSocketTicketService {

    private final TicketRepository tickets;
    private final IdentityApi identity;
    private final MessagingProperties properties;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    WebSocketTicketService(TicketRepository tickets, IdentityApi identity, MessagingProperties properties, Clock clock) {
        this.tickets = tickets;
        this.identity = identity;
        this.properties = properties;
        this.clock = clock;
    }

    /**
     * @param device authenticated device
     * @param origin request {@code Origin} the ticket is bound to (may be {@code null} for native)
     * @return the ticket (only returned once, never stored in clear)
     */
    @Transactional
    public Issued issue(DeviceAddress device, String origin) {
        byte[] raw = new byte[32];
        random.nextBytes(raw);
        Instant expiresAt = clock.instant().plus(properties.websocket().ticketTtl());
        tickets.insert(hash(raw), device, origin, expiresAt);
        return new Issued(Base64Url.encode(raw), expiresAt);
    }

    /**
     * Consumes a ticket at upgrade time.
     *
     * @param ticket presented ticket
     * @param origin upgrade request origin
     * @return the bound device if the ticket is valid, unused, origin-matching and the device is active
     */
    @Transactional
    public Optional<DeviceAddress> redeem(String ticket, String origin) {
        byte[] raw;
        try {
            raw = Base64Url.decode(ticket, "ticket");
        } catch (RuntimeException e) {
            return Optional.empty();
        }
        return tickets.consume(hash(raw))
                .filter(c -> c.origin() == null || Objects.equals(c.origin(), origin))
                .map(TicketRepository.Consumed::device)
                .filter(identity::isActive);
    }

    @Transactional
    void purgeExpired() {
        tickets.purgeExpired();
    }

    private static byte[] hash(byte[] raw) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(raw);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * @param ticket opaque ticket value
     * @param expiresAt expiry
     */
    public record Issued(String ticket, Instant expiresAt) {}
}
