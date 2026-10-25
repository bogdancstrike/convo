import { ed25519 } from '@noble/curves/ed25519.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, effectivePreview, PolicyRejectedError, verifyPolicy, type OrgPolicy, type SignedPolicy } from './policy';

const prefix = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function signer() {
  const secret = ed25519.utils.randomSecretKey();
  const publicKey = b64(Uint8Array.from([...prefix, ...ed25519.getPublicKey(secret)]));
  return (version: number, policy: OrgPolicy, deploymentId = 'acme'): SignedPolicy => {
    const document = JSON.stringify({ version, deploymentId, issuedAt: '2026-10-25T12:00:00Z', policy });
    const signature = b64(ed25519.sign(new TextEncoder().encode(`CONVO-POLICY-V1\nacme\n${document}`), secret));
    return { version, document, signature, publicKey, keyId: 'k' };
  };
}
const strict: OrgPolicy = { ...DEFAULT_POLICY, notifications: { maxPreview: 'generic' }, features: { ...DEFAULT_POLICY.features, chatExport: false } };
const reason = (f: () => unknown) => { try { f(); } catch (e) { return (e as PolicyRejectedError).reason; } return 'accepted'; };

describe('signed organization policy (AC-ADM-02)', () => {
  it('accepts a correctly signed policy and pins its key', () => {
    const sign = signer();
    const v1 = verifyPolicy(sign(1, strict), 'acme', undefined);
    expect(v1.policy.features.chatExport).toBe(false);
    expect(verifyPolicy(sign(2, DEFAULT_POLICY), 'acme', v1).version).toBe(2);
  });
  it('rejects tampering, another deployment, a new key and rollback', () => {
    const sign = signer();
    const v2 = verifyPolicy(sign(2, strict), 'acme', undefined);
    const tampered = { ...sign(3, strict), document: sign(3, DEFAULT_POLICY).document };
    expect(reason(() => verifyPolicy(tampered, 'acme', v2))).toBe('bad-signature');
    expect(reason(() => verifyPolicy(sign(3, strict), 'other', v2))).toBe('bad-signature'); // context binds the deployment
    expect(reason(() => verifyPolicy(signer()(3, strict), 'acme', v2))).toBe('key-changed');
    expect(reason(() => verifyPolicy(sign(1, DEFAULT_POLICY), 'acme', v2))).toBe('rollback');
  });
  it('caps the notification preview', () => {
    expect(effectivePreview('full', strict)).toBe('generic');
    expect(effectivePreview('generic', DEFAULT_POLICY)).toBe('generic');
  });
});
