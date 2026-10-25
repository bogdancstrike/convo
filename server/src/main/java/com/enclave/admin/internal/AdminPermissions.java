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
    enum Permission {
        ACCOUNTS_READ, DEVICES_READ, DEVICE_REVOKE, ACCOUNT_STATUS, AUDIT_READ, AUDIT_EXPORT, AUDIT_CHECKPOINT, HEALTH_READ, PUSH_REDRIVE,
        /** Aggregate statistics and per-account activity levels (counts only). */
        STATS_READ,
        /** Create sign-in accounts at the IdP. */
        USERS_CREATE,
        /** Reset passwords, require sign-in actions (passkey, password change, 2FA), end sessions, block/allow IdP sign-in. */
        USERS_CREDENTIALS,
        /** Revoke a user's recovery kit (lost or leaked); the app asks them for a new one. */
        RECOVERY_RESET,
        /** Grant or remove Convo admin roles (superuser only). */
        ROLES_MANAGE,
        /** See a person's live identity-provider sessions (browser family, source IP, times). */
        SESSIONS_READ,
        /** End one sign-in session or all of a person's sessions (reason and recent sign-in required). */
        SESSIONS_REVOKE,
        /** Read the security alerts inbox, alert history and detection rules. */
        ALERTS_READ,
        /** Acknowledge, resolve and reopen security alerts. */
        ALERTS_MANAGE,
        /** Change detection thresholds, severities and notification settings. */
        ALERT_RULES_MANAGE,
        /** Read the organization policy clients enforce. */
        POLICY_READ,
        /** Publish a new signed organization policy version (reason and recent sign-in required). */
        POLICY_MANAGE,
        /** Mark accounts as visible archive/bot integrations or clear the mark (reason and recent sign-in required). */
        INTEGRATIONS_MANAGE
    }

    private final Map<String, Set<Permission>> byRole;

    AdminPermissions(AdminProperties properties) {
        var r = properties.roles();
        this.byRole = Map.of(
                properties.role(), EnumSet.allOf(Permission.class),
                r.helpdesk(), EnumSet.of(Permission.ACCOUNTS_READ, Permission.DEVICES_READ, Permission.DEVICE_REVOKE, Permission.HEALTH_READ,
                        Permission.STATS_READ, Permission.USERS_CREDENTIALS, Permission.RECOVERY_RESET, Permission.SESSIONS_READ, Permission.SESSIONS_REVOKE),
                r.orgAdmin(), EnumSet.of(Permission.POLICY_READ, Permission.POLICY_MANAGE, Permission.INTEGRATIONS_MANAGE, Permission.ACCOUNTS_READ, Permission.ACCOUNT_STATUS, Permission.HEALTH_READ, Permission.STATS_READ,
                        Permission.USERS_CREATE, Permission.USERS_CREDENTIALS, Permission.SESSIONS_READ, Permission.SESSIONS_REVOKE),
                r.security(), EnumSet.of(Permission.POLICY_READ, Permission.POLICY_MANAGE, Permission.INTEGRATIONS_MANAGE, Permission.ACCOUNTS_READ, Permission.DEVICES_READ, Permission.DEVICE_REVOKE, Permission.ACCOUNT_STATUS, Permission.AUDIT_READ,
                        Permission.HEALTH_READ, Permission.PUSH_REDRIVE, Permission.STATS_READ, Permission.USERS_CREDENTIALS, Permission.RECOVERY_RESET, Permission.SESSIONS_READ, Permission.SESSIONS_REVOKE, Permission.ALERTS_READ, Permission.ALERTS_MANAGE, Permission.ALERT_RULES_MANAGE),
                r.auditor(), EnumSet.of(Permission.POLICY_READ, Permission.AUDIT_READ, Permission.AUDIT_EXPORT, Permission.AUDIT_CHECKPOINT, Permission.STATS_READ, Permission.ALERTS_READ),
                r.platform(), EnumSet.of(Permission.HEALTH_READ, Permission.PUSH_REDRIVE),
                r.compliance(), EnumSet.of(Permission.AUDIT_READ, Permission.AUDIT_EXPORT, Permission.POLICY_READ, Permission.STATS_READ));
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

    /** Every admin role and what it allows (the console draws this matrix). */
    Map<String, Set<Permission>> matrix() { return byRole; }
}
