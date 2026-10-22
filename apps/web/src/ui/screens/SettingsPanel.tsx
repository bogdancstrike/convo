import { ProfileSettings, RecoverySettings, LogOutButton } from './ProfileSettings';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { DeviceDto } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import type { IncomingLinkRequest } from '../../core/linking';
import { labelOf, type Settings as SettingsModel } from '../../core/model';
import { MEDIA_KINDS, type MediaKind } from '../../core/mediaPolicy';
import { passkeyRemoveUrl, passkeySetupUrl } from '../../config/deployment';
import { useChatLocks } from '../chatLocks';
import type { CredentialStatusDto } from '../../api/types';
import { Avatar } from '../components/Avatar';
import { useProfile } from '../components/ProfileContext';
import { Segmented, Switch } from '../components/Controls';
import { Icon, type IconName } from '../components/Icon';
import { useI18n } from '../i18n/i18n';
import { disableWebPush, enableWebPush, webPushEnabled, webPushSupported } from '../webPush';
import { MIN_PASSPHRASE, WrongPassphraseError } from '../../storage/encryptedStore';
import type { MessageKey } from '../i18n/en';

const LINK_POLL_MS = 3000;

export type SettingsPage = 'profile' | 'chats' | 'notifications' | 'storage' | 'privacy' | 'devices' | 'security' | 'recovery';

export const SETTINGS_PAGES: { page: SettingsPage; icon: IconName; title: MessageKey; hint: MessageKey }[] = [
  { page: 'profile', icon: 'camera', title: 'profile.title', hint: 'profile.hint' },
  { page: 'recovery', icon: 'shield', title: 'recovery.title', hint: 'recovery.hint' },
  { page: 'chats', icon: 'palette', title: 'settings.chats', hint: 'settings.chats.hint' },
  { page: 'notifications', icon: 'mute', title: 'settings.notifications', hint: 'settings.notifications.hint' },
  { page: 'storage', icon: 'download', title: 'settings.storage', hint: 'settings.storage.hint' },
  { page: 'privacy', icon: 'lock', title: 'settings.privacy', hint: 'settings.privacy.hint' },
  { page: 'devices', icon: 'devices', title: 'settings.devices', hint: 'settings.devices.hint' },
];

/**
 * Settings (UI.md §7) as a side panel: profile card and category list; each category opens a
 * sub-page (kept in the URL so refresh restores it). Toggles are switches, theme is a segmented
 * control; privacy defaults (read receipts, typing) are off.
 */
