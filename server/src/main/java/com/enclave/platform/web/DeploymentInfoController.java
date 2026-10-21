package com.enclave.platform.web;

import com.enclave.contracts.DeploymentProperties;
import com.enclave.contracts.AttachmentPolicy;
import com.enclave.contracts.MessagePolicy;
import com.enclave.platform.security.SecurityProperties;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Public, non-user deployment metadata (specs §12.1). The web client reads it at start-up to
 * configure its OIDC client, so one web build works for any deployment.
 */
@RestController
class DeploymentInfoController {

    /** API protocol versions this server supports (N and N-1 policy, OPS-03). */

    private final DeploymentProperties deployment;
    private final SecurityProperties security;
    private final AttachmentPolicy attachments;
    private final MessagePolicy messages;

    /**
     * {@code v1.2} = v1 REST paths with device proof profile V2 (server nonces, PRIV-02). While
     * nonces are required, plain {@code v1} clients are told to update instead of failing silently.
     */
    private final List<String> apiVersions;
    private final PushInfo push;

    DeploymentInfoController(DeploymentProperties deployment, SecurityProperties security, AttachmentPolicy attachments,
            MessagePolicy messages, @org.springframework.beans.factory.annotation.Value("${enclave.identity.device-auth.require-nonce:true}") boolean requireNonce,
            @org.springframework.beans.factory.annotation.Value("${enclave.push.enabled:false}") boolean pushEnabled,
            @org.springframework.beans.factory.annotation.Value("${enclave.push.allowed-origins:}") List<String> pushOrigins) {
        this.push = new PushInfo(pushEnabled ? pushOrigins.stream().filter(o -> !o.isBlank()).toList() : List.of());
        this.apiVersions = requireNonce ? List.of("v1.2") : List.of("v1", "v1.2");
        this.deployment = deployment;
        this.security = security;
        this.attachments = attachments;
        this.messages = messages;
    }

    @GetMapping("/v1/deployment-info")
    DeploymentInfo info() {
        String origin = org.springframework.web.servlet.support.ServletUriComponentsBuilder.fromCurrentContextPath().build().toUriString();
        return new DeploymentInfo(deployment.id(), deployment.displayName(), apiVersions,
                new OidcInfo(deployment.endpointFor(security.oidc().issuer(), origin), security.oidc().publicClientId()), new Limits(attachments.maxFileBytes(),
                        messages.editWindow().toMillis(), messages.channelEditWindow().toMillis(), messages.editDeliveryGrace().toMillis()), push);
    }

    /**
     * @param deploymentId deployment ID bound into signed transcripts
     * @param displayName organization name
     * @param apiVersions supported API versions
     * @param oidc OIDC client settings for the web app
     * @param push which push servers phones may use for background wake-ups
     */
    record DeploymentInfo(String deploymentId, String displayName, List<String> apiVersions, OidcInfo oidc, Limits limits, PushInfo push) {}

    /**
     * @param servers UnifiedPush distributor servers (ntfy) this organization accepts; a phone's push
     *     app must use one of them. Empty when push wake-ups are disabled.
     */
    record PushInfo(List<String> servers) {}
    /**
     * @param attachmentMaxBytes plaintext attachment limit
     * @param editWindowMs edit window for chats, groups and Note to self
     * @param channelEditWindowMs edit window for channel posts
     * @param editGraceMs tolerance for edits accepted shortly after the window closed
     */
    record Limits(long attachmentMaxBytes, long editWindowMs, long channelEditWindowMs, long editGraceMs) {}

    /**
     * @param issuer OIDC issuer URL
     * @param clientId public PKCE client ID
     */
    record OidcInfo(String issuer, String clientId) {}
}
