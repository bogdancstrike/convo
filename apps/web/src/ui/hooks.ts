import { useEffect, useState } from 'react';
import type { ConnectionState } from '../api/socket';
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
