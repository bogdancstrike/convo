package com.enclave.admin.internal;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/admin/health")
class SystemHealthController {
    private final AdminGuard guard;
    private final SystemHealth health;
    private final com.enclave.messaging.MessagingHealthApi messaging;
    private final com.enclave.push.PushApi push;
    private final com.enclave.groups.GroupsApi groups;
    private final com.enclave.identity.IdentityAdminApi identity;
    private final java.time.Clock clock;

    SystemHealthController(AdminGuard guard, SystemHealth health, com.enclave.messaging.MessagingHealthApi messaging, com.enclave.push.PushApi push,
            com.enclave.groups.GroupsApi groups, com.enclave.identity.IdentityAdminApi identity, java.time.Clock clock) {
        this.guard = guard; this.health = health; this.messaging = messaging; this.push = push; this.groups = groups; this.identity = identity; this.clock = clock;
    }

    /**
     * Aggregate service health (ADM-01): mailbox backlog, push wake-ups, groups blocked by pending
     * device removal and device churn. Counts and ages only: no accounts, devices or relationships.
     */
    record ServiceMetrics(com.enclave.messaging.MessagingHealthApi.Health messaging, com.enclave.push.PushApi.Health push,
            com.enclave.groups.GroupsApi.Health groups, com.enclave.identity.IdentityAdminApi.DeviceChanges devices24h, java.time.Instant measuredAt) {}

    @GetMapping("/service") ResponseEntity<ServiceMetrics> service(@AuthenticationPrincipal Jwt admin) {
        guard.require(admin, AdminPermissions.Permission.HEALTH_READ);
        var now = clock.instant();
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new ServiceMetrics(messaging.health(), push.health(), groups.health(),
                identity.deviceChanges(now.minus(java.time.Duration.ofHours(24))), now));
    }
    @GetMapping("/system") ResponseEntity<SystemHealth.Snapshot> system(@AuthenticationPrincipal Jwt admin) {
        guard.require(admin, AdminPermissions.Permission.HEALTH_READ);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(health.snapshot());
    }
}
