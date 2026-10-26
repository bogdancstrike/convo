package com.enclave.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import com.enclave.contracts.DeviceAddress;
import com.enclave.identity.AuthenticatedDevice;
import com.enclave.platform.web.ProblemWriter;
import jakarta.servlet.FilterChain;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import tools.jackson.databind.json.JsonMapper;

/** Per-device rate limits: rule matching, the 429 answer and failing open when Valkey is down. */
class RateLimitFilterTest {
    private final TokenBuckets buckets = mock(TokenBuckets.class);
    private final FilterChain chain = mock(FilterChain.class);
    private final DeviceAddress device = new DeviceAddress(UUID.randomUUID(), 2);

    @AfterEach void clear() { SecurityContextHolder.clearContext(); }

    private MockHttpServletResponse run(String method, String path, boolean enabled, boolean authenticated) throws Exception {
        if (authenticated) SecurityContextHolder.getContext().setAuthentication(new TestingAuthenticationToken(new AuthenticatedDevice(device, "web"), null));
        var filter = new RateLimitFilter(new RateLimitProperties(enabled, List.of()), buckets, new ProblemWriterAccess().writer());
        var response = new MockHttpServletResponse();
        filter.doFilter(new MockHttpServletRequest(method, path), response, chain);
        return response;
    }

    @ParameterizedTest(name = "{0} {1} -> bucket {2}")
    @CsvSource({
            "PUT, /v1/messages/abc, send", "PUT, /v1/groups/g1/messages, group-send", "POST, /v1/groups/g1/commits, group-commit",
            "POST, /v1/keys/acc/claim, prekey-claim", "POST, /v1/keypackages/claim, keypackage-claim", "POST, /v1/attachments/upload-form, upload",
            "POST, /v1/attachments/multipart, upload-multipart", "GET, /v1/directory/search, directory" })
    void matchingRulesUseOneBucketPerRuleAndDevice(String method, String path, String bucket) throws Exception {
        when(buckets.take(anyString(), any())).thenReturn(0L);
        assertThat(run(method, path, true, true).getStatus()).isEqualTo(200);
        verify(buckets).take(eq(bucket + ":" + device), any());
        verify(chain).doFilter(any(), any());
    }

    @ParameterizedTest(name = "{0} {1} is not limited")
    @CsvSource({ "GET, /v1/messages", "GET, /v1/accounts/me", "DELETE, /v1/messages/abc", "GET, /v1/groups/g1", "PUT, /v1/keys" })
    void otherRoutesAreNotLimited(String method, String path) throws Exception {
        assertThat(run(method, path, true, true).getStatus()).isEqualTo(200);
        verifyNoInteractions(buckets);
    }

    @Test void emptyBucketAnswers429WithRetryAfter() throws Exception {
        when(buckets.take(anyString(), any())).thenReturn(1500L);
        var response = run("PUT", "/v1/messages/x", true, true);
        assertThat(response.getStatus()).isEqualTo(429);
        assertThat(response.getHeader("Retry-After")).isEqualTo("2");
        assertThat(response.getContentAsString()).contains("RATE_LIMITED").contains("\"retryAfterMs\":1500");
        verifyNoInteractions(chain);
    }

    @Test void valkeyFailuresFailOpen() throws Exception {
        when(buckets.take(anyString(), any())).thenThrow(new IllegalStateException("down"));
        assertThat(run("PUT", "/v1/messages/x", true, true).getStatus()).isEqualTo(200);
        verify(chain).doFilter(any(), any());
    }

    @Test void disabledOrUnauthenticatedRequestsPassThrough() throws Exception {
        run("PUT", "/v1/messages/x", false, true);
        SecurityContextHolder.clearContext();
        run("PUT", "/v1/messages/x", true, false);
        verifyNoInteractions(buckets);
        verify(chain, times(2)).doFilter(any(), any());
    }

    @Test void defaultsFollowTheSpecification() {
        var rules = new RateLimitProperties(true, null).rules();
        assertThat(rules).extracting(RateLimitProperties.Rule::name).contains("send", "directory", "prekey-claim");
        var send = rules.getFirst();
        assertThat(send.capacity()).isEqualTo(120);
        assertThat(send.refill()).isEqualTo(60);
    }

    /** ProblemWriter has a package-private constructor; build one through reflection for the test. */
    static final class ProblemWriterAccess {
        ProblemWriter writer() throws Exception {
            var ctor = ProblemWriter.class.getDeclaredConstructor(tools.jackson.databind.ObjectMapper.class);
            ctor.setAccessible(true);
            return ctor.newInstance(JsonMapper.builder().build());
        }
    }
}
