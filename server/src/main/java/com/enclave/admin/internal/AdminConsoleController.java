package com.enclave.admin.internal;

import com.enclave.admin.internal.AdminPermissions.Permission;
import com.enclave.calls.CallsApi;
import com.enclave.communities.CommunitiesApi;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.groups.GroupsApi;
import com.enclave.identity.IdentityAdminApi;
import com.enclave.identity.IdentityAdminApi.AccountSummary;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
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

/**
 * Admin console API beyond account support (ADM-01): aggregate statistics with per-account activity
 * levels (counts only, from day-granular metadata), sign-in account management at the identity
 * provider, and recovery-kit revocation. Every change needs a reason and is written to the audit
 * chain; credential, sign-in and role changes also need a recent sign-in (step-up).
 */
@RestController
@RequestMapping("/v1/admin")
class AdminConsoleController {
    private final AdminGuard guard;
    private final AuditLog audit;
    private final ActivityStore activity;
    private final IdentityAdminApi identity;
    private final GroupsApi groups;
    private final CommunitiesApi communities;
    private final CallsApi calls;
    private final KeycloakUsers idp;
    private final AdminProperties properties;

    AdminConsoleController(AdminGuard guard, AuditLog audit, ActivityStore activity, IdentityAdminApi identity, GroupsApi groups,
            CommunitiesApi communities, CallsApi calls, KeycloakUsers idp, AdminProperties properties) {
        this.guard = guard;
        this.audit = audit;
        this.activity = activity;
        this.identity = identity;
        this.groups = groups;
        this.communities = communities;
        this.calls = calls;
        this.idp = idp;
        this.properties = properties;
    }

    // --- statistics ------------------------------------------------------------------------

    /** One day of the dashboard series (every day of the window is present, zeros included). */
    record DayStats(LocalDate day, long items, long activeAccounts, long senders, long webUsers, long androidUsers, long newAccounts,
            long calls, long videoCalls, long groupCalls) {}

    /**
     * @param activityTracking whether per-day activity is recorded (false: items/active are zero)
     * @param retentionDays how far back activity exists
     */
    record Overview(IdentityAdminApi.DirectoryStats directory, GroupsApi.Counts groups, long communities, List<DayStats> days,
            boolean activityTracking, Long retentionDays, boolean accountManagement) {}

    @GetMapping("/stats/overview")
    ResponseEntity<Overview> overview(@AuthenticationPrincipal Jwt admin, @RequestParam(defaultValue = "30") int days, @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate from, @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate to) {
        guard.require(admin, Permission.STATS_READ);
        var range = StatsRange.of(days, from, to, activity.today());
        LocalDate today = activity.today();
        Map<LocalDate, ActivityStore.Day> items = byDay((from == null ? activity.daily(range.from()) : activity.daily(range.from(), range.to())), ActivityStore.Day::day);
        Map<LocalDate, IdentityAdminApi.DayCount> created = byDay(identity.newAccountsPerDay(range.from()), IdentityAdminApi.DayCount::day);
        Map<LocalDate, CallsApi.CallDay> callDays = byDay(calls.callsPerDay(range.from()), CallsApi.CallDay::day);
        List<DayStats> series = new ArrayList<>();
        for (LocalDate d = range.from(); !d.isAfter(range.to()); d = d.plusDays(1)) {
            var a = items.get(d); var n = created.get(d); var c = callDays.get(d);
            series.add(new DayStats(d, a == null ? 0 : a.items(), a == null ? 0 : a.activeAccounts(), a == null ? 0 : a.senders(),
                    a == null ? 0 : a.web(), a == null ? 0 : a.android(), n == null ? 0 : n.count(),
                    c == null ? 0 : c.calls(), c == null ? 0 : c.video(), c == null ? 0 : c.group()));
        }
        return noStore(new Overview(identity.directoryStats(today), groups.counts(), communities.count(), series,
                properties.activity().enabled(), null, idp.available()));
    }

    ResponseEntity<Overview> overview(Jwt admin, int days) { return overview(admin, days, null, null); }
    ResponseEntity<Levels> levels(Jwt admin, int days) { return levels(admin, days, null, null); }
    ResponseEntity<AccountActivityView> accountActivity(Jwt admin, UUID accountId, int days) { return accountActivity(admin, accountId, days, null, null); }

    /**
     * Activity level from the share of active days in the window: {@code high} (≥ 50 %),
     * {@code medium} (≥ 15 %), {@code low} (any activity), {@code none}.
     */
    record UserActivity(AccountSummary account, long items, int activeDays, LocalDate lastActiveDay, String level) {}

