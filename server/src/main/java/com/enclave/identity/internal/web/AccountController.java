package com.enclave.identity.internal.web;

import static com.enclave.contracts.Base64Url.encode;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.IdentityApi;
import com.enclave.identity.internal.account.Account;
import com.enclave.identity.internal.account.AccountRepository;
import com.enclave.identity.internal.account.DirectoryService;
import com.enclave.identity.internal.web.IdentityDtos.AccountDto;
import com.enclave.identity.internal.web.IdentityDtos.RosterDto;
import com.enclave.identity.internal.web.IdentityDtos.RosterEntryDto;
import com.enclave.identity.internal.web.IdentityDtos.SelfDto;
import java.util.List;
import java.util.UUID;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Account, roster and directory lookups ({@code D}-authenticated, specs §12.1). */
@RestController
class AccountController {

    private final AccountRepository accounts;
    private final DirectoryService directory;
    private final IdentityApi identity;

    AccountController(AccountRepository accounts, DirectoryService directory, IdentityApi identity) {
        this.accounts = accounts;
        this.directory = directory;
        this.identity = identity;
    }

    /** The caller's own account and device. */
    @GetMapping("/v1/accounts/me")
    SelfDto me(@AuthenticationPrincipal AuthenticatedDevice me) {
        Account a = accounts.findById(me.accountId()).orElseThrow();
        return new SelfDto(a.accountId(), a.username(), a.displayName(), a.phone(), me.deviceId(),
                encodeNullable(a.identityKey()), a.deviceListVersion());
    }

    /** Public view of another account (handle and identity key). */
    @GetMapping("/v1/accounts/{accountId}")
    AccountDto account(@PathVariable UUID accountId) {
        return accounts.findById(accountId).filter(a -> !a.disabled())
                .map(AccountController::toDto)
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown account"));
    }

    /** Active device IDs + registration IDs of an account for fan-out. */
    @GetMapping("/v1/accounts/{accountId}/devices")
    RosterDto devices(@PathVariable UUID accountId) {
        var roster = identity.activeRoster(accountId)
                .orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown account"));
        return new RosterDto(accountId, roster.deviceListVersion(), roster.devices().stream()
                .map(e -> new RosterEntryDto(e.deviceId(), e.registrationId())).toList());
    }

    /** Organization directory search by handle, display name or phone number (ADR-0002). */
    @GetMapping("/v1/directory/search")
    List<AccountDto> search(@RequestParam("q") String query) {
        return directory.search(query).stream().map(AccountController::toDto).toList();
    }

    private static AccountDto toDto(Account a) {
        return new AccountDto(a.accountId(), a.username(), a.displayName(), a.phone(), encodeNullable(a.identityKey()), a.guestUntil());
    }

    private static String encodeNullable(byte[] bytes) {
        return bytes == null ? null : encode(bytes);
    }
}
