package com.enclave.messaging.internal.gateway;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.listener.PatternTopic;
import org.springframework.data.redis.listener.RedisMessageListenerContainer;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/** Registers the device WebSocket endpoint and the Valkey hint subscriptions. */
@Configuration(proxyBeanMethods = false)
@EnableWebSocket
class GatewayConfig implements WebSocketConfigurer {

    /** Public WebSocket path. */
    static final String PATH = "/v1/ws";

    private final GatewayWebSocketHandler handler;
    private final TicketHandshakeInterceptor interceptor;

    GatewayConfig(GatewayWebSocketHandler handler, TicketHandshakeInterceptor interceptor) {
        this.handler = handler;
        this.interceptor = interceptor;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        // Origin checks are done by TicketHandshakeInterceptor (exact-origin or same-host).
        registry.addHandler(handler, PATH).addInterceptors(interceptor).setAllowedOriginPatterns("*");
    }

    @Bean
    RedisMessageListenerContainer hintListenerContainer(RedisConnectionFactory connections, HintBus hints) {
        RedisMessageListenerContainer container = new RedisMessageListenerContainer();
        container.setConnectionFactory(connections);
        container.addMessageListener(hints, new PatternTopic(HintBus.MAIL_PREFIX + "*"));
        container.addMessageListener(hints, new PatternTopic(HintBus.CONTROL_PREFIX + "*"));
        container.setRecoveryInterval(5_000L);
        return container;
    }
}
