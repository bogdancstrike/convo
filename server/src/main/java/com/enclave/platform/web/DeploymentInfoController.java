package com.enclave.platform.web;

import com.enclave.contracts.DeploymentProperties;
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
    static final List<String> API_VERSIONS = List.of("v1");

    private final DeploymentProperties deployment;
    private final SecurityProperties security;

    DeploymentInfoController(DeploymentProperties deployment, SecurityProperties security) {
        this.deployment = deployment;
        this.security = security;
    }

    @GetMapping("/v1/deployment-info")
    DeploymentInfo info() {
        return new DeploymentInfo(deployment.id(), deployment.displayName(), API_VERSIONS,
                new OidcInfo(security.oidc().issuer(), security.oidc().publicClientId()));
    }

    /**
     * @param deploymentId deployment ID bound into signed transcripts
     * @param displayName organization name
     * @param apiVersions supported API versions
     * @param oidc OIDC client settings for the web app
     */
    record DeploymentInfo(String deploymentId, String displayName, List<String> apiVersions, OidcInfo oidc) {}

    /**
     * @param issuer OIDC issuer URL
     * @param clientId public PKCE client ID
     */
    record OidcInfo(String issuer, String clientId) {}
}
