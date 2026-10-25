import libsignal from '@privacyresearch/libsignal-protocol-typescript';

/**
 * MLS device bindings (GRP-01). A device's long-lived MLS signature key is bound to its account by an
 * XEdDSA signature with the account identity key — the same key people compare as safety numbers —
 * over `CONVO-MLS-BINDING-V1\n<deploymentId>\n<accountId>.<deviceId>\n` followed by the 32-byte key.
 * The server stores bindings but cannot forge them, so a KeyPackage or group leaf whose signature
 * key is not bound to the claimed device cannot be slipped into a group by the server.
 */
const CONTEXT = 'CONVO-MLS-BINDING-V1';

export type BindingVerdict = 'bound' | 'unbound' | 'invalid';

let curve: Promise<{ Curve: { async: { calculateSignature(k: ArrayBuffer, m: ArrayBuffer): Promise<ArrayBuffer>; verifySignature(p: ArrayBuffer, m: ArrayBuffer, s: ArrayBuffer): Promise<boolean> } } }> | null = null;
const signalCurve = () => (curve ??= libsignal());

const buffer = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer as ArrayBuffer;

export function bindingMessage(deploymentId: string, accountId: string, deviceId: number, signatureKey: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode(`${CONTEXT}\n${deploymentId}\n${accountId}.${deviceId}\n`);
  const out = new Uint8Array(prefix.length + signatureKey.length);
  out.set(prefix); out.set(signatureKey, prefix.length);
  return out;
}

/** Signs this device's binding with the account identity private key (32-byte Curve25519). */
export async function signBinding(identityPrivate: Uint8Array, deploymentId: string, accountId: string, deviceId: number, signatureKey: Uint8Array): Promise<Uint8Array> {
  const { Curve } = await signalCurve();
  return new Uint8Array(await Curve.async.calculateSignature(buffer(identityPrivate), buffer(bindingMessage(deploymentId, accountId, deviceId, signatureKey))));
}

/**
 * Checks a leaf/KeyPackage signature key against the published binding for that device.
 * `unbound`: the device has not published a binding (older app version); `invalid`: a binding exists
 * but is not signed by the trusted identity key, or binds a different signature key.
 */
export async function verifyBinding(identityPublic: Uint8Array, deploymentId: string, accountId: string, deviceId: number, leafSignatureKey: Uint8Array,
  published: { signatureKey: Uint8Array; binding: Uint8Array } | undefined): Promise<BindingVerdict> {
  if (!published) return 'unbound';
  if (published.signatureKey.length !== leafSignatureKey.length || !published.signatureKey.every((b, i) => b === leafSignatureKey[i])) return 'invalid';
  const { Curve } = await signalCurve();
  try {
    // This library's verifySignature resolves `false` for a VALID signature (legacy libsignal-js
    // semantics: "is it bad?") and throws for an invalid one; anything else counts as invalid.
    const bad = await Curve.async.verifySignature(buffer(identityPublic), buffer(bindingMessage(deploymentId, accountId, deviceId, published.signatureKey)), buffer(published.binding));
    return bad === false ? 'bound' : 'invalid';
  } catch { return 'invalid'; }
}
