package com.enclave.admin.internal;

import com.enclave.identity.AuthenticatedDevice;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.HandlerMapping;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Metadata-only user mutations. No payloads, keys, tokens, recipients or chat identifiers. */
@Configuration
class UserRequestAudit implements WebMvcConfigurer, HandlerInterceptor {
    private final AuditLog audit;
    private final UserActionAudit actors;
    UserRequestAudit(AuditLog audit, UserActionAudit actors) { this.audit = audit; this.actors = actors; }
    @Override public void addInterceptors(InterceptorRegistry registry) { registry.addInterceptor(this).addPathPatterns("/v1/**").excludePathPatterns("/v1/admin/**"); }
    static String action(String method, String route) {
        if (method.equals("GET") || method.equals("HEAD") || method.equals("OPTIONS")) return null;
        return switch (method + " " + route) {
            case "PUT /v1/recovery" -> "recovery.save";
            case "POST /v1/recovery/reservations" -> "recovery.authorize";
            case "POST /v1/devices/recover" -> "recovery.use";
            case "PUT /v1/privacy/last-seen" -> "privacy.last-seen-update";
            case "POST /v1/provisioning/sessions" -> "device.link-request";
            case "POST /v1/devices/provisioning-code" -> "device.link-approve";
            case "DELETE /v1/provisioning/sessions/{provisioningId}" -> "device.link-cancel";
            case "DELETE /v1/provisioning/sessions/{provisioningId}/approval" -> "device.link-decline";
            default -> {
                // Registration/revocation are domain-audited. Transport/heartbeat traffic is aggregate-only.
                if (route.startsWith("/v1/groups/") && route.endsWith("/messages")) yield null;
                String group = route.startsWith("/v1/groups") || route.startsWith("/v1/invites") ? "group"
                        : route.startsWith("/v1/communities") ? "community" : route.startsWith("/v1/calls") ? "call" : null;
                yield group == null ? null : group + "." + method.toLowerCase(java.util.Locale.ROOT);
            }
        };
    }
    @Override public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception failure) {
        Object pattern = request.getAttribute(HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE);
        if (pattern == null) return;
        String route = pattern.toString(), action = action(request.getMethod(), route);
        if (action == null) return;
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) return;
        Object principal = authentication.getPrincipal();
        String target = principal instanceof AuthenticatedDevice device ? device.accountId().toString()
                : principal instanceof Jwt jwt ? "idp:" + jwt.getSubject() : null;
        if (target == null) return;
        boolean ok = failure == null && response.getStatus() >= 200 && response.getStatus() < 400;
        audit.append(actors.actor(target), ok ? action : action + ".failed", target, request.getMethod() + " " + route + " · HTTP " + response.getStatus());
    }
}
