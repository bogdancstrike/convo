import {
  acceptAll,
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  generateKeyPackageWithKey,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup,
  processMessage,
  type CiphersuiteImpl,
  type ClientState,
  type KeyPackage,
  type PrivateKeyPackage,
  type Proposal,
} from 'ts-mls';
import { defaultClientConfig } from 'ts-mls/clientConfig.js';
import { decodeKeyPackage, encodeKeyPackage, makeKeyPackageRef } from 'ts-mls/keyPackage.js';
import { unprotectPrivateMessage } from 'ts-mls/messageProtection.js';
import { addToMap } from 'ts-mls/util/addToMap.js';
import { fromBase64Url, fromUtf8, toBase64Url, utf8 } from '../lib/bytes';
import { portableCryptoProvider } from './mlsProvider';

/**
 * Browser MLS facade (RFC 9420; specs §6) over `ts-mls`. Pure functions on immutable state:
 * callers persist the returned state atomically with whatever the operation produced.
 *
 * Profile: ciphersuite `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (specs §3.2 baseline),
 * basic credentials whose identity is the device address `accountId.deviceId`, one long-lived
 * Ed25519 signature key per device, commits sent as PublicMessage (the DS can order them,
 * ADR-006), ratchet tree carried in Welcome (GroupInfo extension).
 *
 * Interim status: like the TS Signal adapter this is an FND-02 stand-in for the Rust OpenMLS core.
 * Device binding (GRP-01) is implemented beside the credential: each device's signature key is
 * vouched for by the account identity key (`mlsBinding.ts`) and checked at KeyPackage claim and for
 * every leaf after Welcome/commit (`GroupManager`). The reviewed role profile is a follow-up.
 */

export const MLS_SUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519';

let suite: Promise<CiphersuiteImpl> | null = null;

/**
 * Lazily initialized ciphersuite implementation on the {@link portableCryptoProvider} (pure-JS
 * primitives, identical in every browser).
 */
export function cipherSuite(): Promise<CiphersuiteImpl> {
  suite ??= getCiphersuiteImpl(getCiphersuiteFromName(MLS_SUITE), portableCryptoProvider);
  return suite;
}

/** Per-device MLS signature key (Ed25519). */
export interface MlsSigner {
  signKey: string;
  publicKey: string;
}

/** A KeyPackage: public part for upload, private part kept locally until a Welcome uses it. */
export interface GeneratedKeyPackage {
  ref: string;
  /** Encoded MLSMessage(KeyPackage), uploaded to the server. */
  message: string;
  /** Encoded KeyPackage (needed again by joinGroup). */
  keyPackage: string;
  initPrivateKey: string;
  hpkePrivateKey: string;
}

/** Generates the device's long-lived MLS signature key. */
export async function generateSigner(): Promise<MlsSigner> {
  const keys = await (await cipherSuite()).signature.keygen();
  return { signKey: toBase64Url(keys.signKey), publicKey: toBase64Url(keys.publicKey) };
}

/** Builds the basic credential for a device address. */
export function credentialFor(accountId: string, deviceId: number) {
  return { credentialType: 'basic' as const, identity: utf8(`${accountId}.${deviceId}`) };
}

/** Generates `count` single-use KeyPackages bound to the device signer. */
export async function generateKeyPackages(signer: MlsSigner, accountId: string, deviceId: number, count: number): Promise<GeneratedKeyPackage[]> {
  const cs = await cipherSuite();
  const out: GeneratedKeyPackage[] = [];
  for (let i = 0; i < count; i++) {
    const kp = await generateKeyPackageWithKey(
      credentialFor(accountId, deviceId),
      defaultCapabilities(),
      defaultLifetime,
      [],
      { signKey: fromBase64Url(signer.signKey), publicKey: fromBase64Url(signer.publicKey) },
      cs,
    );
    out.push({
      ref: toBase64Url(await makeKeyPackageRef(kp.publicPackage, cs.hash)),
      message: toBase64Url(encodeMlsMessage({ keyPackage: kp.publicPackage, wireformat: 'mls_key_package', version: 'mls10' })),
      keyPackage: toBase64Url(encodeKeyPackage(kp.publicPackage)),
      initPrivateKey: toBase64Url(kp.privatePackage.initPrivateKey),
      hpkePrivateKey: toBase64Url(kp.privatePackage.hpkePrivateKey),
    });
  }
  return out;
}

/** Decodes a claimed KeyPackage message from another device. */
export function decodeKeyPackageMessage(message: string): KeyPackage {
  const decoded = decodeMlsMessage(fromBase64Url(message), 0)?.[0];
  if (!decoded || decoded.wireformat !== 'mls_key_package') throw new Error('not a key package');
  return decoded.keyPackage;
}

/** Device address (`accountId.deviceId`) of a KeyPackage's basic credential. */
export function keyPackageIdentity(kp: KeyPackage): string {
  return identityOf(kp.leafNode.credential);
}

