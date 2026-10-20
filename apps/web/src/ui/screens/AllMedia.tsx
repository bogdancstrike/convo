import { zipSync } from 'fflate';
import { useEffect, useMemo, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { ChatMessage } from '../../core/model';
import { downloadName, filterShared, selectedMessages, sharedEntries, type SharedEntry, type SharedFilter } from '../../core/sharedMedia';
import { AttachmentView, formatBytes } from '../components/AttachmentView';
import { Avatar } from '../components/Avatar';
import { Dialog } from '../components/Dialog';
import { ExternalLink } from '../components/ExternalLink';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Popover';
import { useAccountLabel, useConversations } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { ForwardDialog } from './ForwardDialog';

export function AllMedia({ client, onClose }: { client: EnclaveClient; onClose: () => void }) {
  const { t, locale } = useI18n(); const conversations = useConversations(client);
  const [messages, setMessages] = useState<ChatMessage[]>([]); const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SharedFilter>({ tab: 'media', query: '', sender: 'all', sort: 'newest' });
  const [selecting, setSelecting] = useState(false); const [selected, setSelected] = useState(new Set<string>());
  const [limit, setLimit] = useState(60); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [forward, setForward] = useState<ChatMessage[] | null>(null);
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    const load = () => { clearTimeout(timer); timer = setTimeout(() => {
      void Promise.all(conversations.map((c) => client.messages(c.id, Number.MAX_SAFE_INTEGER))).then((items) => { if (!stopped) { setMessages(items.flat()); setLoading(false); } }).catch(() => { if (!stopped) { setError(t('gallery.failed')); setLoading(false); } });
    }, 100); };
    load(); const off = client.on('messages', load);
    return () => { stopped = true; clearTimeout(timer); off(); };
  }, [client, conversations, t]);
  const entries = useMemo(() => filterShared(sharedEntries(messages, conversations), filter, client.accountId), [messages, conversations, filter, client.accountId]);
  useEffect(() => { setLimit(60); setSelected((current) => new Set([...current].filter((key) => entries.some((entry) => entry.key === key)))); }, [entries]);
  const picked = entries.filter((entry) => selected.has(entry.key)); const forwarded = selectedMessages(picked);
  const unique = [...new Map(picked.map((entry) => [`${entry.message.conversationId}/${entry.message.authorId}/${entry.message.id}`, entry.message])).values()];
  const bytes = picked.reduce((n, item) => n + item.size, 0);
  const toggle = (key: string) => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else if (next.size < 100) next.add(key); else setError(t('gallery.limit')); return next; });
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await work(); } catch { setError(t('gallery.failed')); } finally { setBusy(false); } };
  const save = () => void run(async () => {
    if (bytes > 200 * 1024 * 1024) { setError(t('gallery.limit')); return; }
    const files: Record<string, Uint8Array<ArrayBuffer>> = {};
    for (let i = 0; i < picked.length; i++) { const item = picked[i]!;
      files[downloadName(item.attachment?.fileName ?? 'link.txt', i)] = item.attachment ? new Uint8Array(await (await client.downloadAttachment(item.attachment)).arrayBuffer()) : new TextEncoder().encode(item.link!);
    }
    const blob = new Blob([zipSync(files, { level: 0 }) as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `convo-media-${new Date().toISOString().slice(0, 10)}.zip`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const tabs = ['media', 'docs', 'links'] as const;
  return <Dialog className="all-media-dialog" labelledBy="all-media-title" onClose={onClose}>
    <div className="all-media-layout" data-testid="all-media">
      <header className="all-media-header"><div><h2 id="all-media-title">{t('gallery.title')}</h2><span className="muted-text">{t('gallery.allChats')}</span></div>
        <div className="shared-tabs" role="tablist" aria-label={t('gallery.title')}>{tabs.map((tab) => <button key={tab} role="tab" aria-selected={filter.tab === tab} onClick={() => setFilter({ ...filter, tab })} data-testid={`gallery-${tab}`}>{t(`shared.${tab}`)}</button>)}</div>
        <Menu label={t('gallery.filters')} items={[
          ...(['all', 'you', 'others'] as const).map((sender) => ({ label: `${filter.sender === sender ? '✓ ' : ''}${t(`gallery.sender.${sender}`)}`, onSelect: () => setFilter({ ...filter, sender }) })),
          ...(['newest', 'oldest', 'largest'] as const).map((sort) => ({ label: `${filter.sort === sort ? '✓ ' : ''}${t(`gallery.sort.${sort}`)}`, onSelect: () => setFilter({ ...filter, sort }) })),
        ]} trigger={({ open, toggle: openFilters }) => <button className="icon-btn" onClick={openFilters} aria-expanded={open} aria-label={t('gallery.filters')} data-testid="gallery-filters"><Icon name="filter" /></button>} />
        <button className="icon-btn" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }} aria-label={t(selecting ? 'thread.cancel' : 'gallery.select')} data-testid="gallery-select"><Icon name="checks" /></button>
        <button className="icon-btn" onClick={onClose} aria-label={t('media.close')} data-testid="close-all-media"><Icon name="close" /></button>
      </header>
      <div className="all-media-tools"><label className="search"><Icon name="search" size={18} /><input type="search" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} placeholder={t('gallery.search')} aria-label={t('gallery.search')} data-testid="gallery-search" /></label>
        <span className="muted-text">{t(`gallery.sender.${filter.sender}`)} · {t(`gallery.sort.${filter.sort}`)}</span>
        {selecting && <button className="btn btn-ghost" onClick={() => setSelected(new Set(entries.slice(0, 100).map((entry) => entry.key)))}>{t('gallery.selectAll')}</button>}
      </div>
      <div className="all-media-body">
        {loading ? <p className="empty" role="status">{t('attachment.loading')}</p> : !entries.length ? <p className="empty">{t(`shared.empty.${filter.tab}`)}</p> :
          <div className={filter.tab === 'media' ? 'all-media-grid' : 'all-media-docs'}>{entries.slice(0, limit).map((entry) => <article className={`gallery-item${selected.has(entry.key) ? ' selected' : ''}`} key={entry.key} data-testid="gallery-item" onClickCapture={(e) => {
            if (!selecting || (e.target as Element).closest('label')) return; e.preventDefault(); e.stopPropagation(); toggle(entry.key);
          }}>
            {selecting && <label className="gallery-checkbox"><input type="checkbox" checked={selected.has(entry.key)} onChange={() => toggle(entry.key)} aria-label={t('gallery.selectItem', { name: entry.attachment?.fileName ?? entry.link ?? '' })} /></label>}
            {entry.attachment ? <AttachmentView client={client} pointer={entry.attachment} authorId={entry.message.authorId} /> : <ExternalLink href={entry.link!} className="shared-link"><Icon name="next" /><span>{entry.link}</span></ExternalLink>}
            <EntryLabel client={client} entry={entry} />
          </article>)}</div>}
        {entries.length > limit && <button className="btn" onClick={() => setLimit((n) => n + 60)}>{t('shared.more')}</button>}
      </div>
      {error && <p role="alert" className="failed gallery-feedback">{error}</p>}{notice && <p role="status" className="gallery-feedback">{notice}</p>}
      {selecting && <footer className="all-media-actions"><span>{t('gallery.selected', { count: picked.length })} · {formatBytes(bytes, locale)}</span><span className="spacer" />
        <button className="icon-btn" disabled={busy || !picked.length} onClick={save} aria-label={t('gallery.download')} title={t('gallery.download')}><Icon name="download" /></button>
        <button className="icon-btn" disabled={busy || !picked.length} onClick={() => setForward(forwarded)} aria-label={t('gallery.forward')} title={t('gallery.forward')}><Icon name="send" /></button>
        <button className="icon-btn" disabled={busy || !picked.length} onClick={() => void run(async () => { const value = !unique.every((m) => m.starred); for (const m of unique) await client.setStarred(m, value); setNotice(t(value ? 'gallery.starred' : 'gallery.unstarred')); })} aria-label={t('gallery.star')} title={t('gallery.star')}><Icon name="pin" /></button>
        <button className="icon-btn danger" disabled={busy || !picked.length} onClick={() => { if (window.confirm(t('gallery.confirmDelete', { count: unique.length }))) void run(async () => { for (const m of unique) await client.deleteLocally(m); setSelected(new Set()); setNotice(t('gallery.deleted')); }); }} aria-label={t('gallery.delete')} title={t('gallery.delete')}><Icon name="trash" /></button>
      </footer>}
    </div>
    {forward && <ForwardDialog client={client} messages={forward} onClose={() => setForward(null)} onDone={() => { setForward(null); setNotice(t('gallery.forwarded')); }} />}
  </Dialog>;
}
function EntryLabel({ client, entry }: { client: EnclaveClient; entry: SharedEntry }) {
  const author = useAccountLabel(client, entry.message.authorId); const { date } = useI18n();
  return <div className="gallery-entry-label"><Avatar id={entry.message.authorId} name={author || '?'} size={22} /><div><strong>{author}</strong><span>{entry.conversation.title} · {date(entry.message.sentAt)}</span>{entry.message.body && <span className="gallery-caption">{entry.message.body}</span>}</div></div>;
}