    @GetMapping("/stats/users")
    ResponseEntity<List<UserActivity>> users(@AuthenticationPrincipal Jwt admin, @RequestParam(defaultValue = "active") String order,
            @RequestParam(defaultValue = "30") int days, @RequestParam(defaultValue = "10") int limit) {
        guard.require(admin, Permission.STATS_READ);
        guard.require(admin, Permission.ACCOUNTS_READ);
        int window = Math.max(7, Math.min(days, 90));
        LocalDate from = activity.today().minusDays(window - 1L);
        List<UserActivity> out;
        if ("inactive".equals(order)) {
            List<AccountSummary> quiet = identity.leastRecentlySeen(Math.max(1, Math.min(limit, 100)) * 3);
            Map<UUID, ActivityStore.AccountActivity> act = activity.of(quiet.stream().map(AccountSummary::accountId).toList(), from).stream()
                    .collect(Collectors.toMap(ActivityStore.AccountActivity::accountId, a -> a));
            out = quiet.stream().map(a -> level(a, act.get(a.accountId()), window))
                    .sorted(Comparator.comparingLong(UserActivity::items).thenComparing(u -> u.account().lastSeenDay(), Comparator.nullsFirst(Comparator.naturalOrder())))
                    .limit(Math.max(1, Math.min(limit, 100))).toList();
        } else {
            List<ActivityStore.AccountActivity> top = activity.top(from, limit);
            Map<UUID, AccountSummary> accounts = identity.accounts(top.stream().map(ActivityStore.AccountActivity::accountId).toList()).stream()
                    .collect(Collectors.toMap(AccountSummary::accountId, a -> a));
            out = top.stream().filter(t -> accounts.containsKey(t.accountId())).map(t -> level(accounts.get(t.accountId()), t, window)).toList();
        }
        return noStore(out);
    }

    /** How many active (not disabled) people fall into each level over the window. */
    record Levels(long high, long medium, long low, long none, int window) {}

    @GetMapping("/stats/levels")
    ResponseEntity<Levels> levels(@AuthenticationPrincipal Jwt admin, @RequestParam(defaultValue = "30") int days, @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate from, @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate to) {
        guard.require(admin, Permission.STATS_READ);
        var range = StatsRange.of(days, from, to, activity.today());
        int window = range.days();
        LocalDate today = activity.today();
        var counts = from == null ? activity.levels(range.from(), (int) Math.ceil(window * 0.5), (int) Math.ceil(window * 0.15)) : activity.levels(range.from(), range.to(), (int) Math.ceil(window * 0.5), (int) Math.ceil(window * 0.15));
        var directory = identity.directoryStats(today);
        long none = Math.max(0, directory.accounts() - directory.disabled() - counts.high() - counts.medium() - counts.low());
        return noStore(new Levels(counts.high(), counts.medium(), counts.low(), none, window));
    }

    record AccountActivityView(UserActivity summary, List<ActivityStore.AccountDay> days, int window, LocalDate from, LocalDate to) {}

    /** One account's activity: daily encrypted items sent over the window (counts only). */
    @GetMapping("/accounts/{accountId}/activity")
    ResponseEntity<AccountActivityView> accountActivity(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @RequestParam(defaultValue = "30") int days, @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate from, @RequestParam(required = false) @org.springframework.format.annotation.DateTimeFormat(iso = org.springframework.format.annotation.DateTimeFormat.ISO.DATE) LocalDate to) {
        guard.require(admin, Permission.STATS_READ);
        guard.require(admin, Permission.ACCOUNTS_READ);
        var range = StatsRange.of(days, from, to, activity.today());
        int window = range.days();
        AccountSummary account = identity.account(accountId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown account"));
        List<ActivityStore.AccountDay> series = from == null ? activity.account(accountId, range.from()) : activity.account(accountId, range.from(), range.to());
        long items = series.stream().mapToLong(ActivityStore.AccountDay::items).sum();
        var totals = series.isEmpty() ? null : new ActivityStore.AccountActivity(accountId, items, series.size(), series.getLast().day());
        return noStore(new AccountActivityView(level(account, totals, window), series, window, range.from(), range.to()));
    }

    static UserActivity level(AccountSummary account, ActivityStore.AccountActivity a, int window) {
        if (a == null) return new UserActivity(account, 0, 0, null, "none");
        double share = (double) a.activeDays() / window;
        String level = share >= 0.5 ? "high" : share >= 0.15 ? "medium" : "low";
        return new UserActivity(account, a.items(), a.activeDays(), a.lastActiveDay(), level);
    }

    // --- sign-in accounts (identity provider) ---------------------------------------------

    record Reason(@NotBlank @Size(max = 500) String reason) {}
    /** A sign-in account and the Convo account created at its first sign-in (if any). */
    record SignInAccount(KeycloakUsers.IdpUser user, UUID convoAccountId) {}

    @GetMapping("/idp/users")
    ResponseEntity<List<SignInAccount>> idpUsers(@AuthenticationPrincipal Jwt admin, @RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "50") int limit) {
        guard.require(admin, Permission.ACCOUNTS_READ);
        List<KeycloakUsers.IdpUser> users = idp.search(q, limit);
        Map<String, UUID> mapped = identity.accountsBySubject(users.stream().map(KeycloakUsers.IdpUser::id).toList());
        return noStore(users.stream().map(u -> new SignInAccount(u, mapped.get(u.id()))).toList());
    }

