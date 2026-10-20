import { ChatLockProvider } from './chatLocks';
import { CallProvider } from './calls/CallProvider';
import { RecoveryScreen } from './screens/RecoveryScreen';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/errors';
import { OrganizationAuth } from '../auth/oidc';
import { loadDeploymentInfo, UpdateRequiredError, type DeploymentInfo } from '../config/deployment';
import { createClient, openLocalContext, type LocalContext } from '../core/bootstrap';
import type { EnclaveClient } from '../core/client';
import { enrollPrimary } from '../core/enrollment';
import { LeaderLock } from '../core/leader';
import type { Settings } from '../core/model';
import { browserLocale, I18nProvider, useI18n, type Locale } from './i18n/i18n';
import type { MessageKey } from './i18n/en';
import { LinkDeviceScreen } from './screens/LinkDeviceScreen';
import { MainLayout } from './screens/MainLayout';
import {
  EnrollingScreen,
  OtherTabScreen,
  RevokedScreen,
  SplashScreen,
  StorageLostScreen,
  UnreachableScreen,
  UpdateRequiredScreen,
  WelcomeScreen,
} from './screens/StatusScreens';
import { applyTheme } from './theme/tokens';

/** The splash stays at least this long so the encryption promise is readable. */
const MIN_SPLASH_MS = 1000;
/** Upper bound for waiting on the first mailbox drain before showing the app (offline etc.). */
const MAX_SYNC_WAIT_MS = 8000;

/**
 * Top-level state machine (UI.md §4, §10):
 *
 * splash → (unreachable | update) → welcome → [IdP redirect] → enrolling → (link | ready)
 * ready ⇄ otherTab (leader lock), ready → revoked (device unlinked), storageLost.
 */
type Phase =
  | { name: 'splash'; progress: number; stage: MessageKey }
  | { name: 'unreachable' }
  | { name: 'update' }
  | { name: 'welcome' }
  | { name: 'enrolling'; failed: boolean }
  | { name: 'link' }
  | { name: 'recovery' }
  | { name: 'otherTab' }
  | { name: 'revoked' }
  | { name: 'storageLost' }
  | { name: 'ready'; client: EnclaveClient };

