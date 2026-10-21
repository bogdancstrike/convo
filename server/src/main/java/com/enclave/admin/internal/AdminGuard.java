package com.enclave.admin.internal;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import java.time.Clock;
import java.time.Instant;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

/**
 * Permission checks shared by the admin controllers: scoped permissions per role, audited denials
 * for sensitive actions, and step-up (a recent IdP sign-in) for destructive ones.
 */
@Component
class AdminGuard {
    private final AdminPermissions permissions;
    private final AuditLog audit;
    private final AdminProperties properties;
    private final Clock clock;

    AdminGuard(AdminPermissions permissions, AuditLog audit, AdminProperties properties, Clock clock) {
        this.permissions = permissions;
        this.audit = audit;
        this.properties = properties;
        this.clock = clock;
    }

    void require(Jwt admin, AdminPermissions.Permission permission) {
        if (!permissions.of(admin).contains(permission)) throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "your admin role does not allow this");
    }

    /** Sensitive actions: a denial is itself recorded in the audit chain. */
    void requireAudited(Jwt admin, AdminPermissions.Permission permission, String action, String target) {
        if (permissions.of(admin).contains(permission)) return;
        audit.append(actor(admin), "denied:" + action, target, "role lacks " + permission.name());
        throw new EnclaveException(ErrorCode.FORBIDDEN_ROLE, "your admin role does not allow this");
    }

    /** Step-up: the IdP sign-in behind this token ({@code auth_time}) must be recent. */
    void requireRecentSignIn(Jwt admin) {
        Object claim = admin.getClaim("auth_time");
        long authTime = claim instanceof Number n ? n.longValue() : claim instanceof Instant i ? i.getEpochSecond() : 0;
        if (authTime == 0 || Instant.ofEpochSecond(authTime).plus(properties.stepUpMaxAge()).isBefore(clock.instant())) {
            throw new EnclaveException(ErrorCode.STEP_UP_REQUIRED, "sign in again to confirm this action");
        }
    }

    java.util.Map<String, java.util.Set<AdminPermissions.Permission>> matrix() { return permissions.matrix(); }

    /** Stable admin identity for the audit: IdP subject plus readable handle. */
    String actor(Jwt admin) {
        String name = admin.getClaimAsString("preferred_username");
        return admin.getSubject() + (name == null ? "" : " (" + name + ")");
    }
}
