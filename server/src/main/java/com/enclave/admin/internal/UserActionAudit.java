package com.enclave.admin.internal;

import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.DeviceRegistered;
import com.enclave.identity.DeviceRevoked;
import com.enclave.identity.IdentityAdminApi;
import org.springframework.context.event.EventListener;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

/** Device changes and audit entries share the identity transaction. */
@Component
class UserActionAudit {
    private final AuditLog audit;
    private final IdentityAdminApi identity;
    UserActionAudit(AuditLog audit, IdentityAdminApi identity) { this.audit = audit; this.identity = identity; }
    @EventListener void registered(DeviceRegistered event) {
        String account = event.address().accountId().toString();
        audit.append(actor(account), "device.add", account + "." + event.address().deviceId(), "device enrollment completed");
    }
    @EventListener void revoked(DeviceRevoked event) {
        String account = event.address().accountId().toString();
        audit.append(actor(account), "self".equals(event.reason()) ? "device.sign-out" : "device.remove", account + "." + event.address().deviceId(), event.reason());
    }
    String actor(String account) {
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof Jwt jwt) {
            return "idp:" + jwt.getSubject() + (jwt.getClaimAsString("preferred_username") == null ? "" : " (" + jwt.getClaimAsString("preferred_username") + ")");
        }
        if (auth != null && auth.getPrincipal() instanceof AuthenticatedDevice device) {
            String name = identity.account(device.accountId()).map(IdentityAdminApi.AccountSummary::username).orElse("");
            return device.accountId() + " (" + name + ") device:" + device.deviceId();
        }
        return "system:" + account;
    }
}
