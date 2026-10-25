import { ed25519 } from '@noble/curves/ed25519.js';

/**
 * Organization policy (specs §19.1, AC-ADM-02), published by administrators and signed by the
 * server's Ed25519 policy key over `CONVO-POLICY-V1\n<deploymentId>\n<document>`. Devices verify the
 * signature, pin the key on first use, refuse older versions (no rollback) and enforce the policy
 * locally. It is governance enforced by honest clients, not a cryptographic guarantee.
 */
export type PreviewLevel = 'generic' | 'sender' | 'full';
export interface OrgPolicy {
  notifications: { maxPreview: PreviewLevel };
  security: { screenshotBlock: boolean; appLockRequired: boolean; appLockMaxMinutes: number };
  privacy: { readReceiptsDefault: boolean; typingDefault: boolean };
  features: { chatExport: boolean; viewOnce: boolean; stickers: boolean; callLinks: boolean };
}
/** What `GET /v1/policy` returns. */
export interface SignedPolicy { version: number; document: string; signature: string; publicKey: string; keyId: string }
/** A verified policy as kept on the device. */
export interface VerifiedPolicy { version: number; keyId: string; publicKey: string; issuedAt: string; policy: OrgPolicy }

/** In force until a policy is published (matches the server's defaults). */
export const DEFAULT_POLICY: OrgPolicy = {
  notifications: { maxPreview: 'full' },
  security: { screenshotBlock: false, appLockRequired: false, appLockMaxMinutes: 15 },
  privacy: { readReceiptsDefault: false, typingDefault: false },
  features: { chatExport: true, viewOnce: true, stickers: true, callLinks: true },
};

export type PolicyRejection = 'bad-signature' | 'wrong-deployment' | 'key-changed' | 'rollback' | 'malformed';
export class PolicyRejectedError extends Error {
  constructor(readonly reason: PolicyRejection) { super(`policy rejected: ${reason}`); this.name = 'PolicyRejectedError'; }
}

const SPKI_ED25519_PREFIX = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Raw 32-byte key from the server's X.509 SubjectPublicKeyInfo encoding. */
function rawKey(spki: Uint8Array): Uint8Array {
  if (spki.length !== 44 || !SPKI_ED25519_PREFIX.every((b, i) => spki[i] === b)) throw new PolicyRejectedError('malformed');
  return spki.slice(12);
}

/**
 * Verifies a signed policy against this deployment, the pinned key (first use pins) and the last
 * accepted version. Throws {@link PolicyRejectedError}; the caller keeps enforcing what it had.
 */
export function verifyPolicy(signed: SignedPolicy, deploymentId: string, previous: VerifiedPolicy | undefined): VerifiedPolicy {
  let key: Uint8Array; let signature: Uint8Array;
  try { key = rawKey(fromBase64(signed.publicKey)); signature = fromBase64(signed.signature); } catch { throw new PolicyRejectedError('malformed'); }
  if (previous && previous.publicKey !== signed.publicKey) throw new PolicyRejectedError('key-changed');
  const message = new TextEncoder().encode(`CONVO-POLICY-V1\n${deploymentId}\n${signed.document}`);
  if (!ed25519.verify(signature, message, key)) throw new PolicyRejectedError('bad-signature');
  let envelope: { version: number; deploymentId: string; issuedAt: string; policy: OrgPolicy };
  try { envelope = JSON.parse(signed.document); } catch { throw new PolicyRejectedError('malformed'); }
  if (envelope.deploymentId !== deploymentId) throw new PolicyRejectedError('wrong-deployment');
  if (envelope.version !== signed.version || !isPolicy(envelope.policy)) throw new PolicyRejectedError('malformed');
  if (previous && envelope.version < previous.version) throw new PolicyRejectedError('rollback');
  return { version: envelope.version, keyId: signed.keyId, publicKey: signed.publicKey, issuedAt: envelope.issuedAt, policy: envelope.policy };
}

function isPolicy(p: unknown): p is OrgPolicy {
  const v = p as OrgPolicy;
  return !!v && ['generic', 'sender', 'full'].includes(v.notifications?.maxPreview)
    && typeof v.security?.screenshotBlock === 'boolean' && typeof v.security.appLockRequired === 'boolean'
    && Number.isInteger(v.security.appLockMaxMinutes) && v.security.appLockMaxMinutes >= 0 && v.security.appLockMaxMinutes <= 60
    && typeof v.privacy?.readReceiptsDefault === 'boolean' && typeof v.privacy.typingDefault === 'boolean'
    && ['chatExport', 'viewOnce', 'stickers', 'callLinks'].every((k) => typeof (v.features as Record<string, unknown> | undefined)?.[k] === 'boolean');
}

const PREVIEW_RANK: Record<PreviewLevel, number> = { generic: 0, sender: 1, full: 2 };

/** The preview a device actually uses: the person's choice, capped by policy. */
export function effectivePreview(chosen: PreviewLevel, policy: OrgPolicy): PreviewLevel {
  return PREVIEW_RANK[chosen] <= PREVIEW_RANK[policy.notifications.maxPreview] ? chosen : policy.notifications.maxPreview;
}

/** Whether a preview level is allowed by policy (for disabling settings choices). */
export function previewAllowed(level: PreviewLevel, policy: OrgPolicy): boolean {
  return PREVIEW_RANK[level] <= PREVIEW_RANK[policy.notifications.maxPreview];
}