export function SettingsPanel({
  client,
  page,
  onNavigate,
  onBack,
  onSignedOut,
  onAllMedia,
}: {
  client: EnclaveClient;
  page: string | null;
  onNavigate: (page: SettingsPage | null) => void;
  onBack: () => void;
  onSignedOut: () => void;
  onAllMedia: () => void;
}) {
  const { t } = useI18n();
  const [settings, setSettings] = useState<SettingsModel>(client.settings);
  useEffect(() => client.on('settings', setSettings), [client]);
  const update = (patch: Partial<SettingsModel>) => void client.updateSettings(patch);
  // Preserve existing bookmarks; Security is no longer a separate navigation category.
  const current = page === 'security' ? { page: 'security', title: 'settings.security' as const } : SETTINGS_PAGES.find((p) => p.page === page);
  const profile = useProfile(client.accountId);
  const [history, setHistory] = useState(client.historyStatus);
  useEffect(() => client.on('history', setHistory), [client]);

  if (current) {
    return (
      <>
        <header className="panel-header sub">
          <button className="icon-btn" onClick={() => onNavigate(null)} aria-label={t('thread.back')} data-testid="settings-back">
            <Icon name="back" />
          </button>
          <h2>{t(current.title)}</h2>
        </header>
        <div className="panel-body settings-body">
          {current.page === 'profile' && <ProfileSettings client={client} />}
          {current.page === 'recovery' && <RecoverySettings client={client} />}
          {current.page === 'chats' && <ChatsPage settings={settings} update={update} />}
          {current.page === 'notifications' && <NotificationsPage client={client} settings={settings} update={update} />}
          {current.page === 'storage' && <StoragePage settings={settings} update={update} />}
          {current.page === 'privacy' && <PrivacyPage client={client} settings={settings} update={update} />}
          {current.page === 'devices' && <DevicesPage client={client} />}
          {current.page === 'security' && <SecurityPage client={client} onSignedOut={onSignedOut} />}
        </div>
      </>
    );
  }

  return (
    <>
      <header className="panel-header">
        <button className="icon-btn back-button" onClick={onBack} aria-label={t('thread.back')}>
          <Icon name="back" />
        </button>
        <h2 id="settings-title">{t('settings.title')}</h2>
      </header>
      <div className="panel-body settings-body settings-home" aria-labelledby="settings-title" data-testid="settings-overview">
        <button className="settings-profile-summary" onClick={() => onNavigate('profile')} data-testid="settings-profile-summary">
          <Avatar id={client.accountId} name={labelOf(client.device)} size={64} />
          <span className="settings-row-text"><strong>{labelOf(client.device)}</strong><span className="muted-text">@{client.device.username}</span>
            {profile?.status && <span className="settings-summary-status">{profile.status}</span>}
          </span><Icon name="next" size={20} />
        </button>
        <ul className="settings-overview list">
          {SETTINGS_PAGES.map((p) => (
            <li key={p.page}>
              <button className="settings-category" onClick={() => onNavigate(p.page)} data-testid={`settings-card-${p.page}`}>
                <span className="settings-icon"><Icon name={p.icon} size={22} /></span>
                <span className="settings-row-text"><strong>{t(p.title)}</strong><span className="muted-text" {...(p.page === 'recovery' ? { 'data-testid': 'history-status' } : {})}>{p.page === 'recovery' ? t(`history.${history}`) : t(p.hint)}</span></span>
                <Icon name="next" size={18} />
              </button>
            </li>
          ))}
          <li><button className="settings-category" onClick={onAllMedia} data-testid="settings-card-all-media"><span className="settings-icon"><Icon name="image" size={22} /></span><span className="settings-row-text"><strong>{t('settings.allMedia')}</strong><span className="muted-text">{t('settings.allMedia.hint')}</span></span><Icon name="next" size={18} /></button></li>
        </ul>
        <div className="settings-home-footer">
          <LogOutButton client={client} onSignedOut={onSignedOut} />
          <p className="settings-footnote"><Icon name="lock" size={14} /> {t('home.encrypted')}</p>
        </div>
      </div>
    </>
  );
}

function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="settings-card">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
}

/**
 * Media auto-download. Browsers cannot tell roaming apart and never save files automatically, so
 * one switch per media kind applies to Wi-Fi and other networks; Android offers per-network rules.
 */
/** Device notifications: opt-in, browser permission, preview level (generic by default). */
function NotificationsPage({ client, settings, update }: { client: EnclaveClient; settings: SettingsModel; update: (p: Partial<SettingsModel>) => void }) {
  const { t } = useI18n();
  // Web Push (closed tabs): the browser subscription is the state; offered when the server has a VAPID key.
  const [closedTab, setClosedTab] = useState<boolean | null>(null);
  const [pushError, setPushError] = useState(false);
  useEffect(() => { void webPushEnabled().then(setClosedTab); }, []);
  const toggleClosedTab = async (on: boolean) => {
    setPushError(false);
    try {
      if (on) { const ok = await enableWebPush(client); setClosedTab(ok); if (!ok) setPermission(Notification.permission); }
      else { await disableWebPush(client); setClosedTab(false); }
    } catch { setPushError(true); setClosedTab(await webPushEnabled()); }
  };
  const supported = typeof Notification !== 'undefined';
  const [permission, setPermission] = useState(supported ? Notification.permission : 'denied');
  const toggle = async (on: boolean) => {
    if (on && supported && Notification.permission !== 'granted') setPermission(await Notification.requestPermission());
    update({ notifications: on && (!supported || Notification.permission === 'granted') });
  };
  return (
    <Card title={t('settings.notifications')}>
      <Switch checked={settings.notifications && permission === 'granted'} disabled={!supported} onChange={(on) => void toggle(on)}
        label={t('notify.setting')} description={permission === 'denied' ? t('notify.blocked') : t('notify.settingHelp')} testId="toggle-notifications" />
      <Segmented label={t('notify.preview')} value={settings.notificationPreview} testId="notification-preview" onChange={(v) => update({ notificationPreview: v as SettingsModel['notificationPreview'] })}
        options={[{ value: 'generic', label: t('notify.preview.generic') }, { value: 'sender', label: t('notify.preview.sender') }, { value: 'full', label: t('notify.preview.full') }]} />
      <p className="muted-text">{t('notify.previewHelp')}</p>
      {webPushSupported() && (
        <Switch checked={closedTab === true} disabled={closedTab === null} onChange={(on) => void toggleClosedTab(on)}
          label={t('notify.closed')} description={t('notify.closedHelp')} testId="toggle-web-push" />
      )}
      {pushError && <p role="alert" className="failed">{t('notify.closedError')}</p>}
    </Card>
  );
}

