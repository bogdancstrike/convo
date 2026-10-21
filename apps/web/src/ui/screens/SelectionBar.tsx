import { useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { ChatMessage } from '../../core/model';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

/** Upper bound for one batch action (specs FEAT-02: bounded batch copy/forward/delete). */
export const MAX_SELECTION = 100;

/**
 * Toolbar for selected messages: copy as text, forward to one chat, star/unstar and delete for
 * me (with confirmation). Partial failures are reported with the count that succeeded.
 */
export function SelectionBar({ client, messages, onCancel, onForward }: { client: EnclaveClient; messages: ChatMessage[]; onCancel: () => void; onForward: () => void }) {
  const { t, time } = useI18n();
  const [status, setStatus] = useState<string | null>(null);
  const none = messages.length === 0;
  const copy = async () => {
    const lines = await Promise.all(messages.map(async (m) => `[${time(m.sentAt)}] ${await client.displayName(m.authorId)}: ${m.body ?? (m.attachments ?? []).map((a) => a.fileName ?? a.contentType).join(', ')}`));
    try { await navigator.clipboard.writeText(lines.join('\n')); setStatus(t('select.copied', { count: messages.length })); } catch { setStatus(t('select.failed')); }
  };
  const star = async () => {
    const value = !messages.every((m) => m.starred);
    for (const m of messages) await client.setStarred(m, value);
    onCancel();
  };
  const remove = async () => {
    if (!window.confirm(t('select.confirmDelete', { count: messages.length }))) return;
    let done = 0;
    for (const m of messages) { try { await client.deleteLocally(m); done++; } catch { /* reported below */ } }
    if (done === messages.length) onCancel(); else setStatus(t('select.partial', { done, total: messages.length }));
  };
  return (
    <div className="selection-bar" role="toolbar" aria-label={t('select.toolbar')} data-testid="selection-bar">
      <button className="icon-btn" onClick={onCancel} aria-label={t('thread.cancel')} data-testid="select-cancel"><Icon name="close" /></button>
      <strong data-testid="select-count">{t('select.count', { count: messages.length })}</strong>
      {status && <span className="muted-text" role="status">{status}</span>}
      <span className="spacer" />
      <button className="icon-btn" disabled={none} onClick={() => void copy()} aria-label={t('thread.copy')} data-testid="select-copy"><Icon name="copy" /></button>
      <button className="icon-btn" disabled={none} onClick={() => void star()} aria-label={t('msg.star')} data-testid="select-star"><Icon name="pin" /></button>
      <button className="icon-btn" disabled={none} onClick={onForward} aria-label={t('msg.forward')} data-testid="select-forward"><Icon name="next" /></button>
      <button className="icon-btn danger" disabled={none} onClick={() => void remove()} aria-label={t('msg.delete')} data-testid="select-delete"><Icon name="trash" /></button>
    </div>
  );
}
