package com.enclave.admin.internal;

import java.util.Map;

/** Labels shared by server-side permission comparison, filtering and sorting. */
final class PermissionCatalogue {
    record Info(String label, String group) {}
    static final Map<AdminPermissions.Permission, Info> ALL = Map.ofEntries(
        entry("ACCOUNTS_READ", "See people and accounts", "People"), entry("DEVICES_READ", "See linked devices", "People"),
        entry("DEVICE_REVOKE", "Unlink a device", "People"), entry("ACCOUNT_STATUS", "Disable / enable accounts", "People"), entry("RECOVERY_RESET", "Revoke a recovery kit", "People"),
        entry("USERS_CREATE", "Create sign-in accounts", "Sign-in"), entry("USERS_CREDENTIALS", "Reset passwords, require passkey/2FA, block sign-in", "Sign-in"), entry("ROLES_MANAGE", "Grant and remove admin roles", "Sign-in"),
        entry("AUDIT_READ", "Read and verify the audit log", "Audit"), entry("AUDIT_EXPORT", "Export the audit log", "Audit"), entry("AUDIT_CHECKPOINT", "Write audit checkpoints", "Audit"),
        entry("SESSIONS_READ", "See live sign-in sessions", "Sign-in"), entry("SESSIONS_REVOKE", "End sign-in sessions", "Sign-in"),
        entry("ALERTS_READ", "Read security alerts", "Audit"), entry("ALERTS_MANAGE", "Acknowledge and resolve alerts", "Audit"), entry("ALERT_RULES_MANAGE", "Configure security alert rules", "Audit"),
        entry("STATS_READ", "Statistics and activity", "Operations"), entry("HEALTH_READ", "Delivery health", "Operations"), entry("PUSH_REDRIVE", "Retry failed wake-ups", "Operations"));
    private static Map.Entry<AdminPermissions.Permission, Info> entry(String key, String label, String group) { return Map.entry(AdminPermissions.Permission.valueOf(key), new Info(label, group)); }
    private PermissionCatalogue() {}
}
