package com.enclave.identity.internal.account;

import com.enclave.identity.internal.IdentityProperties;
import java.util.List;
import java.util.Locale;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Organization directory search (specs §12.1 as amended by ADR-0002): handle prefix, IdP display
 * name (word prefix, diacritic-insensitive) or phone number digits. E2EE profile data is never
 * searchable; only IdP-managed directory attributes are.
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
        if (query == null || query.isBlank() || query.length() > 64) {
            return List.of();
        }
        if (DirectoryText.looksLikePhone(query)) {
            String digits = DirectoryText.phoneDigits(query);
            return digits == null || digits.length() < properties.minPhoneDigits()
                    ? List.of() : accounts.searchByPhone(digits, properties.directoryPageSize());
        }
        String q = DirectoryText.fold(query.startsWith("@") ? query.substring(1) : query);
        return q == null ? List.of() : accounts.searchByName(q.toLowerCase(Locale.ROOT), properties.directoryPageSize());
    }
}
