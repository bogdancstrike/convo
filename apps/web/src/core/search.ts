import type { ChatMessage } from './model';

/** Romanian-insensitive matching; plaintext stays on the device. */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

export function matchesMessage(message: ChatMessage, query: string): boolean {
  return !message.deleted && !message.undecryptable && !message.unsupported &&
    [message.body, ...(message.attachments?.map((a) => a.fileName) ?? [])].some((text) => text && fold(text).includes(query));
}
