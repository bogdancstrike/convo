import { configureAttachmentLimit } from '../core/attachments';
import { configureEditPolicy } from '../core/editPolicy';
/**
 * Runtime deployment configuration. The web build is deployment-independent: everything specific
 * to an installation is read from the public `GET /v1/deployment-info` endpoint at start-up.
 */
export interface DeploymentInfo {
  /** Deployment ID bound into signed enrollment transcripts. */
  deploymentId: string;
  /** Organization name shown on sign-in screens. */
  displayName: string;
  /** API versions supported by the server. */
  apiVersions: string[];
  /** OIDC settings for the public PKCE client. */
  oidc: { issuer: string; clientId: string };
  limits?: { attachmentMaxBytes: number; editWindowMs?: number; channelEditWindowMs?: number; editGraceMs?: number };
  /** Push (UnifiedPush) servers phones may use for background wake-ups; empty when disabled. */
  push?: { servers: string[] };
}

/** API version implemented by this client. */
/** v1 REST paths with device proof profile V2 (single-use server nonces, PRIV-02). */
export const CLIENT_API_VERSION = 'v1.2';

/**
 * Loads deployment metadata from the same origin.
 *
 * @throws Error when the server is unreachable or does not support {@link CLIENT_API_VERSION}
 */
export async function loadDeploymentInfo(signal?: AbortSignal): Promise<DeploymentInfo> {
  const response = await fetch('/v1/deployment-info', { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`deployment-info failed: ${response.status}`);
  const info = (await response.json()) as DeploymentInfo;
  if (!info.apiVersions.includes(CLIENT_API_VERSION)) {
    throw new UpdateRequiredError();
  }
  configureAttachmentLimit(info.limits?.attachmentMaxBytes ?? 100 * 1024 * 1024);
  configureEditPolicy(info.limits);
  current = info;
  return info;
}

let current: DeploymentInfo | null = null;

/** The deployment info loaded at start-up, if any. */
export function deploymentInfo(): DeploymentInfo | null { return current; }

/**
 * Keycloak application-initiated action that registers a passwordless passkey, then returns to a
 * static result page. A throwaway PKCE challenge satisfies the client policy; the returned code is
 * never exchanged.
 */
export function passkeySetupUrl(info: DeploymentInfo | null = current, origin = window.location.origin): Promise<string | null> {
  return keycloakActionUrl('webauthn-register-passwordless', 'add', info, origin);
}

/**
 * Keycloak's own confirmation for removing one passkey (`delete_credential:<id>`), so Convo never
 * needs credential-management rights and users never see the IdP's account console.
 */
export function passkeyRemoveUrl(credentialId: string, info: DeploymentInfo | null = current, origin = window.location.origin): Promise<string | null> {
  return keycloakActionUrl(`delete_credential:${credentialId}`, 'remove', info, origin);
}

/** The result page tells adding and removing apart by this `state` prefix. */
async function keycloakActionUrl(action: string, kind: 'add' | 'remove', info: DeploymentInfo | null, origin: string): Promise<string | null> {
  if (!info) return null;
  const verifier = crypto.getRandomValues(new Uint8Array(32));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', verifier));
  const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const params = new URLSearchParams({
    client_id: info.oidc.clientId, redirect_uri: `${origin}/auth/convo/passkey-done`, response_type: 'code', scope: 'openid',
    kc_action: action, state: `${kind}.${b64(crypto.getRandomValues(new Uint8Array(16)))}`,
    code_challenge: b64(digest), code_challenge_method: 'S256',
  });
  return `${info.oidc.issuer.replace(/\/$/, '')}/protocol/openid-connect/auth?${params}`;
}

/** Thrown when the server no longer supports this client version. */
export class UpdateRequiredError extends Error {
  constructor() {
    super('update required');
    this.name = 'UpdateRequiredError';
  }
}
