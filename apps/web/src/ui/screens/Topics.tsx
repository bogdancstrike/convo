import { useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { Conversation } from '../../core/model';
import { MAX_TOPIC_NAME, type Topic } from '../../core/topics';
import { Dialog } from '../components/Dialog';
import { Icon } from '../components/Icon';
import { useI18n } from '../i18n/i18n';

/**
 * Topic tabs of a group (specs §30.4): "General" plus the group's topics; owners/admins add topics
 * and (right-click) rename, close or reopen them. Closed topics stay readable.
 */
export function TopicBar({ client, conversation, selected, onSelect, isAdmin }: { client: EnclaveClient; conversation: Conversation; selected: string | null; onSelect: (topic: string | null) => void; isAdmin: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<Topic | 'new' | null>(null);
  const topics = conversation.topics ?? [];
  if (!topics.length && !isAdmin) return null;
  return (
    <div className="chips topic-bar" role="tablist" aria-label={t('topics.title')} data-testid="topic-bar">
      <button className="chip" role="tab" aria-selected={selected === null} aria-pressed={selected === null} onClick={() => onSelect(null)} data-testid="topic-general">{t('topics.general')}</button>
      {topics.map((topic) => (
        <button key={topic.id} className={`chip${topic.closed ? ' closed' : ''}`} role="tab" aria-selected={selected === topic.id} aria-pressed={selected === topic.id}
          onClick={() => onSelect(topic.id)} onContextMenu={(e) => { if (!isAdmin) return; e.preventDefault(); setEditing(topic); }} data-testid={`topic-${topic.name}`}>
          {topic.closed && <Icon name="lock" size={12} />} # {topic.name}
        </button>
      ))}
      {isAdmin && <button className="chip" onClick={() => setEditing('new')} aria-label={t('topics.create')} title={t('topics.create')} data-testid="topic-add"><Icon name="plus" size={14} /></button>}
      {editing && <TopicEditor client={client} conversationId={conversation.id} topic={editing === 'new' ? undefined : editing}
        onSaved={(id) => { if (id) onSelect(id); }} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TopicEditor({ client, conversationId, topic, onSaved, onClose }: { client: EnclaveClient; conversationId: string; topic?: Topic; onSaved: (id?: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(topic?.name ?? '');
  const [error, setError] = useState(false);
  const run = async (task: () => Promise<string | undefined>) => {
    try { onSaved(await task()); onClose(); } catch { setError(true); }
  };
  return (
    <Dialog labelledBy="topic-title" onClose={onClose}>
      <div data-testid="topic-editor">
        <h2 id="topic-title">{t(topic ? 'topics.edit' : 'topics.create')}</h2>
        <label className="field"><span>{t('topics.name')}</span><input value={name} maxLength={MAX_TOPIC_NAME} onChange={(e) => setName(e.target.value)} data-testid="topic-name" autoFocus /></label>
        <p className="muted-text">{t('topics.hint')}</p>
        {error && <p role="alert" className="failed">{t('topics.failed')}</p>}
        <div className="dialog-actions">
          {topic && <button className="btn btn-ghost" onClick={() => void run(async () => { await client.updateTopic(conversationId, topic.id, { closed: !topic.closed }); return undefined; })} data-testid="topic-toggle-closed">{t(topic.closed ? 'topics.reopen' : 'topics.close')}</button>}
          <button className="btn" onClick={onClose}>{t('thread.cancel')}</button>
          <button className="btn btn-primary" disabled={!name.trim()} data-testid="topic-save"
            onClick={() => void run(async () => (topic ? (await client.updateTopic(conversationId, topic.id, { name }), undefined) : (await client.createTopic(conversationId, name)).id))}>{t('event.save')}</button>
        </div>
      </div>
    </Dialog>
  );
}
