package com.enclave.platform.security;

import com.enclave.contracts.Base64Url;
import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.identity.DeviceRequestAuthenticator;
import com.enclave.identity.SignedDeviceRequest;
import com.enclave.platform.web.ProblemWriter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.List;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.preauth.PreAuthenticatedAuthenticationToken;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Authenticates device proof-of-possession requests (specs §4.2).
 *
 * <p>Headers:
 * <ul>
 *   <li>{@code Authorization: EnclaveDevice <account_id>.<device_id>}</li>
 *   <li>{@code X-Enclave-Request-Id}: single-use request ID</li>
 *   <li>{@code X-Enclave-Expires}: epoch milliseconds</li>
 *   <li>{@code X-Enclave-Signature}: base64url P1363 signature of the canonical string</li>
 * </ul>
 * Requests without the scheme pass through unauthenticated and are rejected by authorization rules.
 */
class DeviceSignatureFilter extends OncePerRequestFilter {

    /** Authorization scheme for device-signed requests. */
    static final String SCHEME = "EnclaveDevice ";
    /** Authority granted to authenticated devices. */
    static final String DEVICE_AUTHORITY = "ROLE_DEVICE";

    private final DeviceRequestAuthenticator authenticator;
    private final ProblemWriter problems;
    private final int maxBodyBytes;

    DeviceSignatureFilter(DeviceRequestAuthenticator authenticator, ProblemWriter problems, int maxBodyBytes) {
        this.authenticator = authenticator;
        this.problems = problems;
        this.maxBodyBytes = maxBodyBytes;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String authorization = request.getHeader("Authorization");
        if (authorization == null || !authorization.startsWith(SCHEME)) {
            chain.doFilter(request, response);
            return;
        }
        CachedBodyRequest cached = CachedBodyRequest.wrap(request, maxBodyBytes);
        if (cached == null) {
            problems.write(response, new EnclaveException(ErrorCode.PAYLOAD_TOO_LARGE, "request body too large"));
            return;
        }
        try {
            String query = request.getQueryString();
            AuthenticatedDevice device = authenticator.authenticate(new SignedDeviceRequest(
                    request.getMethod(),
                    request.getRequestURI() + (query == null ? "" : "?" + query),
                    cached.body(),
                    authorization.substring(SCHEME.length()).strip(),
                    request.getHeader("X-Enclave-Request-Id"),
                    parseLong(request.getHeader("X-Enclave-Expires")),
                    Base64Url.decode(request.getHeader("X-Enclave-Signature"), "signature")));
            var token = new PreAuthenticatedAuthenticationToken(device, null,
                    List.of(new SimpleGrantedAuthority(DEVICE_AUTHORITY)));
            SecurityContextHolder.getContext().setAuthentication(token);
        } catch (EnclaveException e) {
            SecurityContextHolder.clearContext();
            problems.write(response, e.code() == ErrorCode.INVALID_REQUEST
                    ? new EnclaveException(ErrorCode.UNAUTHENTICATED, "malformed device signature") : e);
            return;
        }
        chain.doFilter(cached, response);
    }

    private static long parseLong(String value) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException e) {
            throw new EnclaveException(ErrorCode.UNAUTHENTICATED, "missing or malformed X-Enclave-Expires");
        }
    }
}
