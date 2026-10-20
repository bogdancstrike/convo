import { useState } from 'react';
import type { EnclaveApi } from '../../api/enclaveApi';
import { recoverAccount } from '../../core/recovery';
import type { Repositories } from '../../core/repositories';
import { useI18n } from '../i18n/i18n';

export function RecoveryScreen({ api, repos, accessToken, onRecovered, onBack }: {
  api: EnclaveApi; repos: Repositories; accessToken: () => Promise<string | null>; onRecovered: () => void; onBack: () => void;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(false);
  return <main className="center-screen"><form className="card" onSubmit={(e) => {
    e.preventDefault(); setBusy(true); setError(false);
    void (async () => {
      try { const token = await accessToken(); if (!token) throw new Error(); await recoverAccount(api, token, code, repos); onRecovered(); }
      catch { setError(true); } finally { setBusy(false); }
    })();
  }}>
    <h1>{t('recovery.title')}</h1><p>{t('recovery.instructions')}</p>
    <label className="field">{t('recovery.code')}<textarea value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} data-testid="recovery-code-input" required /></label>
    <p className="muted-text">{t('recovery.revokes')}</p>
    {error && <p role="alert">{t('recovery.failed')}</p>}
    <button className="btn btn-primary" disabled={busy || !code.trim()} data-testid="recover-account">{t(busy ? 'enroll.progress' : 'recovery.restore')}</button>
    <button type="button" className="btn btn-ghost" disabled={busy} onClick={onBack}>{t('thread.back')}</button>
  </form></main>;
}
