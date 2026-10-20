package com.enclave.identity.internal.account;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Maps a verified OIDC identity {@code (issuer, sub)} to an application account, provisioning it
 * just-in-time on first sign-in (specs §2, ID-01).
 */
@Service
public class AccountService {

    private static final Logger log = LoggerFactory.getLogger(AccountService.class);
    private static final int MAX_HANDLE_ATTEMPTS = 50;

    private final AccountRepository accounts;

    AccountService(AccountRepository accounts) {
        this.accounts = accounts;
    }

    /**
     * Returns the account for an OIDC identity, creating it if necessary. Concurrent first
     * sign-ins converge on one account thanks to the {@code (issuer, subject)} unique key.
     *
     * @param identity verified token identity
     * @return the active account
     * @throws EnclaveException {@code ACCOUNT_DISABLED} if the organization disabled the account
     */
    @Transactional
    public Account resolveOrProvision(OidcIdentity identity) {
        Account account = accounts.findByOidc(identity.issuer(), identity.subject())
                .orElseGet(() -> provision(identity));
        if (account.disabled()) {
            throw new EnclaveException(ErrorCode.ACCOUNT_DISABLED, "account is disabled");
        }
        return account;
    }

    private Account provision(OidcIdentity identity) {
        UUID id = UUID.randomUUID();
        String base = UsernamePolicy.normalize(identity.preferredUsername(), "user-" + id.toString().substring(0, 8));
        String candidate = base;
        for (int attempt = 2; accounts.usernameExists(candidate); attempt++) {
            if (attempt > MAX_HANDLE_ATTEMPTS) {
                candidate = "user-" + id.toString().substring(0, 8);
                break;
            }
            candidate = UsernamePolicy.withSuffix(base, attempt);
        }
        if (accounts.insert(id, identity.issuer(), identity.subject(), candidate)) {
            log.info("Provisioned account {}", id);
        }
        return accounts.findByOidc(identity.issuer(), identity.subject()).orElseThrow();
    }
}
