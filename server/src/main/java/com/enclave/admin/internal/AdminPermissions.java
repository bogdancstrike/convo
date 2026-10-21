package com.enclave.admin.internal;

import java.util.Collection;
import java.util.EnumSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.stereotype.Component;

/**
 * Least-privilege admin scopes (specs §19, AC-ADM-01) from Keycloak realm roles. The superuser
 * role keeps every permission for small deployments; separated duties use the scoped roles.
 */
@Component
class AdminPermissions {
    /** What an admin role allows. No permission reads chat content: none exists in this API. */
    enum Permission { ACCOUNTS_READ, DEVICES_READ, DEVICE_REVOKE, ACCOUNT_STATUS, AUDIT_READ, AUDIT_EXPORT, AUDIT_CHECKPOINT }

    private final Map<String, Set<Permission>> byRole;

    AdminPermissions(AdminProperties properties) {
        var r = properties.roles();
        this.byRole = Map.of(
                properties.role(), EnumSet.allOf(Permission.class),
                r.helpdesk(), EnumSet.of(Permission.ACCOUNTS_READ, Permission.DEVICES_READ, Permission.DEVICE_REVOKE),
                r.orgAdmin(), EnumSet.of(Permission.ACCOUNTS_READ, Permission.ACCOUNT_STATUS),
                r.security(), EnumSet.of(Permission.ACCOUNTS_READ, Permission.DEVICES_READ, Permission.DEVICE_REVOKE, Permission.ACCOUNT_STATUS, Permission.AUDIT_READ),
                r.auditor(), EnumSet.of(Permission.AUDIT_READ, Permission.AUDIT_EXPORT, Permission.AUDIT_CHECKPOINT));
    }

    /** Admin roles held by this token (realm roles that are known admin roles). */
    List<String> roles(Jwt jwt) {
        Object access = jwt.getClaim("realm_access");
        Object roles = access instanceof Map<?, ?> map ? map.get("roles") : null;
        return roles instanceof Collection<?> list ? list.stream().map(String::valueOf).filter(byRole::containsKey).sorted().toList() : List.of();
    }

    Set<Permission> of(Jwt jwt) {
        Set<Permission> out = EnumSet.noneOf(Permission.class);
        roles(jwt).forEach(role -> out.addAll(byRole.get(role)));
        return out;
    }

    /** All role names that may use the admin API at all (for the security chain). */
    List<String> allRoles() { return List.copyOf(byRole.keySet()); }
}
