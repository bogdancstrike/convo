import { CipherSuite } from '@hpke/core';
import { DhkemX25519HkdfSha256 } from '@hpke/dhkem-x25519';
import type { CryptoProvider } from 'ts-mls';
import { makeGenericHpke } from 'ts-mls/crypto/implementation/hpke.js';
import { makeAead } from 'ts-mls/crypto/implementation/noble/makeAead.js';
import { makeHashImpl } from 'ts-mls/crypto/implementation/noble/makeHashImpl.js';
import { makeKdf, makeKdfImpl } from 'ts-mls/crypto/implementation/noble/makeKdfImpl.js';
import { makeNobleSignatureImpl } from 'ts-mls/crypto/implementation/noble/makeNobleSignatureImpl.js';
import { defaultRng } from 'ts-mls/crypto/implementation/noble/rng.js';

/**
 * MLS crypto provider with **pure-JS primitives only** (noble hashes/ciphers/curves and the noble
 * X25519 HPKE KEM). `ts-mls`'s bundled providers delegate X25519 HPKE to browser WebCrypto, whose
 * behaviour differs between engines (Firefox rejects key agreements that Chromium accepts), which
 * broke commits in Firefox. A single implementation gives identical results in every browser and
 * in Node tests.
 *
 * Only the baseline suite (DHKEM-X25519 / AES-128-GCM / SHA-256 / Ed25519) is wired here; other
 * suites (e.g. the PQ profiles for PQ-01) must add their KEM explicitly.
 */
export const portableCryptoProvider: CryptoProvider = {
  async getCiphersuiteImpl(cs) {
    if (cs.hpke.kem !== 'DHKEM-X25519-HKDF-SHA256') throw new Error(`unsupported KEM ${cs.hpke.kem}`);
    const [aead, aeadInterface] = await makeAead(cs.hpke.aead);
    const hpkeSuite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: makeKdf(cs.hpke.kdf), aead: aeadInterface });
    return {
      kdf: makeKdfImpl(makeKdf(cs.hpke.kdf)),
      hash: makeHashImpl(cs.hash),
      signature: await makeNobleSignatureImpl(cs.signature),
      hpke: await makeGenericHpke(cs.hpke, aead, hpkeSuite),
      rng: defaultRng,
      name: cs.name,
    };
  },
};
