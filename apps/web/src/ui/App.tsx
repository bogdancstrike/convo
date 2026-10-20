import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/errors';
import { OrganizationAuth } from '../auth/oidc';
import { loadDeploymentInfo, UpdateRequiredError, type DeploymentInfo } from '../config/deployment';
import { createClient, openLocalContext, type LocalContext } from '../core/bootstrap';
import type { EnclaveClient } from '../core/client';
import { enrollPrimary } from '../core/enrollment';
import { LeaderLock } from '../core/leader';
import type { Settings } from '../core/model';
import { browserLocale, I18nProvider, type Locale } from './i18n/i18n';
import { MainLayout } from './screens/MainLayout';
import {
  EnrollingScreen,
  HasDevicesScreen,
  LoadingScreen,
  OtherTabScreen,
  RevokedScreen,
  StorageLostScreen,
  UnreachableScreen,
  UpdateRequiredScreen,
  WelcomeScreen,
} from './screens/StatusScreens';

/**
 * Top-level state machine (UI.md §4, §10):
 *
 * loading → (unreachable | update) → welcome → [IdP redirect] → enrolling → (hasDevices | ready)
 * ready ⇄ otherTab (leader lock), ready → revoked (device unlinked).
 */
type Phase =
  | { name: 'loading' }
  | { name: 'unreachable' }
  | { name: 'update' }
  | { name: 'welcome' }
  | { name: 'enrolling'; failed: boolean }
  | { name: 'hasDevices' }
  | { name: 'otherTab' }
  | { name: 'revoked' }
  | { name: 'storageLost' }
  | { name: 'ready'; client: EnclaveClient };

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });
  const [locale, setLocale] = useState<Locale>(browserLocale());
  const info = useRef<DeploymentInfo | null>(null);
  const auth = useRef<OrganizationAuth | null>(null);
  const context = useRef<LocalContext | null>(null);
  const leader = useRef(new LeaderLock());

  const applySettings = useCallback((settings: Settings) => {
    setLocale(settings.locale);
    if (settings.theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.locale;
  }, []);

  /** Starts the protocol client if this tab can become the leader. */
  const startClient = useCallback(
    async (steal = false) => {
      const ctx = context.current!;
      const client = await createClient(ctx);
      if (!client) {
        setPhase({ name: 'welcome' });
        return;
      }
      const isLeader = await leader.current.acquire(steal, () => {
        client.stop();
        setPhase({ name: 'otherTab' });
      });
      if (!isLeader) {
        setPhase({ name: 'otherTab' });
        return;
      }
      applySettings(client.settings);
      client.on('settings', applySettings);
      client.on('revoked', () => setPhase({ name: 'revoked' }));
      await client.start();
      setPhase({ name: 'ready', client });
    },
    [applySettings],
  );

  const enroll = useCallback(async () => {
    setPhase({ name: 'enrolling', failed: false });
    try {
      const token = await auth.current!.accessToken();
      if (!token) {
        setPhase({ name: 'welcome' });
        return;
      }
      await enrollPrimary(context.current!.api, token, context.current!.repos, context.current!.signal);
      await auth.current!.forget();
      await startClient();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ACCOUNT_HAS_DEVICES') {
        setPhase({ name: 'hasDevices' });
      } else {
        console.warn('Enrollment failed', error instanceof Error ? error.message : error);
        setPhase({ name: 'enrolling', failed: true });
      }
    }
  }, [startClient]);

  const boot = useCallback(async () => {
    setPhase({ name: 'loading' });
    try {
      info.current = await loadDeploymentInfo();
    } catch (error) {
      setPhase(error instanceof UpdateRequiredError ? { name: 'update' } : { name: 'unreachable' });
      return;
    }
    auth.current = new OrganizationAuth(info.current);
    try {
      context.current = await openLocalContext();
    } catch (error) {
      console.warn('Local storage unavailable', error instanceof Error ? error.name : error);
      setPhase({ name: 'storageLost' });
      return;
    }
    if (auth.current.isCallback()) {
      try {
        await auth.current.completeSignIn();
      } catch {
        setPhase({ name: 'welcome' }); // stale/cancelled IdP redirect: start over safely
        return;
      }
      await enroll();
      return;
    }
    try {
      await startClient();
    } catch (error) {
      // Unreadable keys or corrupted records (cleared site data, private mode, quota eviction).
      console.warn('Local encrypted state unusable', error instanceof Error ? error.name : error);
      setPhase({ name: 'storageLost' });
    }
  }, [enroll, startClient]);

  /** Deletes unusable local state and restarts onboarding (WEB-01: lost storage → re-link). */
  const resetLocalData = useCallback(async () => {
    leader.current.release();
    try {
      await context.current?.store.destroy();
    } catch {
      indexedDB.deleteDatabase('enclave');
    }
    window.location.replace('/');
  }, []);

  useEffect(() => {
    void boot();
  }, [boot]);

  const restart = () => {
    leader.current.release();
    window.location.replace('/');
  };

  return (
    <I18nProvider locale={locale}>
      {(() => {
        switch (phase.name) {
          case 'loading':
            return <LoadingScreen />;
          case 'unreachable':
            return <UnreachableScreen onRetry={() => void boot()} />;
          case 'update':
            return <UpdateRequiredScreen />;
          case 'welcome':
            return (
              <WelcomeScreen organization={info.current?.displayName ?? ''} onSignIn={() => void auth.current?.signIn({ fresh: true })} />
            );
          case 'enrolling':
            return <EnrollingScreen failed={phase.failed} onRetry={() => void enroll()} />;
          case 'hasDevices':
            return <HasDevicesScreen />;
          case 'otherTab':
            return <OtherTabScreen onUseHere={() => void startClient(true)} />;
          case 'revoked':
            return <RevokedScreen onContinue={restart} />;
          case 'storageLost':
            return <StorageLostScreen onReset={() => void resetLocalData()} />;
          case 'ready':
            return <MainLayout client={phase.client} onSignedOut={restart} />;
        }
      })()}
    </I18nProvider>
  );
}
