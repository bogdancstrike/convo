package com.enclave.platform.security;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.platform.web.ProblemWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.util.AntPathMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Per-device rate limits (specs §20), applied after device authentication: the first matching rule
 * takes a token from the device's bucket; an empty bucket answers 429 RATE_LIMITED with Retry-After.
 * Valkey errors fail open (logged) so an outage of the limiter never blocks messaging.
 */
class RateLimitFilter extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(RateLimitFilter.class);
    private final RateLimitProperties properties;
    private final TokenBuckets buckets;
    private final ProblemWriter problems;
    private final AntPathMatcher paths = new AntPathMatcher();

    RateLimitFilter(RateLimitProperties properties, TokenBuckets buckets, ProblemWriter problems) {
        this.properties = properties; this.buckets = buckets; this.problems = problems;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        var authentication = SecurityContextHolder.getContext().getAuthentication();
        if (properties.enabled() && authentication != null && authentication.getPrincipal() instanceof AuthenticatedDevice device) {
            String path = request.getRequestURI().substring(request.getContextPath().length());
            for (RateLimitProperties.Rule rule : properties.rules()) {
                if (!rule.method().equalsIgnoreCase(request.getMethod()) || !paths.match(rule.pattern(), path)) continue;
                long retryAfter;
                try {
                    retryAfter = buckets.take(rule.name() + ":" + device.address(), rule);
                } catch (RuntimeException e) {
                    log.warn("rate limiter unavailable ({}); allowing the request", e.getClass().getSimpleName());
                    retryAfter = 0;
                }
                if (retryAfter > 0) {
                    response.setHeader("Retry-After", String.valueOf(Math.max(1, (retryAfter + 999) / 1000)));
                    problems.write(response, new EnclaveException(ErrorCode.RATE_LIMITED, "too many requests (" + rule.name() + ")",
                            Map.of("retryAfterMs", retryAfter)));
                    return;
                }
                break;
            }
        }
        chain.doFilter(request, response);
    }
}