/** Serializes group state for encrypted local storage. */
export function serializeState(state: ClientState): string {
  return toBase64Url(encodeGroupState(state));
}

/** Restores group state saved with {@link serializeState}. */
export function deserializeState(serialized: string): ClientState {
  const decoded = decodeGroupState(fromBase64Url(serialized), 0)?.[0];
  if (!decoded) throw new Error('corrupt group state');
  return { ...decoded, clientConfig: defaultClientConfig };
}

/** Current epoch as a number (epochs fit easily in 2^53). */
export function epochOf(state: ClientState): number {
  return Number(state.groupContext.epoch);
}

/** Group ID (base64url). */
export function groupIdOf(state: ClientState): string {
  return toBase64Url(state.groupContext.groupId);
}

/** Leaves with their MLS signature public keys (for device-binding checks, GRP-01). */
export function memberKeys(state: ClientState): { leafIndex: number; identity: string; signatureKey: Uint8Array }[] {
  const result: { leafIndex: number; identity: string; signatureKey: Uint8Array }[] = [];
  state.ratchetTree.forEach((node, index) => {
    if (index % 2 === 0 && node && node.nodeType === 'leaf') {
      result.push({ leafIndex: index / 2, identity: identityOf(node.leaf.credential), signatureKey: node.leaf.signaturePublicKey });
    }
  });
  return result;
}

/** MLS signature public key of a KeyPackage's leaf. */
export function keyPackageSignatureKey(kp: KeyPackage): Uint8Array {
  return kp.leafNode.signaturePublicKey;
}

/** Members as leaf index → device address, from the current ratchet tree. */
export function members(state: ClientState): { leafIndex: number; identity: string }[] {
  return leaves(state.ratchetTree);
}

function leaves(tree: ClientState['ratchetTree']): { leafIndex: number; identity: string }[] {
  const result: { leafIndex: number; identity: string }[] = [];
  tree.forEach((node, index) => {
    if (index % 2 === 0 && node && node.nodeType === 'leaf') {
      result.push({ leafIndex: index / 2, identity: identityOf(node.leaf.credential) });
    }
  });
  return result;
}

function identityOf(credential: { credentialType: string; identity?: Uint8Array }): string {
  if (credential.credentialType !== 'basic' || !credential.identity) return '';
  return fromUtf8(credential.identity);
}

/** Result of creating or changing a group: new state plus wire messages. */
export interface CommitOutput {
  state: ClientState;
  commit?: string;
  welcome?: string;
}

/** Creates a group and adds the given KeyPackages in its first commit. */
export async function createGroupWith(signer: MlsSigner, own: GeneratedKeyPackage, groupId: Uint8Array, add: KeyPackage[]): Promise<CommitOutput> {
  const cs = await cipherSuite();
  const ownPublic = decodeKeyPackage(fromBase64Url(own.keyPackage), 0)?.[0];
  if (!ownPublic) throw new Error('corrupt own key package');
  const ownPrivate: PrivateKeyPackage = {
    initPrivateKey: fromBase64Url(own.initPrivateKey),
    hpkePrivateKey: fromBase64Url(own.hpkePrivateKey),
    signaturePrivateKey: fromBase64Url(signer.signKey),
  };
  const state = await createGroup(groupId, ownPublic, ownPrivate, [], cs);
  if (add.length === 0) return { state };
  return commit(state, add.map((keyPackage) => ({ proposalType: 'add', add: { keyPackage } })));
}

/** Creates a commit with the given proposals (adds/removes); welcome is set when members are added. */
export async function commit(state: ClientState, proposals: Proposal[]): Promise<CommitOutput> {
  const cs = await cipherSuite();
  const result = await createCommit(
    { state, cipherSuite: cs },
    { extraProposals: proposals, ratchetTreeExtension: true, wireAsPublicMessage: true },
  );
  return {
    state: result.newState,
    commit: toBase64Url(encodeMlsMessage(result.commit)),
    welcome: result.welcome && toBase64Url(encodeMlsMessage({ welcome: result.welcome, wireformat: 'mls_welcome', version: 'mls10' })),
  };
}

/** Builds Add proposals. */
export function addProposals(keyPackages: KeyPackage[]): Proposal[] {
  return keyPackages.map((keyPackage) => ({ proposalType: 'add', add: { keyPackage } }));
}

/** Builds Remove proposals for leaf indexes. */
export function removeProposals(leafIndexes: number[]): Proposal[] {
  return leafIndexes.map((removed) => ({ proposalType: 'remove', remove: { removed } }));
}

/** KeyPackage refs a Welcome is addressed to (base64url), to find the matching local package. */
export function welcomeTargets(welcome: string): string[] {
  const decoded = decodeMlsMessage(fromBase64Url(welcome), 0)?.[0];
  if (!decoded || decoded.wireformat !== 'mls_welcome') throw new Error('not a welcome');
  return decoded.welcome.secrets.map((s) => toBase64Url(s.newMember));
}

