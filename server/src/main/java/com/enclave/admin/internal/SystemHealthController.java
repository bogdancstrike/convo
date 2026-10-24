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
    SystemHealthController(AdminGuard guard, SystemHealth health) { this.guard = guard; this.health = health; }
    @GetMapping("/system") ResponseEntity<SystemHealth.Snapshot> system(@AuthenticationPrincipal Jwt admin) {
        guard.require(admin, AdminPermissions.Permission.HEALTH_READ);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(health.snapshot());
    }
}