export function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'splash', progress: 0.05, stage: 'splash.config' });
  const [locale, setLocale] = useState<Locale>(browserLocale());
  const info = useRef<DeploymentInfo | null>(null);
  const auth = useRef<OrganizationAuth | null>(null);
  const context = useRef<LocalContext | null>(null);
  const leader = useRef(new LeaderLock());
  const bootStarted = useRef(Date.now());
  const themePreference = useRef<Settings['theme']>('system');

  const progress = (value: number, stage: MessageKey) => setPhase({ name: 'splash', progress: value, stage });

  /** Shows `next` once the splash has been visible for {@link MIN_SPLASH_MS}. */
  const leaveSplash = useCallback(async (next: Phase) => {
    const remaining = MIN_SPLASH_MS - (Date.now() - bootStarted.current);
    if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
    setPhase(next);
  }, []);

  const applySettings = useCallback((settings: Settings) => {
    setLocale(settings.locale);
    themePreference.current = settings.theme;
    applyTheme(settings.theme);
    document.documentElement.lang = settings.locale;
    document.documentElement.dataset.motion = settings.animations ? 'on' : 'off';
  }, []);

  // Follow the OS appearance while the preference is "system".
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => themePreference.current === 'system' && applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  /** Starts the protocol client if this tab can become the leader, waiting for the first sync. */
  const startClient = useCallback(
    async (steal = false) => {
      progress(0.45, 'splash.keys');
      const client = await createClient(context.current!);
      if (!client) {
        await leaveSplash({ name: 'welcome' });
        return;
      }
      const isLeader = await leader.current.acquire(steal, () => {
        client.stop();
        setPhase({ name: 'otherTab' });
      });
      if (!isLeader) {
        await leaveSplash({ name: 'otherTab' });
        return;
      }
      applySettings(client.settings);
      client.on('settings', applySettings);
      client.on('revoked', () => setPhase({ name: 'revoked' }));
      progress(0.6, 'splash.connecting');
      const synced = new Promise<void>((resolve) => {
        const off = client.on('synced', () => {
          off();
          resolve();
        });
        client.on('connection', (state) => state === 'online' && progress(0.8, 'splash.messages'));
        setTimeout(resolve, MAX_SYNC_WAIT_MS);
      });
      await client.start();
      await synced;
      setPhase({ name: 'splash', progress: 1, stage: 'splash.messages' });
      await leaveSplash({ name: 'ready', client });
    },
    [applySettings, leaveSplash],
  );

  const enroll = useCallback(async () => {
    setPhase({ name: 'enrolling', failed: false });
    try {
      const token = await auth.current!.accessToken();
      if (!token) {
        setPhase({ name: 'welcome' });
        return;
      }
      await enrollPrimary(context.current!.api, token, context.current!.repos);
      await auth.current!.forget();
      bootStarted.current = Date.now();
      await startClient();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ACCOUNT_HAS_DEVICES') {
        setPhase({ name: 'link' });
      } else {
        console.warn('Enrollment failed', error instanceof Error ? error.message : error);
        setPhase({ name: 'enrolling', failed: true });
      }
    }
  }, [startClient]);

  const accessToken = useCallback(() => auth.current!.accessToken(), []);
  const signInAgain = useCallback(() => setPhase({ name: 'welcome' }), []);
  const onLinked = useCallback(() => {
    void auth.current?.forget();
    bootStarted.current = Date.now();
    void startClient();
  }, [startClient]);

  const boot = useCallback(async () => {
    bootStarted.current = Date.now();
    progress(0.1, 'splash.config');
    try {
      info.current = await loadDeploymentInfo();
    } catch (error) {
      await leaveSplash(error instanceof UpdateRequiredError ? { name: 'update' } : { name: 'unreachable' });
      return;
    }
    auth.current = new OrganizationAuth(info.current);
    progress(0.25, 'splash.storage');
    try {
      context.current = await openLocalContext();
    } catch (error) {
      console.warn('Local storage unavailable', error instanceof Error ? error.name : error);
      await leaveSplash({ name: 'storageLost' });
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
      await leaveSplash({ name: 'storageLost' });
    }
  }, [enroll, leaveSplash, startClient]);

  useEffect(() => {
    void boot();
  }, [boot]);

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

  const restart = () => {
    leader.current.release();
    window.location.replace('/');
  };

  return (
    <I18nProvider locale={locale}>
      {(() => {
        switch (phase.name) {
          case 'splash':
            return <SplashStage progress={phase.progress} stage={phase.stage} />;
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
          case 'recovery':
        return <RecoveryScreen api={context.current!.api} repos={context.current!.repos} accessToken={accessToken} onRecovered={onLinked} onBack={() => setPhase({ name: 'link' })} />;
      case 'link':
            return (
              <LinkDeviceScreen
                api={context.current!.api}
                repos={context.current!.repos}
                accessToken={accessToken}
                onLinked={onLinked}
                onSignInAgain={signInAgain} onRecover={() => setPhase({ name: 'recovery' })}
              />
            );
          case 'otherTab':
            return <OtherTabScreen onUseHere={() => void startClient(true)} />;
          case 'revoked':
            return <RevokedScreen onContinue={restart} />;
          case 'storageLost':
            return <StorageLostScreen onReset={() => void resetLocalData()} />;
          case 'ready':
            return <CallProvider client={phase.client}><ChatLockProvider client={phase.client}><MainLayout client={phase.client} onSignedOut={restart} /></ChatLockProvider></CallProvider>;
        }
      })()}
    </I18nProvider>
  );
}

/** Splash with a translated stage caption (needs the i18n context, hence a child component). */
function SplashStage({ progress, stage }: { progress: number; stage: MessageKey }) {
  const { t } = useI18n();
  return <SplashScreen progress={progress} stage={t(stage)} />;
}
