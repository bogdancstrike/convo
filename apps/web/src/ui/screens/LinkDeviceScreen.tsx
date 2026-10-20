import { useEffect, useRef, useState } from 'react';
import type { EnclaveApi } from '../../api/enclaveApi';
import { browserLabel, LinkRequest } from '../../core/linking';
import type { Repositories } from '../../core/repositories';
import { useI18n } from '../i18n/i18n';

const POLL_INTERVAL_MS = 2000;

type State =
  | { name: 'starting' }
  | { name: 'waiting'; code: string }
  | { name: 'linking' }
  | { name: 'ended'; reason: 'expired' | 'cancelled' | 'failed' };

/**
 * New-device side of linking (UI.md §4.2): shows the comparison code, waits for approval from a
 * trusted device, then registers this browser. Earlier history is not copied.
 */
export function LinkDeviceScreen({
  api,
  repos,
  accessToken,
  onLinked,
  onSignInAgain,
}: {
  api: EnclaveApi;
  repos: Repositories;
  accessToken: () => Promise<string | null>;
  onLinked: () => void;
  onSignInAgain: () => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<State>({ name: 'starting' });
  const [attempt, setAttempt] = useState(0);
  const request = useRef<LinkRequest | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      const token = await accessToken();
      if (!token) {
        onSignInAgain();
        return;
      }
      try {
        const link = await LinkRequest.start(api, token, browserLabel());
        if (stopped) return void link.cancel();
        request.current = link;
        setState({ name: 'waiting', code: link.code });
        const poll = async () => {
          if (stopped) return;
          try {
            const outcome = await link.poll();
            if (outcome === 'approved') {
              setState({ name: 'linking' });
              await link.complete(repos);
              if (!stopped) onLinked();
              return;
            }
            if (outcome !== 'waiting') {
              setState({ name: 'ended', reason: outcome });
              return;
            }
          } catch (error) {
            console.warn('Link polling failed', error instanceof Error ? error.message : error);
          }
          timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        };
        timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
      } catch (error) {
        console.warn('Link failed', error instanceof Error ? error.message : error);
        if (!stopped) setState({ name: 'ended', reason: 'failed' });
      }
    })();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [api, repos, accessToken, onLinked, onSignInAgain, attempt]);

  const restart = () => {
    setState({ name: 'starting' });
    setAttempt((n) => n + 1);
  };

  return (
    <main className="center-screen">
      <div className="card" role="region" aria-labelledby="link-title">
        <img className="logo" src="/favicon.svg" alt="" />
        <h1 id="link-title">{t('link.title')}</h1>
        {state.name === 'starting' && <p role="status">{t('link.starting')}</p>}
        {state.name === 'waiting' && (
          <>
            <p>{t('link.instructions')}</p>
            <div className="safety-number" aria-label={t('link.code')} data-testid="link-code">
              {state.code}
            </div>
            <p className="muted-text">{t('link.history')}</p>
            <p role="status" className="muted-text">
              {t('link.waiting')}
            </p>
            <button
              className="btn"
              onClick={() => {
                void request.current?.cancel();
                setState({ name: 'ended', reason: 'cancelled' });
              }}
            >
              {t('thread.cancel')}
            </button>
          </>
        )}
        {state.name === 'linking' && <p role="status">{t('enroll.progress')}</p>}
        {state.name === 'ended' && (
          <>
            <p role="alert">{t(`link.ended.${state.reason}`)}</p>
            <button className="btn btn-primary" onClick={restart}>
              {t('link.newCode')}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
