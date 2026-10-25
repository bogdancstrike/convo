package com.enclave.admin.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.IdentityAdminApi;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Each administrative change and its audit entry commit together (or not at all). */
@Service
class AdminActions {
    private final IdentityAdminApi identity;
    private final AuditLog audit;

    AdminActions(IdentityAdminApi identity, AuditLog audit) {
        this.identity = identity;
        this.audit = audit;
    }

    @Transactional
    AuditLog.Entry setDisabled(String actor, UUID accountId, boolean disabled, String reason) {
        if (identity.account(accountId).isEmpty()) throw new EnclaveException(ErrorCode.NOT_FOUND, "unknown account");
        identity.setDisabled(accountId, disabled);
        return audit.append(actor, disabled ? "account.disable" : "account.enable", accountId.toString(), reason);
    }

    /** Marks or clears a visible integration account; the audit entry records kind and retention. */
    @Transactional
    AuditLog.Entry setIntegration(String actor, UUID accountId, String kind, String retention, String reason) {
        identity.setIntegration(accountId, kind, retention, actor);
        String detail = kind == null ? reason : reason + " [" + kind + "; " + retention.strip() + "]";
        return audit.append(actor, kind == null ? "integration.clear" : "integration.set", accountId.toString(), detail);
    }

    @Transactional
    AuditLog.Entry revokeDevice(String actor, UUID accountId, int deviceId, String reason) {
        identity.revokeDevice(accountId, deviceId, "admin");
        return audit.append(actor, "device.revoke", accountId + "." + deviceId, reason);
    }
}
