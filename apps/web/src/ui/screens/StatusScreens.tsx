import { useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { useI18n } from '../i18n/i18n';

/**
 * Full-screen onboarding and degraded states (UI.md §4.1, §10). Each state explains what happened
 * and offers a concrete next action; there are no blank spinners after failures.
 */

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="center-screen">
      <div className="card" role="region" aria-labelledby="screen-title">
        <Logo size={56} title="" />
        <h1 id="screen-title">{title}</h1>
        {children}
      </div>
    </main>
  );
}

/**
 * Start-up splash: logo, product name and the end-to-end encryption promise, with a progress bar
 * while configuration, local storage, keys and the first mailbox drain load.
 *
 * @param progress 0..1, or undefined for an indeterminate bar
 * @param stage short status text for screen readers and the caption under the bar
 */
export function SplashScreen({ progress, stage }: { progress?: number; stage?: string }) {
  const { t } = useI18n();
  return (
    <main className="splash" aria-busy="true" data-testid="splash">
      <div className="splash-center">
        <Logo size={88} />
        <h1>{t('appName')}</h1>
        <div
          className={`progress${progress === undefined ? ' indeterminate' : ''}`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress === undefined ? undefined : Math.round(progress * 100)}
          aria-label={stage ?? t('splash.loading')}
        >
          <span style={progress === undefined ? undefined : { width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className="muted-text" aria-live="polite">{stage ?? '\u00a0'}</p>
      </div>
      <p className="splash-footer">
        <Icon name="lock" size={14} /> {t('splash.e2ee')}
      </p>
    </main>
  );
}

/** Organization entry: browser trust acknowledgement + SSO (UI.md §4.1, §8). */
export function WelcomeScreen({ organization, onSignIn }: { organization: string; onSignIn: () => void }) {
  const { t } = useI18n();
  const [acknowledged, setAcknowledged] = useState(false);
  return (
    <Screen title={t('welcome.title')}>
      <p>
        <strong>{organization}</strong>
      </p>
      <p>{t('welcome.body')}</p>
      <label className="check">
        <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
        <span>{t('welcome.trust')}</span>
      </label>
      <button className="btn btn-primary" disabled={!acknowledged} onClick={onSignIn}>
        {t('welcome.signIn')}
      </button>
    </Screen>
  );
}

export function EnrollingScreen({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Screen title={t('appName')}>
      <p role="status">{failed ? t('enroll.failed') : t('enroll.progress')}</p>
      {failed && (
        <button className="btn btn-primary" onClick={onRetry}>
          {t('enroll.retry')}
        </button>
      )}
    </Screen>
  );
}

export function OtherTabScreen({ onUseHere }: { onUseHere: () => void }) {
  const { t } = useI18n();
  return (
    <Screen title={t('tab.title')}>
      <p>{t('tab.body')}</p>
      <button className="btn btn-primary" onClick={onUseHere}>
        {t('tab.useHere')}
      </button>
    </Screen>
  );
}

export function RevokedScreen({ onContinue }: { onContinue: () => void }) {
  const { t } = useI18n();
  return (
    <Screen title={t('revoked.title')}>
      <p>{t('revoked.body')}</p>
      <button className="btn btn-primary" onClick={onContinue}>
        {t('welcome.signIn')}
      </button>
    </Screen>
  );
}

export function UpdateRequiredScreen() {
  const { t } = useI18n();
  return (
    <Screen title={t('update.title')}>
      <p>{t('update.body')}</p>
      <button className="btn btn-primary" onClick={() => window.location.reload()}>
        {t('enroll.retry')}
      </button>
    </Screen>
  );
}

export function UnreachableScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Screen title={t('appName')}>
      <p role="alert">{t('error.unreachable')}</p>
      <button className="btn btn-primary" onClick={onRetry}>
        {t('enroll.retry')}
      </button>
    </Screen>
  );
}

/** Local encrypted data is missing or unreadable (cleared storage, eviction, private mode). */
export function StorageLostScreen({ onReset }: { onReset: () => void }) {
  const { t } = useI18n();
  return (
    <Screen title={t('storage.title')}>
      <p>{t('storage.body')}</p>
      <button className="btn btn-primary" onClick={onReset}>
        {t('storage.reset')}
      </button>
    </Screen>
  );
}

/**
 * Browser passphrase lock (WEB-01): nothing is decrypted until the passphrase unwraps the storage
 * keys. A forgotten passphrase can only be answered by setting the browser up again.
 */
export function StorageUnlockScreen({ onUnlock, onReset }: { onUnlock: (passphrase: string) => Promise<boolean>; onReset: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [forgot, setForgot] = useState(false);
  return (
    <Screen title={t('storeLock.title')}>
      <form className="lock-form" data-testid="storage-locked" onSubmit={(e) => {
        e.preventDefault();
        if (!value || busy) return;
        setBusy(true); setWrong(false);
        void onUnlock(value).then((ok) => { setBusy(false); if (!ok) { setWrong(true); setValue(''); } });
      }}>
        <p>{t('storeLock.body')}</p>
        <label className="field">
          <span>{t('storeLock.passphrase')}</span>
          <input type="password" autoComplete="current-password" autoFocus value={value} onChange={(e) => setValue(e.target.value)}
            aria-invalid={wrong} aria-describedby={wrong ? 'unlock-error' : undefined} data-testid="storage-passphrase" />
        </label>
        {wrong && <p id="unlock-error" role="alert" className="failed" data-testid="storage-wrong">{t('storeLock.wrong')}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || !value} data-testid="storage-unlock">{busy ? t('storeLock.unlocking') : t('storeLock.unlock')}</button>
      </form>
      {!forgot ? <button className="btn btn-ghost" onClick={() => setForgot(true)} data-testid="storage-forgot">{t('storeLock.forgot')}</button> : (
        <div className="lock-form">
          <p className="muted-text">{t('storeLock.forgotBody')}</p>
          <button className="btn btn-danger" onClick={onReset} data-testid="storage-reset">{t('storage.reset')}</button>
        </div>
      )}
    </Screen>
  );
}
