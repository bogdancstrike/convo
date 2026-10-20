import { useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/i18n';

/**
 * Full-screen onboarding and degraded states (UI.md §4.1, §10). Each state explains what happened
 * and offers a concrete next action; there are no blank spinners after failures.
 */

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="center-screen">
      <div className="card" role="region" aria-labelledby="screen-title">
        <img className="logo" src="/favicon.svg" alt="" />
        <h1 id="screen-title">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function LoadingScreen() {
  return (
    <main className="center-screen" aria-busy="true">
      <img className="logo" src="/favicon.svg" alt="Enclave" />
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
