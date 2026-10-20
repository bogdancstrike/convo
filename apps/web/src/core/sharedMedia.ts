import { isAudio, isInlineImage, isVideo } from './attachments';
import type { ChatMessage, Conversation } from './model';
import type { AttachmentPointer } from '../crypto/content';
import { linksIn } from '../lib/links';
import { fold } from './search';
export interface SharedEntry { key: string; message: ChatMessage; conversation: Conversation; attachment?: AttachmentPointer; link?: string; size: number }
export type SharedFilter = { tab: 'media' | 'docs' | 'links'; query: string; sender: 'all' | 'you' | 'others'; sort: 'newest' | 'oldest' | 'largest' };
export function sharedEntries(messages: ChatMessage[], conversations: Conversation[]): SharedEntry[] {
  const chats = new Map(conversations.map((c) => [c.id, c])); const entries: SharedEntry[] = [];
  for (const message of messages) {
    const conversation = chats.get(message.conversationId); if (!conversation || message.deleted || message.undecryptable || message.unsupported) continue;
    const prefix = `${message.conversationId}/${message.authorId}/${message.id}`;
    for (const attachment of message.attachments ?? []) entries.push({ key: `${prefix}/a/${attachment.attachmentId}`, message, conversation, attachment, size: attachment.size });
    for (const link of linksIn(message.body ?? '')) entries.push({ key: `${prefix}/l/${link}`, message, conversation, link, size: new TextEncoder().encode(link).length });
  }
  return entries;
}
export function filterShared(entries: SharedEntry[], filter: SharedFilter, self: string): SharedEntry[] {
  const query = fold(filter.query);
  return entries.filter((entry) => {
    const media = entry.attachment && (isInlineImage(entry.attachment) || isVideo(entry.attachment) || isAudio(entry.attachment));
    return (filter.tab === 'links' ? Boolean(entry.link) : filter.tab === 'media' ? media : entry.attachment && !media) &&
      (filter.sender === 'all' || (entry.message.authorId === self) === (filter.sender === 'you')) &&
      (!query || fold([entry.message.body, entry.attachment?.fileName, entry.link, entry.conversation.title].filter(Boolean).join(' ')).includes(query));
  }).sort((a, b) => (filter.sort === 'largest' ? b.size - a.size : 0) || (filter.sort === 'oldest' ? a.message.sentAt - b.message.sentAt : b.message.sentAt - a.message.sentAt) || a.key.localeCompare(b.key));
}
export function selectedMessages(entries: SharedEntry[]): ChatMessage[] {
  const grouped = new Map<string, SharedEntry[]>();
  for (const entry of entries) { const key = `${entry.message.conversationId}/${entry.message.authorId}/${entry.message.id}`; grouped.set(key, [...(grouped.get(key) ?? []), entry]); }
  return [...grouped.values()].map((items) => ({ ...items[0]!.message,
    body: items.some((item) => item.attachment) ? items[0]!.message.body : items.map((item) => item.link).join('\n'),
    attachments: items.flatMap((item) => item.attachment ? [item.attachment] : []),
  }));
}
/** Archive paths never contain user-controlled directory segments. */
export function downloadName(name: string, index: number): string { return `${String(index + 1).padStart(3, '0')}-${name.replace(/[\\/\u0000-\u001f:]/g, '_').replace(/^\.+/, '_').slice(0, 180) || 'file'}`; }