function StoragePage({ settings, update }: { settings: SettingsModel; update: (p: Partial<SettingsModel>) => void }) {
  const { t } = useI18n();
  const enabled = (kind: MediaKind) => settings.autoDownload.wifi.includes(kind);
  const toggle = (kind: MediaKind, on: boolean) => {
    const next = (list: MediaKind[]) => MEDIA_KINDS.filter((k) => (k === kind ? on : list.includes(k)));
    update({ autoDownload: { ...settings.autoDownload, wifi: next(settings.autoDownload.wifi), cellular: next(settings.autoDownload.cellular) } });
  };
  return (
    <Card title={t('settings.autoDownload')}>
      <p className="muted-text">{t('settings.autoDownload.help')}</p>
      {MEDIA_KINDS.map((kind) => (
        <Switch key={kind} checked={enabled(kind)} onChange={(on) => toggle(kind, on)} label={t(`media.kind.${kind}`)} testId={`auto-download-${kind}`} />
      ))}
    </Card>
  );
}

function ChatsPage({ settings, update }: { settings: SettingsModel; update: (p: Partial<SettingsModel>) => void }) {
  const { t } = useI18n();
  return (
    <>
      <Card title={t('settings.wallpaper')}>
        <div className="wallpaper-options">{(['dots', 'plain', 'ocean', 'botanical'] as const).map((wallpaper) =>
          <button key={wallpaper} className="wallpaper-choice" aria-pressed={settings.wallpaper === wallpaper} onClick={() => update({ wallpaper })} data-testid={`wallpaper-${wallpaper}`}>
            <span className="wallpaper-preview" data-wallpaper={wallpaper}><span className="preview-bubble">{t('settings.wallpaperPreview')}</span></span>
            <span>{t(`wallpaper.${wallpaper}`)}</span>{settings.wallpaper === wallpaper && <Icon name="check" size={16} />}
          </button>)}</div>
      </Card>
      <Card title={t('settings.theme')}>
        <Segmented
          label={t('settings.theme')}
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          testId="theme-select"
          options={[
            { value: 'system', label: t('settings.theme.system') },
            { value: 'light', label: t('settings.theme.light') },
            { value: 'dark', label: t('settings.theme.dark') },
          ]}
        />
      </Card>
      <Card title={t('settings.language')}>
        <Segmented
          label={t('settings.language')}
          value={settings.locale}
          onChange={(locale) => update({ locale })}
          options={[
            { value: 'en', label: 'English' },
            { value: 'ro', label: 'Română' },
          ]}
        />
      </Card>
      <Card>
        <Switch checked={settings.animations} onChange={(animations) => update({ animations })} label={t('settings.animations')} description={t('settings.animationsHelp')} testId="toggle-animations" />
        <Switch checked={settings.enterToSend} onChange={(enterToSend) => update({ enterToSend })} label={t('settings.enterToSend')} />
      </Card>
      <Card title={t('shortcuts.title')}>
        <p className="muted-text">{t('shortcuts.help')}</p>
        <dl className="shortcut-list" data-testid="shortcut-list">
          {(['menu', 'reply', 'edit', 'star', 'forward', 'info', 'delete', 'move'] as const).map((k) => (
            <div key={k}><dt><kbd>{t(`shortcuts.key.${k}`)}</kbd></dt><dd>{t(`shortcuts.${k}`)}</dd></div>
          ))}
        </dl>
      </Card>
    </>
  );
}

