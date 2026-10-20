import { useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import { isInlineImage } from '../../core/attachments';
import type { Conversation, Settings } from '../../core/model';
import { linksIn } from '../../lib/links';
import { AttachmentView } from '../components/AttachmentView';
import { FormattedText } from '../components/FormattedText';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Popover';
import { useMessages, useSettings } from '../hooks';
import { useI18n } from '../i18n/i18n';
import { conversationMenu } from './conversationMenu';
import { useChatLocks } from '../chatLocks';
import { Segmented, Switch } from '../components/Controls';
import { DISAPPEARING_TIMERS } from '../../core/disappearing';
import { groupIdOf } from '../../core/model';
import { timerLabel } from './TimerNotice';
import { useEffect } from 'react';

export function SharedPreview({ client, conversation, onOpen }: { client: EnclaveClient; conversation: Conversation; onOpen: () => void }) {
  const { t } = useI18n(); const messages = useMessages(client, conversation.id, Number.MAX_SAFE_INTEGER).filter((m) => !m.deleted && !m.unsupported && !m.undecryptable);
  const photos = messages.flatMap((m) => m.attachments ?? []).filter(isInlineImage).slice(-4).reverse();
  const count = messages.reduce((n, m) => n + (m.attachments?.length ?? 0) + linksIn(m.body ?? '').length, 0);
  return <section className="drawer-section"><button className="settings-row" onClick={onOpen} data-testid="open-shared-content"><Icon name="image" /><span className="settings-row-text">{t('shared.title')}</span><span className="muted-text">{count}</span><Icon name="next" size={18} /></button>
    {photos.length > 0 && <div className="shared-preview-strip">{photos.map((photo) => <div key={photo.attachmentId}><AttachmentView client={client} pointer={photo} /></div>)}</div>}
  </section>;
}

export function ConversationActions({ client, conversation, onClose, onPage }: { client: EnclaveClient; conversation: Conversation; onClose: () => void; onPage: (page: string) => void }) {
  const { t } = useI18n(); const [error, setError] = useState(false);
  const actions = conversationMenu(client, conversation, t, () => {}, () => {}, onClose).filter((item) => !['info', 'search', 'close'].includes(item.icon ?? ''));
  const locks = useChatLocks(); const locked = locks.locked(conversation.id);
  const exportChat = async () => {
    if (!window.confirm(t('info.exportConfirm'))) return;
    setError(false);
    try {
      const messages = await client.messages(conversation.id, Number.MAX_SAFE_INTEGER);
      const lines = await Promise.all(messages.map(async (m) => `[${new Date(m.sentAt).toISOString()}] ${await client.displayName(m.authorId)}: ${m.deleted ? t('thread.deleted') : [m.body, ...(m.attachments ?? []).map((a) => `[${a.fileName ?? a.contentType}]`)].filter(Boolean).join(' ')}`));
      const url = URL.createObjectURL(new Blob([`${conversation.title}\n\n${lines.join('\n')}\n`], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a'); link.href = url; link.download = `convo-chat-${new Date().toISOString().slice(0, 10)}.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setError(true); }
  };
  return <><section className="drawer-section">
    <button className="settings-row" onClick={() => onPage('starred')} data-testid="open-starred"><Icon name="pin" /><span className="settings-row-text">{t('info.starred')}</span><Icon name="next" size={18} /></button>
    <button className="settings-row" onClick={() => onPage('appearance')} data-testid="open-chat-appearance"><Icon name="palette" /><span className="settings-row-text">{t('info.appearance')}</span><Icon name="next" size={18} /></button>
    {actions.map((item) => item.children ? <Menu key={item.label} label={item.label} items={item.children} trigger={({ open, toggle }) => <button className="settings-row" onClick={toggle} aria-expanded={open}><Icon name={item.icon!} /><span className="settings-row-text">{item.label}</span><Icon name="chevronDown" size={18} /></button>} /> :
      <button key={item.label} className={`settings-row${item.danger ? ' danger' : ''}`} onClick={item.onSelect}>{item.icon && <Icon name={item.icon} />}<span className="settings-row-text">{item.label}</span></button>)}
    <DisappearingSetting client={client} conversation={conversation} />
    {(locked || locks.passkey === true) && <div className="settings-row-switch"><Switch checked={locked} onChange={() => void locks.toggle(conversation.id)}
      label={t('lock.title')} description={t('lock.help')} testId="info-lock" /></div>}
    {locks.error && <p role="alert" className="failed">{locks.error}</p>}
    <button className="settings-row" onClick={() => void exportChat()} data-testid="export-chat"><Icon name="file" /><span className="settings-row-text">{t('info.export')}</span></button>
    {error && <p role="alert">{t('info.exportFailed')}</p>}
  </section></>;
}

export function ConversationSubpage({ client, conversation, page, onBack }: { client: EnclaveClient; conversation: Conversation; page: 'starred' | 'appearance'; onBack: () => void }) {
  const { t, date, time } = useI18n(); const messages = useMessages(client, conversation.id, Number.MAX_SAFE_INTEGER);
  const settings = useSettings(client); const selected = conversation.wallpaper ?? settings.wallpaper;
  return <aside className="drawer" data-testid={`chat-${page}`}><header className="panel-header sub"><button className="icon-btn" onClick={onBack} aria-label={t('thread.back')}><Icon name="back" /></button><h2>{t(page === 'starred' ? 'info.starred' : 'info.appearance')}</h2></header>
    <div className="panel-body" style={{ padding: 20 }}>{page === 'starred' ? <>
      {!messages.some((m) => m.starred && !m.deleted) && <p className="empty">{t('info.noStarred')}</p>}
      {messages.filter((m) => m.starred && !m.deleted).map((m) => <article className="starred-item" key={`${m.authorId}/${m.id}`}><span className="muted-text">{date(m.sentAt)} · {time(m.sentAt)}</span><div>{m.body && <FormattedText text={m.body} />}{m.attachments?.map((a) => <AttachmentView key={a.attachmentId} client={client} pointer={a} authorId={m.authorId} />)}</div><button className="btn btn-ghost" onClick={() => void client.setStarred(m, false)}>{t('msg.unstar')}</button></article>)}
    </> : <><p className="muted-text">{t('info.appearanceBody')}</p><div className="wallpaper-options">{(['dots', 'plain', 'ocean', 'botanical'] as Settings['wallpaper'][]).map((wallpaper) => <button className="wallpaper-choice" key={wallpaper} aria-pressed={selected === wallpaper} onClick={() => void client.updateConversation(conversation.id, { wallpaper })}><span className="wallpaper-preview" data-wallpaper={wallpaper}><span className="preview-bubble">{t('settings.wallpaperPreview')}</span></span><span>{t(`wallpaper.${wallpaper}`)}</span></button>)}</div><button className="btn" onClick={() => void client.updateConversation(conversation.id, { wallpaper: undefined })}>{t('info.resetAppearance')}</button></>}</div>
  </aside>;
}

/** Disappearing-message timer for every kind of chat; group/channel changes need an admin role. */
function DisappearingSetting({ client, conversation }: { client: EnclaveClient; conversation: Conversation }) {
  const { t } = useI18n();
  const [canChange, setCanChange] = useState(!groupIdOf(conversation.id));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const groupId = groupIdOf(conversation.id);
    if (!groupId) { setCanChange(!conversation.left); return; }
    void client.groupRecord(conversation.id).then((record) => {
      const role = record?.members.find((m) => m.accountId === client.accountId)?.role;
      setCanChange(!conversation.left && (role === 'owner' || role === 'admin'));
    });
  }, [client, conversation.id, conversation.left]);
  return (
    <div className="settings-row-switch disappearing" data-testid="disappearing-setting">
      <strong><Icon name="clock" size={16} /> {t('timer.title')}</strong>
      <p className="muted-text">{t('timer.help')}</p>
      <Segmented label={t('timer.title')} value={String(conversation.expireSeconds ?? 0)} testId="disappearing-timer"
        onChange={(v) => { if (!canChange) return; setFailed(false); void client.setDisappearing(conversation.id, Number(v)).catch(() => setFailed(true)); }}
        options={DISAPPEARING_TIMERS.map((s) => ({ value: String(s), label: timerLabel(s, t) }))} />
      {!canChange && <p className="muted-text">{t('timer.adminsOnly')}</p>}
      {failed && <p role="alert" className="failed">{t('timer.adminsOnly')}</p>}
    </div>
  );
}
