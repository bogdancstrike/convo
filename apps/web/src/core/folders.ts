import type { Conversation } from './model';

/**
 * Private chat folders (specs §30.4): named views over the chat list with explicit chats plus
 * optional type and unread filters. They are own-device preferences: stored encrypted locally and
 * synced only to this account's devices (higher mutation counter wins, AC-SYNC-01).
 */
export type FolderType = 'direct' | 'group' | 'channel';
export interface ChatFolder {
  id: string;
  name: string;
  /** Chats always shown in this folder. */
  chats: string[];
  /** Also show every chat of these kinds. */
  types: FolderType[];
  /** Only chats with unread messages. */
  unreadOnly: boolean;
}
export interface FolderState { folders: ChatFolder[]; mutation: number }

export const MAX_FOLDERS = 10;
export const MAX_FOLDER_NAME = 24;

/** The kind used for folder type filters (channels are admin-only groups). */
export function folderType(c: Conversation): FolderType | undefined {
  if (c.kind === 'direct') return 'direct';
  if (c.kind === 'group') return c.adminOnly ? 'channel' : 'group';
  return undefined;
}

export function folderMatches(folder: ChatFolder, c: Conversation): boolean {
  const type = folderType(c);
  const included = folder.chats.includes(c.id) || (!!type && folder.types.includes(type));
  return included && (!folder.unreadOnly || (c.unread ?? 0) > 0);
}

/** Validates and normalizes folders from the UI or another own device. */
export function sanitizeFolders(value: unknown): ChatFolder[] {
  if (!Array.isArray(value)) return [];
  const out: ChatFolder[] = [];
  for (const f of value.slice(0, MAX_FOLDERS)) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Record<string, unknown>;
    const name = typeof r.name === 'string' ? r.name.trim().slice(0, MAX_FOLDER_NAME) : '';
    if (!name || typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(r.id)) continue;
    const chats = Array.isArray(r.chats) ? [...new Set(r.chats.filter((x): x is string => typeof x === 'string' && x.length <= 80))].slice(0, 500) : [];
    const types = Array.isArray(r.types) ? [...new Set(r.types.filter((x): x is FolderType => x === 'direct' || x === 'group' || x === 'channel'))] : [];
    out.push({ id: r.id, name, chats, types, unreadOnly: r.unreadOnly === true });
  }
  return out;
}
