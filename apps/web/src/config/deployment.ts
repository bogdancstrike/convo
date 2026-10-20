import { configureAttachmentLimit } from '../core/attachments';
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
  limits?: { attachmentMaxBytes: number };
}

/** API version implemented by this client. */
export const CLIENT_API_VERSION = 'v1';

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
  return info;
}

/** Thrown when the server no longer supports this client version. */
export class UpdateRequiredError extends Error {
  constructor() {
    super('update required');
    this.name = 'UpdateRequiredError';
  }
}
