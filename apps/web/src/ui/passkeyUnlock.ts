/**
 * Local "require passkey" check for locked chats on the web: a WebAuthn assertion with user
 * verification for this origin's relying party (the same RP ID Keycloak registers passkeys for).
 *
 * This is a device privacy lock, like Android's biometric chat lock: it keeps a locked chat's
 * content off screen until the person proves presence with their passkey. It is not a
 * cryptographic barrier against someone who already controls this browser profile.
 */
export async function verifyWithPasskey(): Promise<boolean> {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) throw new PasskeyUnavailableError();
  try {
    const credential = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rpId: window.location.hostname,
        userVerification: 'required',
        timeout: 60_000,
      },
    });
    return credential !== null;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'SecurityError') throw new PasskeyUnavailableError();
    return false; // cancelled, timed out or no matching passkey
  }
}

export class PasskeyUnavailableError extends Error {
  constructor() { super('passkeys unavailable on this address'); this.name = 'PasskeyUnavailableError'; }
}
