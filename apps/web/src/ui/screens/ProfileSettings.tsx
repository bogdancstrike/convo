import { useEffect, useRef, useState } from 'react';
import { LogoutRecoveryRequiredError, type EnclaveClient } from '../../core/client';
import { labelOf } from '../../core/model';
import { prepareProfilePhoto } from '../../core/profile';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Popover';
import { useProfile } from '../components/ProfileContext';
import { useI18n } from '../i18n/i18n';

export function ProfileSettings({ client }: { client: EnclaveClient }) {
  const { t } = useI18n(); const profile = useProfile(client.accountId);
  const [status, setStatus] = useState(profile?.status ?? ''); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setStatus(profile?.status ?? ''), [profile?.status]);
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(false); try { await work(); } catch { setError(true); } finally { setBusy(false); } };
  return <section className="settings-card profile-editor"><div className="profile-heading">
    <Avatar id={client.accountId} name={labelOf(client.device)} size={100} />
    <div><h2>{labelOf(client.device)}</h2><p className="muted-text" data-testid="own-handle">@{client.device.username}</p></div>
    <Menu label={t('profile.photoActions')} items={[
      { label: t(profile?.photo ? 'profile.changePhoto' : 'profile.addPhoto'), icon: 'camera', onSelect: () => input.current?.click() },
      ...(profile?.photo ? [{ label: t('profile.removePhoto'), icon: 'trash' as const, danger: true, onSelect: () => { if (window.confirm(t('profile.confirmRemovePhoto'))) void run(() => client.updateProfile({ photo: undefined })); } }] : []),
    ]} trigger={({ open, toggle }) => <button className="icon-btn" disabled={busy} aria-label={t('profile.photoActions')} aria-expanded={open} onClick={toggle} data-testid="profile-photo-menu"><Icon name="more" /></button>} />
    <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden data-testid="profile-photo-input" onChange={(e) => {
      const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(async () => client.updateProfile({ photo: await prepareProfilePhoto(file) }));
    }} />
  </div><h3>{t('profile.title')}</h3><p className="muted-text">{t('profile.sharing')}</p>
    <form onSubmit={(e) => { e.preventDefault(); void run(() => client.updateProfile({ status: status.trim() })); }}>
      <label className="field">{t('profile.status')}<textarea maxLength={280} value={status} onChange={(e) => setStatus(e.target.value)} placeholder={t('profile.statusHint')} data-testid="profile-status" /></label>
      <div className="profile-status-actions"><span className="muted-text">{status.length}/280</span><span className="spacer" />
        {profile?.status && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void run(() => client.updateProfile({ status: '' }))}>{t('profile.clearStatus')}</button>}
        <button className="btn btn-primary" disabled={busy || status.trim() === (profile?.status ?? '')} data-testid="save-profile-status">{t('profile.save')}</button>
      </div>
    </form>{error && <p role="alert" className="failed">{t('profile.failed')}</p>}
  </section>;
}

export function RecoverySettings({ client }: { client: EnclaveClient }) {
  const { t } = useI18n(); const [configured, setConfigured] = useState(false); const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  const [history, setHistory] = useState(client.historyStatus);
  useEffect(() => { void client.recoveryStatus().then((s) => setConfigured(s.configured)); return client.on('history', setHistory); }, [client]);
  return <section className="settings-card recovery-settings"><h3>{t('recovery.title')}</h3><p className="muted-text">{t('recovery.setupBody')}</p>
    <div className="history-state" role="status" data-testid="history-status"><Icon name={history === 'synced' ? 'check' : 'clock'} size={18} />{t(`history.${history}`)}</div>
    <button className="btn btn-ghost" disabled={history === 'syncing'} onClick={() => void client.syncHistory()} data-testid="sync-history">{t('history.sync')}</button>
    <p>{t(configured ? 'recovery.configured' : 'recovery.notConfigured')}</p>
    {code ? <><p>{t('recovery.saveCode')}</p><textarea className="recovery-code" readOnly value={code} aria-label={t('recovery.code')} data-testid="recovery-code" />
      <button className="btn" onClick={() => {
        const url = URL.createObjectURL(new Blob([`Convo recovery code\n${code}\nKeep this code offline and private.\n`], { type: 'text/plain' }));
        const link = document.createElement('a'); link.href = url; link.download = 'convo-recovery-code.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>{t('recovery.download')}</button><button className="btn btn-primary" onClick={() => setCode('')}>{t('recovery.saved')}</button></> :
    <button className="btn btn-primary" disabled={busy} data-testid="create-recovery-code" onClick={() => {
      if (configured && !window.confirm(t('recovery.confirmReplace'))) return;
      setBusy(true); setError(false);
      void client.createRecoveryCode().then((value) => { setCode(value); setConfigured(true); }).catch(() => setError(true)).finally(() => setBusy(false));
    }}>{t(configured ? 'recovery.replace' : 'recovery.create')}</button>}
    {error && <p role="alert" className="failed">{t('recovery.setupFailed')}</p>}
  </section>;
}

export function LogOutButton({ client, onSignedOut, testId = 'log-out' }: { client: EnclaveClient; onSignedOut: () => void; testId?: string }) {
  const { t } = useI18n(); const [busy, setBusy] = useState(false); const [error, setError] = useState<'sync' | 'recovery' | null>(null);
  return <><button className="btn btn-ghost btn-danger" disabled={busy} data-testid={testId} onClick={() => {
    if (!window.confirm(t('settings.confirmSignOut'))) return;
    setBusy(true); setError(null);
    void client.signOutAndWipe().then(onSignedOut).catch((e) => setError(e instanceof LogoutRecoveryRequiredError ? 'recovery' : 'sync')).finally(() => setBusy(false));
  }}><Icon name="logout" size={18} />{t('settings.logOut')}</button>{error && <p role="alert">{t(error === 'recovery' ? 'history.logoutNeedsRecovery' : 'history.logoutBlocked')}</p>}</>;
}
