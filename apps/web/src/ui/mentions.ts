import { useEffect, useMemo, useState } from 'react';
import type { EnclaveClient } from '../core/client';
import { fold } from '../core/search';
import { useGroupRecord } from './hooks';

export interface MentionCandidate { accountId: string; label: string }

/** Group members other than this account, with display labels (for @ suggestions and rendering). */
export function useGroupMembers(client: EnclaveClient, conversationId: string): MentionCandidate[] {
  const record = useGroupRecord(client, conversationId.startsWith('g:') ? conversationId : null);
  const [members, setMembers] = useState<MentionCandidate[]>([]);
  useEffect(() => {
    let cancelled = false;
    // Connected addressed-only bots can be mentioned too: they get a 1:1 copy of that message only.
    const ids = [...(record?.members.map((m) => m.accountId).filter((id) => id !== client.accountId) ?? []), ...(record?.connectedBots ?? [])];
    void Promise.all(ids.map(async (accountId) => ({ accountId, label: await client.displayName(accountId) })))
      .then((list) => !cancelled && setMembers(list));
    return () => { cancelled = true; };
  }, [client, record]);
  return members;
}

/** The `@query` being typed at the caret, if any. */
export function activeMentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([^\s@]{0,32})$/u.exec(before);
  return match ? { start: before.length - match[2]!.length - 1, query: match[2]! } : null;
}

export function useMentionSuggestions(members: MentionCandidate[], query: string | null): MentionCandidate[] {
  return useMemo(() => {
    if (query === null) return [];
    const q = fold(query);
    return members.filter((m) => fold(m.label).split(/\s+/).some((w) => w.startsWith(q)) || fold(m.label).startsWith(q)).slice(0, 6);
  }, [members, query]);
}

/** Mention IDs whose `@Label` is still present in the final text (deleted mentions are dropped). */
export function mentionsIn(text: string, picked: MentionCandidate[]): string[] {
  return [...new Set(picked.filter((m) => text.includes(`@${m.label}`)).map((m) => m.accountId))];
}

/** Display labels of a message's mentioned accounts (for highlighting `@Label`). */
export function useMentionLabels(client: EnclaveClient, ids: string[] | undefined): string[] {
  const [labels, setLabels] = useState<string[]>([]);
  const key = ids?.join(',') ?? '';
  useEffect(() => {
    let cancelled = false;
    if (!key) { setLabels([]); return undefined; }
    void Promise.all(key.split(',').map((id) => client.displayName(id))).then((l) => !cancelled && setLabels(l));
    return () => { cancelled = true; };
  }, [client, key]);
  return labels;
}
