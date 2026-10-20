import { useEffect, useState } from 'react';
import type { ConnectionState } from '../api/socket';
import type { AccountDto } from '../api/types';
import type { GroupRecord } from '../core/groups';
import type { EnclaveClient } from '../core/client';
import type { ChatMessage, Conversation } from '../core/model';

/**
 * React bindings for {@link EnclaveClient} events. Components subscribe through these hooks only.
 */

/** Live conversation list. */
export function useConversations(client: EnclaveClient): Conversation[] {
  const [conversations, setConversations] = useState(() => client.conversations());
  useEffect(() => client.on('conversations', setConversations), [client]);
  return conversations;
}

/** Live messages of a conversation (newest page, ascending). */
export function useMessages(client: EnclaveClient, conversationId: string | null): ChatMessage[] {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return undefined;
    }
    let cancelled = false;
    const load = () =>
      void client.messages(conversationId).then((m) => {
        if (!cancelled) setMessages(m);
      });
    load();
    const off = client.on('messages', (id) => {
      if (id === conversationId) load();
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [client, conversationId]);
  return messages;
}

/** Socket connection state. */
export function useConnection(client: EnclaveClient): ConnectionState {
  const [state, setState] = useState<ConnectionState>(client.socket.state);
  useEffect(() => client.on('connection', setState), [client]);
  return state;
}

/** Whether the peer of a conversation is currently typing. */
export function useTyping(client: EnclaveClient, conversationId: string | null): boolean {
  const [until, setUntil] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    setUntil(0);
    return client.on('typing', (t) => {
      if (t.conversationId === conversationId) setUntil(t.until);
    });
  }, [client, conversationId]);
  useEffect(() => {
    if (until <= Date.now()) return undefined;
    const timer = setTimeout(() => tick((n) => n + 1), until - Date.now() + 50);
    return () => clearTimeout(timer);
  }, [until]);
  return until > Date.now();
}

/** Resolved display label (organization name or handle) of an account. */
export function useAccountLabel(client: EnclaveClient, accountId: string | undefined): string {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (!accountId) return undefined;
    let cancelled = false;
    void client.displayName(accountId).then((name) => !cancelled && setLabel(name));
    return () => {
      cancelled = true;
    };
  }, [client, accountId]);
  return label;
}

/** Directory entry of an account (handle, display name, phone). */
export function useAccount(client: EnclaveClient, accountId: string | undefined): AccountDto | undefined {
  const [account, setAccount] = useState<AccountDto>();
  useEffect(() => {
    if (!accountId) return undefined;
    let cancelled = false;
    void client.account(accountId).then((a) => !cancelled && setAccount(a));
    return () => {
      cancelled = true;
    };
  }, [client, accountId]);
  return account;
}

/** Local group record (name, roles), refreshed on membership changes. */
export function useGroupRecord(client: EnclaveClient, conversationId: string | null): GroupRecord | undefined {
  const [record, setRecord] = useState<GroupRecord>();
  useEffect(() => {
    if (!conversationId?.startsWith('g:')) {
      setRecord(undefined);
      return undefined;
    }
    let cancelled = false;
    const load = () => void client.groupRecord(conversationId).then((r) => !cancelled && setRecord(r));
    load();
    const off = client.on('groups', load);
    return () => {
      cancelled = true;
      off();
    };
  }, [client, conversationId]);
  return record;
}