function PrivacyPage({ client, settings, update }: { client: EnclaveClient; settings: SettingsModel; update: (p: Partial<SettingsModel>) => void }) {
  const { t } = useI18n();
  const [sharing, setSharing] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => void client.lastSeenPrivacy().then((p) => { if (!cancelled) { setSharing(p.shareLastSeen); setFailed(false); } }).catch(() => !cancelled && setFailed(true));
    load(); const timer = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [client]);
  return (
    <>
    <PasskeyCard client={client} />
    <Card>
      <h3>{t('settings.browserTrustTitle')}</h3>
      <p className="muted-text">{t('settings.browserTrust')}</p>
      <Switch checked={sharing ?? false} disabled={sharing === null || busy} onChange={(enabled) => {
        setBusy(true); setFailed(false);
        void client.setLastSeenPrivacy(enabled).then(() => setSharing(enabled)).catch(() => setFailed(true)).finally(() => setBusy(false));
      }} label={t('presence.setting')} description={t('presence.settingBody')} testId="toggle-last-seen" />
      {failed && <p role="alert" className="failed">{t('presence.failed')}</p>}
      <Switch checked={settings.confirmExternalLinks} onChange={(confirmExternalLinks) => update({ confirmExternalLinks })}
        label={t('links.setting')} description={t('links.settingBody')} testId="toggle-link-confirmation" />
      <Switch
        checked={settings.readReceipts}
        onChange={(readReceipts) => update({ readReceipts })}
        label={t('settings.readReceipts')}
        description={t('settings.readReceipts.help')}
        testId="toggle-read-receipts"
      />
      <Switch
        checked={settings.typingIndicators}
        onChange={(typingIndicators) => update({ typingIndicators })}
        label={t('settings.typing')}
        description={t('settings.typing.help')}
        testId="toggle-typing"
      />
    </Card>
    <StorageLockCard client={client} />
    </>
  );
}

/**
 * Browser passphrase lock (WEB-01): wraps this browser's storage keys with a passphrase; Convo
 * locks on start and after inactivity. Distinct from sign-in, recovery code and passkey locks.
 */
