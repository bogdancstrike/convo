import { useEffect, useRef, useState } from 'react';
import { Track, type Participant, type RemoteTrack } from 'livekit-client';
import type { EnclaveClient } from '../../core/client';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';
import { formatDuration } from '../useVoiceRecorder';
import { accountOf, audioTrackOf, LiveKitCall, screenTrackOf, videoTrackOf } from './liveKitCall';
import { useCalls } from './CallProvider';

/**
 * Full-window call UI (UI.md §9): incoming ring with Accept/Decline, outgoing "Calling…", and the
 * connected view with remote tiles, local preview, mute/camera/end controls and an E2EE badge.
 */
export function CallScreen({ client }: { client: EnclaveClient }) {
  const { t } = useI18n();
  const { call, media, accept, decline, hangUp, version, minimized, setMinimized, peerReconnecting } = useCalls();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => { dialog.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [call?.phase]);
  if (!call) return null;
  const conversation = client.conversations().find((c) => c.id === call.conversationId);
  const title = conversation?.title ?? t('calls.unknown');
  const group = conversation?.kind === 'group';
  void version;
  const remotes = media?.remotes ?? [];
  const status = call.phase === 'incoming' ? t(call.video ? 'calls.incomingVideo' : 'calls.incomingVoice')
    : call.phase === 'outgoing' ? t('calls.calling')
    : call.phase === 'connecting' ? t('calls.connecting')
    : call.phase === 'connected' ? (peerReconnecting || media?.reconnecting ? t('calls.reconnecting') : formatDuration(now - (call.connectedAt ?? now)))
    : t(`calls.reason.${call.reason ?? 'ended'}`);
  const showVideo = call.video && call.phase === 'connected';
  // Presenter layout: a remote screen share takes the stage in voice and video calls alike.
  const presenter = call.phase === 'connected' ? media?.presenter : undefined;
  const [shareError, setShareError] = useState(false);
  const toggleShare = async () => {
    if (!media) return;
    setShareError(false);
    try { await media.setScreenShare(!media.screenSharing); } catch { setShareError(true); }
  };

  // Minimized (WhatsApp): a bar along the top keeps the call one tap away while chats stay usable.
  if (minimized) return (
    <div className="call-mini-bar" role="region" aria-label={t('calls.dialog', { name: title })} data-testid="call-mini-bar">
      <button className="call-mini-return" onClick={() => setMinimized(false)} data-testid="call-return">
        <Icon name={call.video ? 'video' : 'calls'} size={16} /> {title} · {status} <span className="call-mini-hint">{t('calls.tapToReturn')}</span>
      </button>
      <button className="icon-btn call-mini-end" onClick={hangUp} aria-label={t('calls.end')} data-testid="call-mini-end"><Icon name="callEnd" size={16} /></button>
      {/* Audio keeps playing while minimized. */}
      {remotes.map((p) => <RemoteAudio key={p.identity} participant={p} />)}
    </div>
  );
  return (
    <div className={`call-screen${showVideo ? ' video' : ''}`} role="dialog" aria-modal="true" aria-label={t('calls.dialog', { name: title })}
      ref={dialog} data-testid="call-screen" data-phase={call.phase} data-reason={call.reason ?? ''} data-encrypted={media?.encrypted ? 'true' : 'false'} data-key-generation={media?.generation ?? 0}
      onKeyDown={(e) => { if (e.key === 'Escape' && call.phase !== 'incoming' && call.phase !== 'ended') setMinimized(true); }}>
      {call.phase !== 'incoming' && call.phase !== 'ended' && (
        <button className="icon-btn call-minimize" onClick={() => setMinimized(true)} aria-label={t('calls.minimize')} title={t('calls.minimize')} data-testid="call-minimize"><Icon name="chevronDown" size={22} /></button>
      )}
      {media?.cameraFailed && <p className="call-notice" role="status">{t('calls.cameraFailed')}</p>}
      {presenter ? (
        <div className="call-presenting">
          <ScreenStage client={client} participant={presenter} />
          {showVideo && <div className="call-strip">{remotes.map((p) => <RemoteTile key={p.identity} client={client} participant={p} />)}</div>}
        </div>
      ) : showVideo && remotes.length > 0 ? (
        <div className={`call-grid n${Math.min(remotes.length, 4)}`}>
          {remotes.map((p) => <RemoteTile key={p.identity} client={client} participant={p} />)}
        </div>
      ) : (
        <div className="call-identity">
          <Avatar id={call.conversationId} name={title} size={112} group={group} />
          <h2>{title}</h2>
          <p className="call-status" data-testid="call-status" aria-live="polite">{status}</p>
          {call.phase === 'connected' && group && <p className="muted-text">{t('calls.participants', { count: remotes.length + 1 })}</p>}
        </div>
      )}
      {showVideo && <p className="call-status overlay" data-testid="call-status" aria-live="polite">{status}</p>}
      {media && call.video && media.cameraEnabled && <LocalPreview client={client} />}
      {remotes.map((p) => <RemoteAudio key={p.identity} participant={p} />)}
      {media?.screenSharing && <p className="call-sharing" data-testid="call-sharing"><Icon name="screenShare" size={16} /> {t('calls.youPresenting')}</p>}
      {shareError && <p className="call-sharing error" role="alert">{t('calls.shareFailed')}</p>}
      {call.phase === 'connected' && <p className="call-e2ee" data-testid="call-e2ee"><Icon name="lock" size={14} /> {media?.encrypted ? t('calls.e2ee') : t('calls.encrypting')}</p>}
      <div className="call-controls">
        {call.phase === 'incoming' ? (
          <>
            <button className="call-btn decline" onClick={decline} aria-label={t('calls.decline')} data-testid="call-decline"><Icon name="callEnd" size={28} /></button>
            <button className="call-btn accept" onClick={accept} aria-label={t('calls.accept')} data-testid="call-accept"><Icon name={call.video ? 'video' : 'calls'} size={28} /></button>
          </>
        ) : call.phase !== 'ended' ? (
          <>
            <button className="call-btn" aria-pressed={media ? !media.micEnabled : false} disabled={!media} onClick={() => void media?.setMic(!media.micEnabled)}
              aria-label={media?.micEnabled === false ? t('calls.unmute') : t('calls.mute')} data-testid="call-mute"><Icon name={media?.micEnabled === false ? 'micOff' : 'mic'} /></button>
            {call.video && <button className="call-btn" aria-pressed={media ? !media.cameraEnabled : false} disabled={!media} onClick={() => void media?.setCamera(!media.cameraEnabled)}
              aria-label={media?.cameraEnabled ? t('calls.cameraOff') : t('calls.cameraOn')} data-testid="call-camera"><Icon name={media?.cameraEnabled ? 'video' : 'videoOff'} /></button>}
            {call.phase === 'connected' && LiveKitCall.canShareScreen && <button className="call-btn" aria-pressed={!!media?.screenSharing} disabled={!media} onClick={() => void toggleShare()}
              aria-label={media?.screenSharing ? t('calls.stopShare') : t('calls.shareScreen')} data-testid="call-share-screen"><Icon name="screenShare" /></button>}
            <button className="call-btn decline" onClick={hangUp} aria-label={t('calls.end')} data-testid="call-end"><Icon name="callEnd" size={28} /></button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function RemoteTile({ client, participant }: { client: EnclaveClient; participant: Participant }) {
  const ref = useRef<HTMLVideoElement>(null);
  const track = videoTrackOf(participant);
  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return undefined;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  const account = accountOf(participant);
  const name = client.conversations().find((c) => c.id === account)?.title ?? account.slice(0, 8);
  return (
    <div className={`call-tile${participant.isSpeaking ? ' speaking' : ''}`} data-testid="call-tile">
      {track ? <video ref={ref} autoPlay playsInline muted data-testid="remote-video" /> : <Avatar id={account} name={name} size={72} />}
      <span className="call-tile-name">{name}</span>
    </div>
  );
}

/** A remote participant's shared screen, letterboxed to fit (never cropped). */
function ScreenStage({ client, participant }: { client: EnclaveClient; participant: Participant }) {
  const { t } = useI18n();
  const ref = useRef<HTMLVideoElement>(null);
  const track = screenTrackOf(participant);
  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return undefined;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  const account = accountOf(participant);
  const name = client.conversations().find((c) => c.id === account)?.title ?? account.slice(0, 8);
  return (
    <figure className="call-screen-share" data-testid="remote-screen">
      <video ref={ref} autoPlay playsInline muted />
      <figcaption>{t('calls.presenting', { name })}</figcaption>
    </figure>
  );
}

function RemoteAudio({ participant }: { participant: Participant }) {
  const ref = useRef<HTMLAudioElement>(null);
  const track: RemoteTrack | undefined = audioTrackOf(participant);
  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return undefined;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <audio ref={ref} autoPlay data-testid="remote-audio" />;
}

function LocalPreview({ client: _client }: { client: EnclaveClient }) {
  const { media } = useCalls();
  const ref = useRef<HTMLVideoElement>(null);
  const track = media?.room.localParticipant.getTrackPublication(Track.Source.Camera)?.track;
  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return undefined;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <video ref={ref} className="call-local" autoPlay playsInline muted aria-hidden="true" data-testid="local-video" />;
}