/** Joins a group from a Welcome using the matching local KeyPackage. */
export async function join(welcome: string, signer: MlsSigner, kp: GeneratedKeyPackage): Promise<ClientState> {
  const cs = await cipherSuite();
  const decoded = decodeMlsMessage(fromBase64Url(welcome), 0)?.[0];
  if (!decoded || decoded.wireformat !== 'mls_welcome') throw new Error('not a welcome');
  const publicPackage = decodeKeyPackage(fromBase64Url(kp.keyPackage), 0)?.[0];
  if (!publicPackage) throw new Error('corrupt key package');
  return joinGroup(
    decoded.welcome,
    publicPackage,
    {
      initPrivateKey: fromBase64Url(kp.initPrivateKey),
      hpkePrivateKey: fromBase64Url(kp.hpkePrivateKey),
      signaturePrivateKey: fromBase64Url(signer.signKey),
    },
    emptyPskIndex,
    cs,
  );
}

/** Encrypts an application message for the current epoch. */
export async function encrypt(state: ClientState, plaintext: Uint8Array): Promise<{ state: ClientState; message: string; epoch: number }> {
  const cs = await cipherSuite();
  const result = await createApplicationMessage(state, plaintext, cs);
  return {
    state: result.newState,
    epoch: epochOf(state),
    message: toBase64Url(encodeMlsMessage({ privateMessage: result.privateMessage, wireformat: 'mls_private_message', version: 'mls10' })),
  };
}

/** Outcome of processing a handshake message. */
export type HandshakeResult = { kind: 'applied'; state: ClientState } | { kind: 'removed'; state: ClientState };

/** Applies a public commit from another member. */
export async function processCommit(state: ClientState, message: string): Promise<HandshakeResult> {
  const cs = await cipherSuite();
  const decoded = decodeMlsMessage(fromBase64Url(message), 0)?.[0];
  if (!decoded || (decoded.wireformat !== 'mls_public_message' && decoded.wireformat !== 'mls_private_message')) {
    throw new Error('not a handshake message');
  }
  const result = await processMessage(decoded, state, emptyPskIndex, acceptAll, cs);
  if (result.kind !== 'newState') throw new Error('expected a handshake message');
  return result.newState.groupActiveState.kind === 'removedFromGroup'
    ? { kind: 'removed', state: result.newState }
    : { kind: 'applied', state: result.newState };
}

/**
 * Decrypts an application message **and** returns the authenticated sender's device address.
 * `ts-mls` verifies the sender's signature against its leaf but does not expose the leaf, so this
 * mirrors its epoch handling (current or retained past epoch) around `unprotectPrivateMessage`.
 */
export async function decrypt(state: ClientState, message: string): Promise<{ state: ClientState; plaintext: Uint8Array; sender: string }> {
  const cs = await cipherSuite();
  const decoded = decodeMlsMessage(fromBase64Url(message), 0)?.[0];
  if (!decoded || decoded.wireformat !== 'mls_private_message') throw new Error('not an application message');
  const pm = decoded.privateMessage;
  const retention = state.clientConfig.keyRetentionConfig;
  if (pm.epoch < state.groupContext.epoch) {
    const past = state.historicalReceiverData.get(pm.epoch);
    if (!past) throw new Error('epoch too old');
    const result = await unprotectPrivateMessage(past.senderDataSecret, pm, past.secretTree, past.ratchetTree, past.groupContext, retention, cs);
    const content = result.content.content;
    if (content.contentType !== 'application' || content.sender.senderType !== 'member') throw new Error('not an application message');
    return {
      state: { ...state, historicalReceiverData: addToMap(state.historicalReceiverData, pm.epoch, { ...past, secretTree: result.tree }) },
      plaintext: content.applicationData,
      sender: senderIdentity(past.ratchetTree, content.sender.leafIndex),
    };
  }
  if (pm.epoch > state.groupContext.epoch) throw new Error('message from a future epoch');
  const result = await unprotectPrivateMessage(
    state.keySchedule.senderDataSecret,
    pm,
    state.secretTree,
    state.ratchetTree,
    state.groupContext,
    retention,
    cs,
  );
  const content = result.content.content;
  if (content.contentType !== 'application' || content.sender.senderType !== 'member') throw new Error('not an application message');
  return { state: { ...state, secretTree: result.tree }, plaintext: content.applicationData, sender: senderIdentity(state.ratchetTree, content.sender.leafIndex) };
}

function senderIdentity(tree: ClientState['ratchetTree'], leafIndex: number): string {
  const identity = leaves(tree).find((l) => l.leafIndex === leafIndex)?.identity;
  if (!identity) throw new Error('unknown sender leaf');
  return identity;
}