function StorageLockCard({ client }: { client: EnclaveClient }) {
  const { t } = useI18n();
  const store = client.localStore;
  const [enabled, setEnabled] = useState(store.passphraseEnabled);
  const [idle, setIdle] = useState(store.idleMinutes);
  const [mode, setMode] = useState<'none' | 'enable' | 'change' | 'remove'>('none');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = () => { setMode('none'); setCurrent(''); setNext(''); setRepeat(''); setError(null); };
  const submit = async () => {
    if (mode !== 'remove' && [...next].length < MIN_PASSPHRASE) { setError(t('storeLock.minLength', { count: MIN_PASSPHRASE })); return; }
    if (mode !== 'remove' && next !== repeat) { setError(t('storeLock.mismatch')); return; }
    setBusy(true); setError(null);
    try {
      if (mode === 'enable') await store.enablePassphrase(next, 5);
      else if (mode === 'change') await store.changePassphrase(current, next);
      else await store.disablePassphrase(current);
      setEnabled(store.passphraseEnabled); setIdle(store.idleMinutes); reset();
    } catch (e) {
      setError(e instanceof WrongPassphraseError ? t('storeLock.wrong') : t('storeLock.failed'));
    } finally { setBusy(false); }
  };
  const field = (label: MessageKey, value: string, set: (v: string) => void, testId: string, autoComplete: string) => (
    <label className="field"><span>{t(label)}</span>
      <input type="password" value={value} onChange={(e) => set(e.target.value)} autoComplete={autoComplete} data-testid={testId} disabled={busy} /></label>
  );
  return (
    <Card title={t('storeLock.setting')}>
      <p className="muted-text">{t('storeLock.settingHelp')}</p>
      {enabled && <p data-testid="storage-lock-status"><Icon name="lock" size={18} /> {t('storeLock.on')}</p>}
      {mode === 'none' ? (
        <div className="lock-actions">
          {!enabled && <button className="btn btn-primary" onClick={() => setMode('enable')} data-testid="storage-lock-enable">{t('storeLock.enable')}</button>}
          {enabled && <>
            <button className="btn btn-primary" onClick={() => window.dispatchEvent(new Event('convo:lock'))} data-testid="storage-lock-now">{t('storeLock.lockNow')}</button>
            <button className="btn btn-ghost" onClick={() => setMode('change')} data-testid="storage-lock-change">{t('storeLock.change')}</button>
            <button className="btn btn-ghost" onClick={() => setMode('remove')} data-testid="storage-lock-remove">{t('storeLock.remove')}</button>
          </>}
        </div>
      ) : (
        <form className="lock-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {mode !== 'enable' && field('storeLock.current', current, setCurrent, 'storage-lock-current', 'current-password')}
          {mode !== 'remove' && field('storeLock.new', next, setNext, 'storage-lock-new', 'new-password')}
          {mode !== 'remove' && field('storeLock.repeat', repeat, setRepeat, 'storage-lock-repeat', 'new-password')}
          {mode !== 'remove' && <p className="muted-text">{t('storeLock.minLength', { count: MIN_PASSPHRASE })}</p>}
          {busy && mode === 'enable' && <p aria-live="polite">{t('storeLock.working')}</p>}
          {error && <p role="alert" className="failed" data-testid="storage-lock-error">{error}</p>}
          <div className="lock-actions">
            <button className="btn btn-primary" type="submit" disabled={busy} data-testid="storage-lock-save">{mode === 'remove' ? t('storeLock.remove') : t('storeLock.save')}</button>
            <button className="btn btn-ghost" type="button" onClick={reset} disabled={busy}>{t('storeLock.cancel')}</button>
          </div>
        </form>
      )}
      {enabled && mode === 'none' && (
        <Segmented label={t('storeLock.after')} value={String(idle)} testId="storage-lock-after"
          onChange={(v) => void store.setIdleMinutes(Number(v)).then(() => setIdle(store.idleMinutes))}
          options={[{ value: '1', label: t('appLock.minutes', { count: 1 }) }, { value: '5', label: t('appLock.minutes', { count: 5 }) },
            { value: '15', label: t('appLock.minutes', { count: 15 }) }, { value: '60', label: t('appLock.minutes', { count: 60 }) }, { value: '0', label: t('storeLock.manual') }]} />
      )}
    </Card>
  );
}

/**
 * Passkeys are created and removed by Keycloak's own actions (a new tab with Convo's sign-in theme,
 * where the browser talks to the authenticator); Convo lists the account's passkeys and never
 * holds rights to change them. A passkey gates app and chat locks.
 */
