import { useCallback, useEffect, useState } from 'react';
import type { DeviceDto } from '../../api/types';
import type { EnclaveClient } from '../../core/client';
import type { IncomingLinkRequest } from '../../core/linking';
import type { Settings as SettingsModel } from '../../core/model';
import { useI18n } from '../i18n/i18n';

/**
 * Settings (UI.md §7): profile handle, appearance, language, privacy defaults (receipts/typing
 * off), devices with unlink, and sign-out with local wipe.
 */
export function SettingsPane({ client, onSignedOut }: { client: EnclaveClient; onSignedOut: () => void }) {
  const { t, date } = useI18n();
  const [settings, setSettings] = useState<SettingsModel>(client.settings);
  const [devices, setDevices] = useState<DeviceDto[]>([]);

  const loadDevices = useCallback(() => void client.devices().then(setDevices).catch(() => undefined), [client]);
  useEffect(() => {
    loadDevices();
    const offDevices = client.on('devices', loadDevices);
    const offSettings = client.on('settings', setSettings);
    return () => {
      offDevices();
      offSettings();
    };
  }, [client, loadDevices]);

  const update = (patch: Partial<SettingsModel>) => void client.updateSettings(patch);

  return (
    <main className="settings settings-pane" aria-labelledby="settings-title">
      <h2 id="settings-title">{t('settings.title')}</h2>

      <section aria-labelledby="profile-title">
        <h3 id="profile-title">{t('settings.profile')}</h3>
        <div className="setting-row">
          <span>{t('settings.handle')}</span>
          <strong data-testid="own-handle">@{client.device.username}</strong>
        </div>
      </section>

      <section aria-labelledby="appearance-title">
        <h3 id="appearance-title">{t('settings.appearance')}</h3>
        <div className="setting-row">
          <label htmlFor="theme">{t('settings.theme')}</label>
          <select id="theme" className="input" style={{ width: 'auto' }} value={settings.theme}
            onChange={(e) => update({ theme: e.target.value as SettingsModel['theme'] })}>
            <option value="system">{t('settings.theme.system')}</option>
            <option value="light">{t('settings.theme.light')}</option>
            <option value="dark">{t('settings.theme.dark')}</option>
          </select>
        </div>
        <div className="setting-row">
          <label htmlFor="locale">{t('settings.language')}</label>
          <select id="locale" className="input" style={{ width: 'auto' }} value={settings.locale}
            onChange={(e) => update({ locale: e.target.value as SettingsModel['locale'] })}>
            <option value="en">English</option>
            <option value="ro">Română</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={settings.enterToSend} onChange={(e) => update({ enterToSend: e.target.checked })} />
          <span>{t('settings.enterToSend')}</span>
        </label>
      </section>

      <section aria-labelledby="privacy-title">
        <h3 id="privacy-title">{t('settings.privacy')}</h3>
        <label className="check">
          <input type="checkbox" checked={settings.readReceipts} onChange={(e) => update({ readReceipts: e.target.checked })} />
          <span>
            {t('settings.readReceipts')}
            <br />
            <span className="muted-text">{t('settings.readReceipts.help')}</span>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.typingIndicators} onChange={(e) => update({ typingIndicators: e.target.checked })} />
          <span>
            {t('settings.typing')}
            <br />
            <span className="muted-text">{t('settings.typing.help')}</span>
          </span>
        </label>
      </section>

      <LinkRequests client={client} />

      <section aria-labelledby="devices-title">
        <h3 id="devices-title">{t('settings.devices')}</h3>
        <p className="muted-text">{t('settings.browserTrust')}</p>
        {devices.map((d) => (
          <div key={d.deviceId} className="device-row" data-testid="device-row">
            <div>
              <strong>{d.current ? t('settings.thisDevice') : `${d.platform} · #${d.deviceId}`}</strong>
              <div className="muted-text">{t('settings.linkedOn', { date: date(Date.parse(d.createdAt)) })}</div>
            </div>
            {!d.current && (
              <button
                className="btn btn-danger"
                onClick={() => {
                  if (window.confirm(t('settings.confirmUnlink'))) void client.unlinkDevice(d.deviceId).then(loadDevices);
                }}
              >
                {t('settings.unlink')}
              </button>
            )}
          </div>
        ))}
      </section>

      <section>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm(t('settings.confirmSignOut'))) void client.signOutAndWipe().finally(onSignedOut);
          }}
        >
          {t('settings.signOut')}
        </button>
      </section>
    </main>
  );
}

const LINK_POLL_MS = 3000;

/**
 * Approving side of device linking (UI.md §4.2): pending requests with the comparison code.
 * The user approves only after checking the code matches the new device's screen.
 */
function LinkRequests({ client }: { client: EnclaveClient }) {
  const { t } = useI18n();
  const [requests, setRequests] = useState<IncomingLinkRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    const load = () =>
      void client
        .incomingLinkRequests()
        .then((r) => !stopped && setRequests(r))
        .catch(() => undefined);
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
    <section aria-labelledby="link-requests-title">
      <h3 id="link-requests-title">{t('link.requests.title')}</h3>
      {requests.length === 0 ? (
        <p className="muted-text">{t('link.requests.none')}</p>
      ) : (
        requests.map((r) => (
          <div key={r.provisioningId} className="device-row" data-testid="link-request">
            <div>
              <strong>{t('link.requests.prompt', { label: r.label })}</strong>
              <div className="muted-text">{t('link.requests.compare')}</div>
              <div className="safety-number" data-testid="link-request-code">
                {r.code}
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              <button className="btn btn-primary" disabled={busy !== null} onClick={() => void act(r, true)}>
                {t('link.requests.approve')}
              </button>
              <button className="btn" disabled={busy !== null} onClick={() => void act(r, false)}>
                {t('link.requests.decline')}
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
