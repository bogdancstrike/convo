import { useCallback, useEffect, useState } from 'react';

/**
 * Hash-based navigation state, so a refresh (F5), deep link or browser Back restores exactly what
 * was on screen. Conversation IDs are opaque local identifiers (peer account ID or `g:<group>`);
 * they reveal nothing beyond what this device already stores.
 *
 * Routes: `#/` · `#/chat/<id>` · `#/chat/<id>/info` · `#/new` · `#/new-group` · `#/settings[/<page>]`
 */
export type SidePanel = 'chats' | 'new' | 'new-group' | 'settings' | 'calls' | 'channels' | 'new-channel';

export interface NavState {
  panel: SidePanel;
  chat: string | null;
  info: boolean;
  /** Settings sub-page (`#/settings/<page>`), null for the settings root. */
  page: string | null;
}

export function parseHash(hash: string): NavState {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case 'chat':
      return { panel: 'chats', chat: parts[1] ?? null, info: parts[2] === 'info', page: parts[2] === 'info' && ['media', 'links', 'docs'].includes(parts[3] ?? '') ? parts[3]! : null };
    case 'calls':
    case 'channels':
    case 'new-channel':
      return { panel: parts[0], chat: null, info: false, page: null };
    case 'new':
      return { panel: 'new', chat: null, info: false, page: null };
    case 'new-group':
      return { panel: 'new-group', chat: null, info: false, page: null };
    case 'settings':
      return { panel: 'settings', chat: null, info: false, page: parts[1] ?? null };
    default:
      return { panel: 'chats', chat: null, info: false, page: null };
  }
}

export function formatHash(state: NavState): string {
  if (state.chat) return `#/chat/${encodeURIComponent(state.chat)}${state.info ? `/info${state.page ? `/${state.page}` : ''}` : ''}`;
  if (state.panel === 'settings' && state.page) return `#/settings/${encodeURIComponent(state.page)}`;
  return state.panel === 'chats' ? '#/' : `#/${state.panel}`;
}

/** Navigation state synchronized with `location.hash` (push on navigate, follows Back/Forward). */
export function useNavigation(): [NavState, (next: Partial<NavState>, replace?: boolean) => void] {
  const [state, setState] = useState(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setState(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: Partial<NavState>, replace = false) => {
    setState((current) => {
      const merged: NavState = { ...current, ...next };
      if (merged.chat) merged.panel = merged.panel === 'settings' ? 'chats' : merged.panel;
      // Changing panel or chat leaves any settings sub-page unless one is given explicitly.
      const leavesPage = next.panel !== undefined || next.chat !== undefined;
      merged.page = next.page !== undefined ? next.page : leavesPage ? null : current.page;
      if (merged.panel !== 'settings' && !(merged.chat && merged.info)) merged.page = null;
      const hash = formatHash(merged);
      if (hash !== window.location.hash) {
        if (replace) window.history.replaceState(null, '', hash);
        else window.history.pushState(null, '', hash);
      }
      return merged;
    });
  }, []);

  return [state, navigate];
}
