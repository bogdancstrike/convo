import { useCallback, useEffect, useMemo, useState } from 'react';

/** Shareable views are browser history entries; Back/Forward restores the same filters and scope. */
export function useViewState<T extends Record<string, string>>(defaults: T) {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const changed = () => setHash(window.location.hash);
    window.addEventListener('hashchange', changed);
    window.addEventListener('popstate', changed);
    return () => { window.removeEventListener('hashchange', changed); window.removeEventListener('popstate', changed); };
  }, []);
  const view = useMemo(() => {
    const params = new URLSearchParams(hash.split('?')[1] ?? '');
    return Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, params.get(key) ?? value])) as T;
  }, [hash, defaults]);
  const update = useCallback((patch: Partial<T>, replace = false) => {
    const [path = '', query = ''] = window.location.hash.split('?');
    const params = new URLSearchParams(query);
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '' || value === defaults[key]) params.delete(key);
      else params.set(key, value);
    }
    const next = `${path}${params.size ? `?${params}` : ''}`;
    if (next === window.location.hash) return;
    if (replace) {
      window.history.replaceState(window.history.state, '', next);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else window.location.hash = next;
  }, [defaults]);
  const link = (route: string) => `${route}${window.location.hash.includes('?') ? `?${window.location.hash.split('?')[1]}` : ''}`;
  return { view, update, link };
}
