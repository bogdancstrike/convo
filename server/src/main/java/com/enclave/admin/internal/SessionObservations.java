package com.enclave.admin.internal;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.servlet.HandlerInterceptor;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Optional, coarse user-agent metadata. A user agent is self-reported, never a device identity. */
@Configuration
class SessionObservations implements HandlerInterceptor, WebMvcConfigurer {
    record Observation(String sessionId, String subjectId, String browser, String operatingSystem, Instant observedAt) {}
    private final JdbcClient jdbc;
    private final Clock clock;
    SessionObservations(JdbcClient jdbc, Clock clock) { this.jdbc = jdbc; this.clock = clock; }
    @Override public void addInterceptors(InterceptorRegistry registry) { registry.addInterceptor(this).addPathPatterns("/v1/**"); }
    @Override public void afterCompletion(HttpServletRequest request, HttpServletResponse response, Object handler, Exception failure) {
        if (failure != null || response.getStatus() >= 400) return;
        var auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth == null || !(auth.getPrincipal() instanceof Jwt jwt)) return;
        String sid = jwt.getClaimAsString("sid");
        if (sid == null || sid.isBlank() || sid.length() > 200) return;
        String[] family = family(request.getHeader("User-Agent"));
        try {
            jdbc.sql("""
                INSERT INTO admin_session_observation(session_id, subject_id, browser, operating_system, observed_at)
                VALUES (:sid, :subject, :browser, :os, :at)
                ON CONFLICT (session_id) DO UPDATE SET browser = excluded.browser, operating_system = excluded.operating_system, observed_at = excluded.observed_at
                WHERE admin_session_observation.subject_id = excluded.subject_id AND admin_session_observation.observed_at < excluded.observed_at - interval '1 minute'
                """).param("sid", sid).param("subject", jwt.getSubject()).param("browser", family[0]).param("os", family[1]).param("at", OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC)).update();
        } catch (RuntimeException error) {
            org.slf4j.LoggerFactory.getLogger(getClass()).warn("Session browser observation unavailable ({})", error.getClass().getSimpleName());
        }
    }
    List<Observation> of(String subject) {
        return jdbc.sql("SELECT * FROM admin_session_observation WHERE subject_id = :subject").param("subject", subject)
                .query((rs, n) -> new Observation(rs.getString("session_id"), rs.getString("subject_id"), rs.getString("browser"), rs.getString("operating_system"), rs.getObject("observed_at", OffsetDateTime.class).toInstant())).list();
    }
    static String[] family(String value) {
        String ua = value == null ? "" : value.substring(0, Math.min(value.length(), 1000)).toLowerCase(Locale.ROOT);
        String browser = ua.contains("edg/") ? "Edge" : ua.contains("firefox/") || ua.contains("fxios/") ? "Firefox" : ua.contains("chrome/") || ua.contains("crios/") ? "Chrome" : ua.contains("safari/") ? "Safari" : "Not observed";
        String os = ua.contains("android") ? "Android" : ua.contains("iphone") || ua.contains("ipad") ? "iOS / iPadOS" : ua.contains("windows") ? "Windows" : ua.contains("macintosh") ? "macOS" : ua.contains("linux") ? "Linux" : "Not observed";
        return new String[]{browser, os};
    }
}
