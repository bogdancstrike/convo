import { ProfileSettings, RecoverySettings, LogOutButton } from './ProfileSettings';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { DeviceDto } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import type { IncomingLinkRequest } from '../../core/linking';
import { labelOf, type Settings as SettingsModel } from '../../core/model';
import { Avatar } from '../components/Avatar';
import { useProfile } from '../components/ProfileContext';
import { Segmented, Switch } from '../components/Controls';
import { Icon, type IconName } from '../components/Icon';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

const LINK_POLL_MS = 3000;

export type SettingsPage = 'profile' | 'chats' | 'privacy' | 'devices' | 'security' | 'recovery';

export const SETTINGS_PAGES: { page: SettingsPage; icon: IconName; title: MessageKey; hint: MessageKey }[] = [
  { page: 'profile', icon: 'camera', title: 'profile.title', hint: 'profile.hint' },
  { page: 'recovery', icon: 'shield', title: 'recovery.title', hint: 'recovery.hint' },
  { page: 'chats', icon: 'palette', title: 'settings.chats', hint: 'settings.chats.hint' },
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