    @GetMapping("/idp/users/{id}")
    ResponseEntity<SignInAccount> idpUser(@AuthenticationPrincipal Jwt admin, @PathVariable @Pattern(regexp = "[0-9a-f-]{36}") String id) {
        guard.require(admin, Permission.ACCOUNTS_READ);
        return noStore(new SignInAccount(idp.user(id), identity.accountsBySubject(List.of(id)).get(id)));
    }

    /** The Convo account's sign-in account (for the account drawer). */
    @GetMapping("/accounts/{accountId}/sign-in")
    ResponseEntity<SignInAccount> signInOf(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId) {
        guard.require(admin, Permission.ACCOUNTS_READ);
        String subject = identity.subject(accountId).orElseThrow(() -> new EnclaveException(ErrorCode.NOT_FOUND, "unknown account"));
        return noStore(new SignInAccount(idp.user(subject), accountId));
    }

    record NewUser(@NotBlank @Size(max = 64) @Pattern(regexp = "[A-Za-z0-9._-]+") String username, @Size(max = 100) String firstName,
            @Size(max = 100) String lastName, @Size(max = 200) String email, @Size(max = 40) String phone, boolean requirePasskey,
            @NotBlank @Size(max = 500) String reason) {}
    record CreatedUser(SignInAccount account, String temporaryPassword, AuditLog.Entry audit) {}

    @PostMapping("/idp/users")
    CreatedUser createUser(@AuthenticationPrincipal Jwt admin, @Valid @RequestBody NewUser body) {
        guard.requireAudited(admin, Permission.USERS_CREATE, "user.create", body.username());
        var created = idp.create(new KeycloakUsers.Draft(body.username().strip(), body.firstName(), body.lastName(), body.email(), body.phone(), body.requirePasskey()));
        var entry = audit.append(guard.actor(admin), "user.create", "idp:" + created.user().id() + " (" + created.user().username() + ")",
                body.reason() + (body.requirePasskey() ? " [passkey required]" : ""));
        return new CreatedUser(new SignInAccount(created.user(), null), created.temporaryPassword(), entry);
    }

    record Secret(String temporaryPassword, AuditLog.Entry audit) {}

    @PostMapping("/idp/users/{id}/reset-password")
    Secret resetPassword(@AuthenticationPrincipal Jwt admin, @PathVariable String id, @Valid @RequestBody Reason body) {
        guard.requireAudited(admin, Permission.USERS_CREDENTIALS, "user.password-reset", "idp:" + id);
        guard.requireRecentSignIn(admin);
        selfGuard(admin, id);
        String password = idp.resetPassword(id);
        return new Secret(password, audit.append(guard.actor(admin), "user.password-reset", "idp:" + id, body.reason()));
    }

    record Actions(@jakarta.validation.constraints.NotEmpty List<@NotBlank String> actions, @NotBlank @Size(max = 500) String reason) {}

    @PostMapping("/idp/users/{id}/required-actions")
    AuditLog.Entry requireActions(@AuthenticationPrincipal Jwt admin, @PathVariable String id, @Valid @RequestBody Actions body) {
        guard.requireAudited(admin, Permission.USERS_CREDENTIALS, "user.require-actions", "idp:" + id);
        idp.requireActions(id, body.actions());
        return audit.append(guard.actor(admin), "user.require-actions", "idp:" + id, body.reason() + " " + body.actions());
    }

