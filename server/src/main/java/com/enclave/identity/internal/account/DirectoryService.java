package com.enclave.identity.internal.account;

import com.enclave.identity.internal.IdentityProperties;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Organization directory search over handles (specs §12.1). Display names are end-to-end
 * encrypted profile data and therefore never server-searchable.
 */
@Service
public class DirectoryService {

    private final AccountRepository accounts;
    private final IdentityProperties properties;

    DirectoryService(AccountRepository accounts, IdentityProperties properties) {
        this.accounts = accounts;
        this.properties = properties;
    }

    /**
     * @param query user input; leading {@code @} is ignored
     * @return matching active accounts, empty for queries shorter than one handle character
     */
    @Transactional(readOnly = true)
    public List<Account> search(String query) {
        String q = query == null ? "" : query.strip().toLowerCase(Locale.ROOT);
        if (q.startsWith("@")) {
            q = q.substring(1);
        }
        if (q.isEmpty() || q.length() > 32 || !q.matches("[a-z0-9._-]+")) {
            return List.of();
        }
        return accounts.searchByUsernamePrefix(q, properties.directoryPageSize());
    }
}
