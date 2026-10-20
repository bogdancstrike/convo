package com.enclave.messaging.internal.web;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.messaging.internal.gateway.WebSocketTicketService;
import com.enclave.messaging.internal.gateway.WireFormat.EnvelopeDto;
import com.enclave.messaging.internal.gateway.WireFormat.SendRequestDto;
import com.enclave.messaging.internal.gateway.WireFormat.SendResultDto;
import com.enclave.messaging.internal.mailbox.MailboxService;
import com.enclave.messaging.internal.submission.SubmissionService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST fallback for messaging (specs §12.3) and browser socket tickets (§12.1). The WebSocket is
 * the primary path; these endpoints serve constrained networks and background work.
 */
@RestController
class MessageController {

    private final SubmissionService submissions;
    private final MailboxService mailbox;
    private final WebSocketTicketService tickets;

    MessageController(SubmissionService submissions, MailboxService mailbox, WebSocketTicketService tickets) {
        this.submissions = submissions;
        this.mailbox = mailbox;
        this.tickets = tickets;
    }

    /** Direct E2EE submission; {@code accountId} must match the body destination. */
    @PutMapping("/v1/messages/{accountId}")
    SendResultDto send(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID accountId,
            @RequestBody SendRequestDto body) {
        if (body.destination() != null && !accountId.equals(body.destination())) {
            throw new EnclaveException(ErrorCode.INVALID_REQUEST, "path and body destination differ");
        }
        SendRequestDto request = new SendRequestDto(accountId, body.submissionId(), body.messages(), body.urgent(),
                body.transientTtlSeconds());
        return SendResultDto.accepted(submissions.submitDirect(me.address(), request.toCommand()).duplicate());
    }

    /** Bounded mailbox drain. Envelopes stay queued until acknowledged. */
    @GetMapping("/v1/messages")
    ResponseEntity<Drain> drain(@AuthenticationPrincipal AuthenticatedDevice me,
            @RequestParam(defaultValue = "100") int limit) {
        List<EnvelopeDto> page = mailbox.page(me.address(), limit).stream().map(EnvelopeDto::of).toList();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new Drain(page, page.size() >= Math.max(1, limit) && mailbox.hasPending(me.address())));
    }

    /** Acknowledges one envelope (idempotent). */
    @DeleteMapping("/v1/messages/{guid}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void ack(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID guid) {
        mailbox.ack(me.address(), List.of(guid));
    }

    /** Issues a one-use WebSocket ticket bound to this device and the caller's origin. */
    @PostMapping("/v1/ws/tickets")
    @ResponseStatus(HttpStatus.CREATED)
    Ticket ticket(@AuthenticationPrincipal AuthenticatedDevice me,
            @RequestHeader(value = "Origin", required = false) String origin) {
        var issued = tickets.issue(me.address(), origin);
        return new Ticket(issued.ticket(), issued.expiresAt());
    }

    /**
     * @param envelopes oldest-first page
     * @param more whether more envelopes may be pending
     */
    record Drain(List<EnvelopeDto> envelopes, boolean more) {}

    /**
     * @param ticket one-use ticket for {@code Sec-WebSocket-Protocol: ticket.<ticket>}
     * @param expiresAt expiry
     */
    record Ticket(String ticket, Instant expiresAt) {}
}