    @PostMapping("/idp/users/{id}/sign-out")
    AuditLog.Entry signOut(@AuthenticationPrincipal Jwt admin, @PathVariable String id, @Valid @RequestBody Reason body) {
        guard.requireAudited(admin, Permission.SESSIONS_REVOKE, "user.sign-out", "idp:" + id);
        guard.requireRecentSignIn(admin);
        idp.signOut(id);
        return audit.append(guard.actor(admin), "user.sign-out", "idp:" + id, body.reason());
    }

    record Enabled(boolean enabled, @NotBlank @Size(max = 500) String reason) {}

    @PostMapping("/idp/users/{id}/enabled")
    AuditLog.Entry setEnabled(@AuthenticationPrincipal Jwt admin, @PathVariable String id, @Valid @RequestBody Enabled body) {
        String action = body.enabled() ? "user.sign-in-allow" : "user.sign-in-block";
        guard.requireAudited(admin, Permission.USERS_CREDENTIALS, action, "idp:" + id);
        guard.requireRecentSignIn(admin);
        selfGuard(admin, id);
        idp.setEnabled(id, body.enabled());
        if (!body.enabled()) idp.signOut(id);
        return audit.append(guard.actor(admin), action, "idp:" + id, body.reason());
    }

    record RoleChange(@NotBlank String role, boolean granted, @NotBlank @Size(max = 500) String reason) {}

    @PostMapping("/idp/users/{id}/roles")
    AuditLog.Entry setRole(@AuthenticationPrincipal Jwt admin, @PathVariable String id, @Valid @RequestBody RoleChange body) {
        String action = body.granted() ? "role.grant" : "role.revoke";
        guard.requireAudited(admin, Permission.ROLES_MANAGE, action, "idp:" + id);
        guard.requireRecentSignIn(admin);
        selfGuard(admin, id);
        idp.setRole(id, body.role(), body.granted());
        return audit.append(guard.actor(admin), action, "idp:" + id + " " + body.role(), body.reason());
    }

    // --- roles -------------------------------------------------------------------------------

    /**
     * @param permissions what the role allows (enforced by the server on every call)
     * @param holders who has it at the identity provider; empty when account management is off
     */
    record RoleView(String role, List<Permission> permissions, List<KeycloakUsers.Holder> holders) {}

    /** Admin roles, their permissions and holders (the console's roles page and diagram). */
    @GetMapping("/roles")
    ResponseEntity<List<RoleView>> roles(@AuthenticationPrincipal Jwt admin) {
        guard.require(admin, Permission.ACCOUNTS_READ);
        List<RoleView> out = new ArrayList<>();
        for (var e : guard.matrix().entrySet()) {
            List<KeycloakUsers.Holder> holders = idp.available() ? idp.holders(e.getKey()) : List.of();
            out.add(new RoleView(e.getKey(), e.getValue().stream().sorted().toList(), holders));
        }
        out.sort(Comparator.comparingInt((RoleView r) -> -r.permissions().size()).thenComparing(RoleView::role));
        return noStore(out);
    }

    // --- recovery kit ----------------------------------------------------------------------

    record RecoveryRevoked(boolean revoked, AuditLog.Entry audit) {}

    /**
     * Revokes a lost or leaked recovery kit: the server forgets the wrapped history key, so the kit
     * stops working; the user's devices are unaffected and the app asks for a new kit.
     */
    @PostMapping("/accounts/{accountId}/recovery/revoke")
    RecoveryRevoked revokeRecovery(@AuthenticationPrincipal Jwt admin, @PathVariable UUID accountId, @Valid @RequestBody Reason body) {
        guard.requireAudited(admin, Permission.RECOVERY_RESET, "recovery.revoke", accountId.toString());
        guard.requireRecentSignIn(admin);
        if (identity.account(accountId).isEmpty()) throw new EnclaveException(ErrorCode.NOT_FOUND, "unknown account");
        boolean revoked = identity.revokeRecovery(accountId);
        return new RecoveryRevoked(revoked, audit.append(guard.actor(admin), "recovery.revoke", accountId.toString(),
                body.reason() + (revoked ? "" : " (no recovery kit was set up)")));
    }

    /** Administrators cannot weaken or strip their own sign-in account (another admin must). */
    private static void selfGuard(Jwt admin, String id) {
        if (id.equals(admin.getSubject())) throw new EnclaveException(ErrorCode.FORBIDDEN, "ask another administrator to change your own sign-in account");
    }

    private static <T> Map<LocalDate, T> byDay(List<T> rows, Function<T, LocalDate> day) {
        Map<LocalDate, T> out = new HashMap<>();
        rows.forEach(r -> out.put(day.apply(r), r));
        return out;
    }

    private static <T> ResponseEntity<T> noStore(T body) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(body);
    }
}
