import { createContext, useContext, useEffect, useState } from 'react';
import { api, errorText, type AlertSummary } from '../api';

interface Inbox { summary: AlertSummary | null; error: string | null; refresh: () => void; desktop: boolean; setDesktop: (enabled: boolean) => Promise<void> }
export const SecurityAlertContext = createContext<Inbox>({ summary: null, error: null, refresh: () => {}, desktop: false, setDesktop: async () => {} });
export const useAlertInbox = () => useContext(SecurityAlertContext);

export function useSecurityAlertInbox(enabled: boolean, actor: string): Inbox {
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [desktop, setDesktopState] = useState(false);
  const key = `convo-admin-alert-notifications:${actor}`;
  useEffect(() => { try { setDesktopState(!!JSON.parse(localStorage.getItem(key) || 'null')?.since && 'Notification' in window && Notification.permission === 'granted'); } catch { setDesktopState(false); } }, [key]);
  useEffect(() => {
    if (!enabled) { setSummary(null); setError(null); return; }
    let active = true; let sequence = 0;
    const refresh = () => {
      const current = ++sequence;
      void api.alertSummary().then((data) => {
        if (!active || current !== sequence) return;
        setSummary(data); setError(null);
        if (desktop && 'Notification' in window && Notification.permission === 'granted') {
          try {
            const saved = JSON.parse(localStorage.getItem(key) || 'null') as { since: string; seen: string[] } | null;
            if (!saved) return;
            const seen = new Set(saved.seen);
            for (const alert of [...data.recent].reverse()) {
              if (Date.parse(alert.createdAt) > Date.parse(saved.since) && !seen.has(alert.id)) {
                const notification = new Notification(`${alert.severity.toUpperCase()} · ${alert.title}`, { body: alert.subjectName, tag: `convo-security-${alert.id}` });
                notification.onclick = () => { window.focus(); window.location.hash = `/alerts/${alert.id}`; notification.close(); };
                seen.add(alert.id);
              }
            }
            localStorage.setItem(key, JSON.stringify({ ...saved, seen: [...seen].slice(-500) }));
          } catch { /* Inbox remains usable when browser notifications/storage are unavailable. */ }
        }
      }).catch((e) => { if (active && current === sequence) setError(errorText(e)); });
    };
    refresh(); const timer = setInterval(refresh, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [enabled, version, desktop, key]);
  const setDesktop = async (value: boolean) => {
    if (value) {
      if (!('Notification' in window)) throw new Error('This browser does not support desktop notifications.');
      if (await Notification.requestPermission() !== 'granted') throw new Error('Allow notifications in your browser settings to enable desktop alerts.');
      try { localStorage.setItem(key, JSON.stringify({ since: new Date().toISOString(), seen: [] })); } catch { throw new Error('Browser storage is unavailable.'); }
    } else { try { localStorage.removeItem(key); } catch { /* private mode */ } }
    setDesktopState(value);
  };
  return { summary, error, refresh: () => setVersion((v) => v + 1), desktop, setDesktop };
}
