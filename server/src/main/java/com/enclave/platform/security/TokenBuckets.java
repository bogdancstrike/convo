package com.enclave.platform.security;

import java.time.Clock;
import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

/**
 * Token buckets in Valkey: one hash per (rule, device) with the remaining tokens and the last refill
 * time, updated atomically by a Lua script, so limits hold across server replicas.
 */
@Component
class TokenBuckets {
    // KEYS[1] bucket; ARGV: capacity, refill per period, period ms, now ms. Returns {allowed, retry-after ms}.
    private static final String SCRIPT = """
            local capacity, refill, period, now = tonumber(ARGV[1]), tonumber(ARGV[2]), tonumber(ARGV[3]), tonumber(ARGV[4])
            local state = redis.call('HMGET', KEYS[1], 'tokens', 'at')
            local tokens, at = tonumber(state[1]), tonumber(state[2])
            if tokens == nil then tokens, at = capacity, now end
            tokens = math.min(capacity, tokens + (now - at) * refill / period)
            local allowed, retry = 0, 0
            if tokens >= 1 then tokens, allowed = tokens - 1, 1 else retry = math.ceil((1 - tokens) * period / refill) end
            redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'at', tostring(now))
            redis.call('PEXPIRE', KEYS[1], math.ceil(capacity * period / refill) + 1000)
            return {allowed, retry}
            """;
    @SuppressWarnings("rawtypes")
    private static final DefaultRedisScript<List> LUA = new DefaultRedisScript<>(SCRIPT, List.class);

    private final StringRedisTemplate redis;
    private final Clock clock;

    TokenBuckets(StringRedisTemplate redis, Clock clock) { this.redis = redis; this.clock = clock; }

    /** @return 0 when allowed, otherwise milliseconds until a token is available */
    long take(String bucket, RateLimitProperties.Rule rule) {
        List<?> result = redis.execute(LUA, List.of("ratelimit:" + bucket), String.valueOf(rule.capacity()), String.valueOf(rule.refill()),
                String.valueOf(rule.period().toMillis()), String.valueOf(clock.millis()));
        if (result == null || result.size() < 2) return 0; // fail open: availability over strictness if Valkey misbehaves
        return ((Number) result.get(0)).longValue() == 1 ? 0 : Math.max(1, ((Number) result.get(1)).longValue());
    }
}
