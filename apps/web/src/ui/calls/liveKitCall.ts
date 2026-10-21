import { createKeyMaterialFromString, DisconnectReason, ExternalE2EEKeyProvider, isE2EESupported, Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import { supersedes, type CallJoin, type CallKey } from '../../core/calls';
import { CallEncryptionUnsupportedError } from './errors';

export { CallEncryptionUnsupportedError };

/** LiveKit's key ring holds 16 keys; a generation maps to a slot. */
const KEY_RING = 16;

/** Shared-key provider that can install a key at a ring index (and switch encryption to it). */
class RotatingKeyProvider extends ExternalE2EEKeyProvider {
  async setKeyAt(key: string, index: number): Promise<void> {
    this.onSetEncryptionKey(await createKeyMaterialFromString(key), undefined, index);
  }
}

/**
 * One LiveKit room connection with mandatory end-to-end frame encryption.
 *
 * The media key comes from the Signal/MLS-encrypted ring; LiveKit (self-hosted SFU) only relays
 * encrypted frames. If the browser cannot run the frame cryptor the call is refused — there is no
 * unencrypted fallback.
 */
export class LiveKitCall {
  readonly room: Room;
  private readonly keyProvider = new RotatingKeyProvider();
  private current: CallKey | undefined;
  private readonly worker: Worker;

  constructor(private readonly onChange: () => void, private readonly onParticipantLeft: () => void = () => undefined,
    private readonly onRemoved: () => void = () => undefined) {
    if (!isE2EESupported()) throw new CallEncryptionUnsupportedError();
    this.worker = new Worker(new URL('livekit-client/e2ee-worker', import.meta.url), { type: 'module' });
    this.room = new Room({ adaptiveStream: true, dynacast: true, e2ee: { keyProvider: this.keyProvider, worker: this.worker } });
    for (const event of [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ConnectionStateChanged,
      RoomEvent.ActiveSpeakersChanged, RoomEvent.ParticipantEncryptionStatusChanged, RoomEvent.Reconnecting, RoomEvent.Reconnected]) {
      this.room.on(event, () => this.onChange());
    }
    this.room.on(RoomEvent.ParticipantDisconnected, () => this.onParticipantLeft());
    // The server removes devices of accounts that left the group (or were removed) from its calls.
    this.room.on(RoomEvent.Disconnected, (reason) => { if (reason === DisconnectReason.PARTICIPANT_REMOVED) this.onRemoved(); });
  }

  /** Same-origin WebSocket base; the SDK appends LiveKit's `/rtc` path. */
  static url(join: CallJoin): string {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${window.location.host}${join.path.replace(/\/rtc\/?$/, '')}`;
  }

  async connect(join: CallJoin, key: string, video: boolean, generation = 0): Promise<void> {
    await this.applyKey({ key, generation });
    await this.room.setE2EEEnabled(true);
    await this.room.connect(LiveKitCall.url(join), join.token, { autoSubscribe: true });
    await this.room.localParticipant.setMicrophoneEnabled(true);
    if (video) await this.room.localParticipant.setCameraEnabled(true);
    this.onChange();
  }

  /** Installs a newer media key (rekey); older ones stay in the ring so in-flight frames decrypt. */
  async applyKey(next: CallKey): Promise<void> {
    if (!supersedes(this.current, next)) return;
    this.current = next;
    await this.keyProvider.setKeyAt(next.key, next.generation % KEY_RING);
  }

  get generation(): number { return this.current?.generation ?? 0; }
  /** Identities of everyone in the room, including this device. */
  get identities(): string[] { return [this.room.localParticipant.identity, ...this.remotes.map((p) => p.identity)]; }

  get remotes(): Participant[] { return [...this.room.remoteParticipants.values()]; }
  get micEnabled(): boolean { return this.room.localParticipant.isMicrophoneEnabled; }
  get cameraEnabled(): boolean { return this.room.localParticipant.isCameraEnabled; }
  /**
   * True when E2EE is on and every remote participant's published tracks are encrypted (LiveKit
   * reports this per participant after frames decrypt with our key).
   */
  get encrypted(): boolean { return this.room.isE2EEEnabled && this.remotes.length > 0 && this.remotes.every((p) => p.isEncrypted); }

  setMic(on: boolean) { return this.room.localParticipant.setMicrophoneEnabled(on); }
  setCamera(on: boolean) { return this.room.localParticipant.setCameraEnabled(on); }

  async leave(): Promise<void> {
    await this.room.disconnect(true).catch(() => undefined);
    this.worker.terminate();
  }
}

/** Account ID of a LiveKit identity (`accountId:deviceId`, set by the server). */
export function accountOf(participant: Participant): string { return participant.identity.split(':')[0] ?? participant.identity; }

export function videoTrackOf(participant: Participant): RemoteTrack | undefined {
  const publication = participant.getTrackPublication(Track.Source.Camera);
  return publication && !publication.isMuted ? (publication.track as RemoteTrack | undefined) : undefined;
}

export function audioTrackOf(participant: Participant): RemoteTrack | undefined {
  return participant.getTrackPublication(Track.Source.Microphone)?.track as RemoteTrack | undefined;
}
