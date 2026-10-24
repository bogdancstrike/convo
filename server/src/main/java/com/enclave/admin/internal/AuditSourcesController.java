package com.enclave.admin.internal;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
class AuditSourcesController {
    private final AdminGuard guard;
    private final IdentityAuditImporter importer;
    AuditSourcesController(AdminGuard guard, IdentityAuditImporter importer) { this.guard = guard; this.importer = importer; }
    @GetMapping("/v1/admin/audit/sources") ResponseEntity<IdentityAuditImporter.Status> sources(@AuthenticationPrincipal Jwt admin) {
        guard.require(admin, AdminPermissions.Permission.AUDIT_READ);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(importer.status());
    }
}