function PasskeyCard({ client }: { client: EnclaveClient }) {
  const { t, date } = useI18n();
  const [status, setStatus] = useState<CredentialStatusDto | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = (refresh: boolean) => void client.credentialStatus(refresh).then((s) => !cancelled && setStatus(s));
    // Fresh from the IdP whenever Settings opens: a passkey may have been added or removed elsewhere.
    load(true);
    // Re-check (bypassing the server cache) when the user returns from the sign-in service tab.
    const onFocus = () => document.visibilityState === 'visible' && load(true);
    document.addEventListener('visibilitychange', onFocus);
    return () => { cancelled = true; document.removeEventListener('visibilitychange', onFocus); };
  }, [client]);
  // Prepared ahead so the links open synchronously on click (no popup blocking).
  const [setupUrl, setSetupUrl] = useState<string | null>(null);
  const [removeUrls, setRemoveUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    void passkeySetupUrl().then(setSetupUrl);
    void Promise.all((status?.passkeys ?? []).map(async (p) => [p.id, await passkeyRemoveUrl(p.id)] as const))
      .then((entries) => setRemoveUrls(Object.fromEntries(entries.filter((e): e is readonly [string, string] => !!e[1]))));
  }, [status]);
  const label = !status ? t('passkeys.checking') : status.state === 'unavailable' ? t('passkeys.unavailable') : status.passkey ? t('passkeys.enrolled') : t('passkeys.none');
  return (
    <Card title={t('passkeys.title')}>
      <p className="muted-text">{t('passkeys.help')}</p>
      <p data-testid="passkey-status" data-state={status ? (status.state === 'unavailable' ? 'unavailable' : String(status.passkey)) : 'loading'}>
        <Icon name={status?.passkey ? 'check' : 'shield'} size={18} /> {label}
      </p>
      {status?.state === 'available' && !!status.passkeys?.length && (
        <ul className="passkey-list" data-testid="passkey-list">
          {status.passkeys.map((p) => (
            <li key={p.id} data-testid="passkey-item">
              <Icon name="shield" size={18} />
              <span className="passkey-name">{p.label || t('passkeys.unnamed')}
                {p.createdAt > 0 && <small className="muted-text">{t('passkeys.added', { date: date(p.createdAt) })}</small>}</span>
              {removeUrls[p.id] && <a className="btn btn-ghost" href={removeUrls[p.id]} target="_blank" rel="noopener noreferrer" data-testid="remove-passkey">{t('passkeys.remove')}</a>}
            </li>
          ))}
        </ul>
      )}
      {status?.state === 'available' && setupUrl && (
        <>
          {!status.passkey && <p className="muted-text">{t('passkeys.setupHelp')}</p>}
          <a className={status.passkey ? 'btn' : 'btn btn-primary'} href={setupUrl} target="_blank" rel="noopener noreferrer" data-testid="setup-passkey">{status.passkey ? t('passkeys.addAnother') : t('passkeys.setup')}</a>
        </>
      )}
      <AppLockSettings client={client} />
    </Card>
  );
}

/** Web app lock: passkey on open and after being hidden; requires a confirmed passkey to turn on. */
function AppLockSettings({ client }: { client: EnclaveClient }) {
  const { t } = useI18n();
  const locks = useChatLocks();
  const [settings, setSettings] = useState(client.settings);
  useEffect(() => client.on('settings', setSettings), [client]);
  return (
    <>
      <Switch checked={settings.appLock} disabled={!settings.appLock && locks.passkey !== true} onChange={(on) => void locks.setAppLock(on)}
        label={t('appLock.setting')} description={settings.appLock || locks.passkey === true ? t('appLock.settingHelp') : t('appLock.needsPasskey')} testId="toggle-app-lock" />
      {settings.appLock && (
        <Segmented label={t('appLock.after')} value={String(settings.appLockAfterMinutes)} testId="app-lock-after"
          onChange={(v) => void client.updateSettings({ appLockAfterMinutes: Number(v) as 0 | 1 | 5 | 15 })}
          options={[{ value: '0', label: t('appLock.immediately') }, { value: '1', label: t('appLock.minutes', { count: 1 }) }, { value: '5', label: t('appLock.minutes', { count: 5 }) }, { value: '15', label: t('appLock.minutes', { count: 15 }) }]} />
      )}
      {locks.error && <p role="alert" className="failed">{locks.error}</p>}
    </>
  );
}

function DevicesPage({ client }: { client: EnclaveClient }) {
  const { t, date } = useI18n();
  const [devices, setDevices] = useState<DeviceDto[]>([]);
  const load = useCallback(() => void client.devices().then(setDevices).catch(() => undefined), [client]);
  useEffect(() => {
    load();
    return client.on('devices', load);
  }, [client, load]);

  return (
    <>
      <LinkRequests client={client} />
      <Card title={t('settings.devices')}>
        {devices.map((d) => (
          <div key={d.deviceId} className="device-row" data-testid="device-row">
            <span className="settings-icon">
              <Icon name="devices" size={20} />
            </span>
            <span className="settings-row-text">
              <span>{d.current ? t('settings.thisDevice') : `${d.platform} · #${d.deviceId}`}</span>
              <span className="muted-text">{t('settings.linkedOn', { date: date(Date.parse(d.createdAt)) })}</span>
            </span>
            {!d.current && (
              <button className="btn btn-ghost btn-danger" onClick={() => {
                if (window.confirm(t('settings.confirmUnlink'))) void client.unlinkDevice(d.deviceId).then(load);
              }}>
                {t('settings.unlink')}
              </button>
            )}
          </div>
        ))}
      </Card>
    </>
  );
}

