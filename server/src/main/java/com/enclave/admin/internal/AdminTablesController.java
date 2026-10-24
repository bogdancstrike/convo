package com.enclave.admin.internal;

import com.enclave.identity.IdentityAdminApi;
import com.enclave.identity.IdentityAdminApi.AccountSummary;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/v1/admin/tables")
class AdminTablesController {
    record Person(String key, String username, String name, AccountSummary account, AdminConsoleController.SignInAccount identity) {}
    private final AdminGuard guard;
    private final IdentityAdminApi identity;
    private final KeycloakUsers idp;
    private final AuditLog audit;
    private final AuditNames names;
    private final AdminPermissions permissions;
    private final com.enclave.push.PushApi push;
    private final ActivityStore activity;
    AdminTablesController(AdminGuard guard, IdentityAdminApi identity, KeycloakUsers idp, AuditLog audit, AuditNames names, AdminPermissions permissions, com.enclave.push.PushApi push, ActivityStore activity) { this.guard = guard; this.identity = identity; this.idp = idp; this.audit = audit; this.names = names; this.permissions = permissions; this.push = push; this.activity = activity; }
    @GetMapping("/people") ResponseEntity<AdminTableQuery.Page<Person>> people(@AuthenticationPrincipal Jwt admin, @RequestParam Map<String, String> params) {
        guard.require(admin, AdminPermissions.Permission.ACCOUNTS_READ);
        var accounts = new ArrayList<AccountSummary>();
        for (int offset = 0; ; offset += 1000) { var page = identity.accountDirectory(offset, 1000); accounts.addAll(page); if (page.size() < 1000) break; }
        Map<UUID, AccountSummary> byId = accounts.stream().collect(Collectors.toMap(AccountSummary::accountId, Function.identity()));
        List<Person> people = new ArrayList<>(); var matched = new HashSet<UUID>(); var warnings = new ArrayList<String>();
        try {
            var users = idp.directory();
            var subjects = identity.accountsBySubject(users.stream().map(KeycloakUsers.IdpUser::id).toList());
            for (var user : users) {
                UUID accountId = subjects.get(user.id()); AccountSummary account = byId.get(accountId); if (account != null) matched.add(accountId);
                String name = account != null && account.displayName() != null ? account.displayName() : ((user.firstName() == null ? "" : user.firstName()) + " " + (user.lastName() == null ? "" : user.lastName())).strip();
                people.add(new Person("idp:" + user.id(), user.username(), name.isBlank() ? user.username() : name, account, new AdminConsoleController.SignInAccount(user, accountId)));
            }
        } catch (com.enclave.contracts.EnclaveException error) { warnings.add("Sign-in accounts are unavailable. Showing the Convo directory only."); }
        for (var a : accounts) if (!matched.contains(a.accountId())) people.add(new Person(a.accountId().toString(), a.username(), a.displayName() == null ? a.username() : a.displayName(), a, null));
        String status = params.getOrDefault("status", "all");
        people.removeIf(p -> !(status.equals("all") || status.equals("joined") && p.account() != null || status.equals("pending") && p.account() == null || status.equals("blocked") && (p.account() != null && p.account().status().equals("disabled") || p.identity() != null && !p.identity().user().enabled())));
        var page = AdminTableQuery.from(params).apply(people, AdminTablesController::personFields);
        return noStore(new AdminTableQuery.Page<>(page.rows(), page.total(), page.page(), page.size(), warnings));
    }
    static Map<String, Object> personFields(Person p) {
        Map<String, Object> out = new HashMap<>();
        out.put("person", p.name() + " " + p.username()); out.put("name", p.name()); out.put("username", p.username());
        out.put("convo", p.account() == null ? "Not joined yet" : p.account().status()); out.put("signin", p.identity() == null ? "Unavailable" : p.identity().user().enabled() ? "Allowed" : "Blocked");
        out.put("email", p.identity() == null ? "" : p.identity().user().email());
        out.put("devices", p.account() == null ? 0 : p.account().activeDevices()); out.put("last", p.account() == null ? null : p.account().lastSeenDay()); out.put("created", p.identity() == null ? p.account().createdAt() : p.identity().user().createdAt());
        return out;
    }
    @GetMapping("/role-holders") ResponseEntity<AdminTableQuery.Page<KeycloakUsers.Holder>> holders(@AuthenticationPrincipal Jwt admin, @RequestParam Map<String, String> params) {
        guard.require(admin, AdminPermissions.Permission.ACCOUNTS_READ);
        var rows = idp.holders(params.getOrDefault("role", ""));
        String status = params.getOrDefault("status", "all");
        if (!status.equals("all")) rows = rows.stream().filter(h -> h.enabled() == status.equals("allowed")).toList();
        return noStore(AdminTableQuery.from(params).apply(rows, h -> Map.of("person", (h.firstName() == null ? "" : h.firstName()) + " " + (h.lastName() == null ? "" : h.lastName()) + " " + h.username(), "username", h.username(), "phone", h.phone() == null ? "" : h.phone(), "status", h.enabled() ? "Allowed" : "Blocked")));
    }
    @GetMapping("/audit") ResponseEntity<AdminTableQuery.Page<AuditNames.View>> audit(@AuthenticationPrincipal Jwt admin, @RequestParam Map<String, String> params) {
        guard.require(admin, AdminPermissions.Permission.AUDIT_READ);
        return noStore(audit.table(AdminTableQuery.from(params), params));
    }
    @GetMapping("/permissions") ResponseEntity<AdminTableQuery.Page<Map<String, Object>>> permissions(@AuthenticationPrincipal Jwt admin, @RequestParam Map<String, String> params) {
        guard.require(admin, AdminPermissions.Permission.ACCOUNTS_READ);
        List<Map<String, Object>> rows = new ArrayList<>();
        PermissionCatalogue.ALL.forEach((permission, info) -> {
            Map<String, Object> row = new HashMap<>(); row.put("key", permission.name()); row.put("label", info.label()); row.put("group", info.group());
            permissions.matrix().forEach((role, grants) -> row.put(role, grants.contains(permission))); rows.add(row);
        });
        return noStore(AdminTableQuery.from(params).apply(rows, row -> {
            Map<String, Object> fields = new HashMap<>(row); permissions.matrix().keySet().forEach(role -> fields.put(role, Boolean.TRUE.equals(row.get(role)) ? "Allowed" : "Not granted")); return fields;
        }));
    }
    record DeadLetter(String key, String reason, String kind, long n) {}
    @GetMapping("/health") ResponseEntity<AdminTableQuery.Page<DeadLetter>> health(@AuthenticationPrincipal Jwt admin, @RequestParam Map<String, String> params) {
        guard.require(admin, AdminPermissions.Permission.HEALTH_READ);
        var rows = push.health().deadLetters().entrySet().stream().map(e -> { String[] key = e.getKey().split("/"); return new DeadLetter(e.getKey(), key[0], key.length > 1 ? key[1] : "", e.getValue()); }).toList();
        return noStore(AdminTableQuery.from(params).apply(rows, r -> Map.of("reason", switch(r.reason()) { case "gave_up" -> "Gave up after retries"; case "expired" -> "Expired before delivery"; case "rejected" -> "Rejected by the push service"; default -> r.reason(); }, "kind", r.kind().equals("call") ? "Call rings" : "Messages", "n", r.n())));
    }
    @GetMapping("/activity") ResponseEntity<AdminTableQuery.Page<AdminConsoleController.UserActivity>> activity(@AuthenticationPrincipal Jwt admin, @RequestParam Map<String, String> params) {
        guard.require(admin, AdminPermissions.Permission.STATS_READ); guard.require(admin, AdminPermissions.Permission.ACCOUNTS_READ);
        int days; try { days = Math.max(7, Math.min(90, Integer.parseInt(params.getOrDefault("days", "30")))); } catch (NumberFormatException e) { days = 30; }
        var accounts = new ArrayList<AccountSummary>();
        for (int offset = 0; ; offset += 1000) { var page = identity.accountDirectory(offset, 1000); accounts.addAll(page); if (page.size() < 1000) break; }
        var totals = new HashMap<UUID, ActivityStore.AccountActivity>();
        for (int offset = 0; offset < accounts.size(); offset += 1000) for (var a : activity.of(accounts.subList(offset, Math.min(accounts.size(), offset + 1000)).stream().map(AccountSummary::accountId).toList(), activity.today().minusDays(days - 1L))) totals.put(a.accountId(), a);
        final int window = days;
        var rows = accounts.stream().filter(a -> a.status().equals("active")).map(a -> AdminConsoleController.level(a, totals.get(a.accountId()), window)).toList();
        return noStore(AdminTableQuery.from(params).apply(rows, r -> {
            Map<String, Object> fields = new HashMap<>(); fields.put("person", (r.account().displayName() == null ? "" : r.account().displayName()) + " " + r.account().username()); fields.put("level", switch(r.level()) { case "high" -> "Very active"; case "medium" -> "Active"; case "low" -> "Occasional"; default -> "Inactive"; }); fields.put("items", r.items()); fields.put("activeDays", r.activeDays()); fields.put("last", r.lastActiveDay()); return fields;
        }));
    }

    private static <T> ResponseEntity<T> noStore(T body) { return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body); }
}