function SecurityPage({ client, onSignedOut }: { client: EnclaveClient; onSignedOut: () => void }) {
  const { t } = useI18n();
  return (
    <>
      <Card title={t('settings.browserTrustTitle')}>
        <p className="muted-text" style={{ margin: 0 }}>{t('settings.browserTrust')}</p>
      </Card>
      <Card><LogOutButton client={client} onSignedOut={onSignedOut} /></Card>
    </>
  );
}

/**
 * Approving side of device linking (UI.md §4.2): pending requests with the comparison code. The
 * user approves only after checking the code matches the new device's screen.
 */
function LinkRequests({ client }: { client: EnclaveClient }) {
  const { t } = useI18n();
  const [requests, setRequests] = useState<IncomingLinkRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = () => void client.incomingLinkRequests().then((r) => !stopped && setRequests(r)).catch(() => undefined);
    load();
    const timer = setInterval(load, LINK_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [client]);

  const act = async (request: IncomingLinkRequest, approve: boolean) => {
    setBusy(request.provisioningId);
    try {
      if (approve) await client.approveLink(request);
      else await client.declineLink(request.provisioningId);
      setRequests((r) => r.filter((x) => x.provisioningId !== request.provisioningId));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="settings-card" id="link-requests" aria-labelledby="link-requests-title">
      <h3 id="link-requests-title">{t('link.requests.title')}</h3>
      {requests.length === 0 ? (
        <p className="muted-text" style={{ margin: 0 }}>{t('link.requests.none')}</p>
      ) : (
        requests.map((r) => (
          <div key={r.provisioningId} data-testid="link-request" style={{ display: 'grid', gap: 10 }}>
            <strong>{t('link.requests.prompt', { label: r.label })}</strong>
            <span className="muted-text">{t('link.requests.compare')}</span>
            <div className="code-box" data-testid="link-request-code">{r.code}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" disabled={busy !== null} onClick={() => void act(r, false)}>
                {t('link.requests.decline')}
              </button>
              <button className="btn btn-primary" disabled={busy !== null} onClick={() => void act(r, true)}>
                {t('link.requests.approve')}
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

export function SettingsNavigation({ client, page, onNavigate, onBack, onSignedOut, onAllMedia }: { client: EnclaveClient; page: string | null; onNavigate: (page: SettingsPage | null) => void; onBack: () => void; onSignedOut: () => void; onAllMedia: () => void }) {
  const { t } = useI18n();
  return <><header className="panel-header"><button className="icon-btn back-button" onClick={onBack} aria-label={t('thread.back')}><Icon name="back" /></button><h2>{t('settings.title')}</h2></header>
    <div className="panel-body settings-body settings-navigation"><button className="settings-row" onClick={() => onNavigate(null)}><Avatar id={client.accountId} name={labelOf(client.device)} size={48} /><span className="settings-row-text">{labelOf(client.device)}<span className="muted-text">{t('settings.overview')}</span></span></button>
    <ul className="list">{SETTINGS_PAGES.map((p) => <li key={p.page}><button className="settings-row" aria-current={page === p.page ? 'page' : undefined} onClick={() => onNavigate(p.page)} data-testid={`settings-${p.page}`}><span className="settings-icon"><Icon name={p.icon} size={20} /></span><span className="settings-row-text">{t(p.title)}<span className="muted-text">{t(p.hint)}</span></span></button></li>)}<li><button className="settings-row" onClick={onAllMedia} data-testid="settings-all-media"><span className="settings-icon"><Icon name="image" size={20} /></span><span className="settings-row-text">{t('settings.allMedia')}<span className="muted-text">{t('settings.allMedia.hint')}</span></span></button></li></ul><div className="settings-logout-row"><LogOutButton client={client} onSignedOut={onSignedOut} testId="settings-log-out" /></div></div></>;
}
