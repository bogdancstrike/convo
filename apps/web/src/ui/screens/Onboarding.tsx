import { useEffect, useState } from 'react';
import type { CommunityGroup, CommunityView, EnclaveClient, OnboardingView } from '../../core/client';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

/** Standard checklist items (stable IDs so progress survives edits). */
export const PRESET_ITEMS: { id: string; label: MessageKey }[] = [
  { id: 'read-description', label: 'onboarding.item.readDescription' },
  { id: 'ack-rules', label: 'onboarding.item.ackRules' },
  { id: 'choose-groups', label: 'onboarding.item.chooseGroups' },
  { id: 'notifications', label: 'onboarding.item.notifications' },
];

function itemDone(view: OnboardingView, id: string): boolean {
  // Reviewers receive acknowledgements; they are not asked to send one.
  if (id === 'ack-rules') return view.reviewer || (!!view.pkg.rules && view.progress.rulesAck?.version === view.pkg.rules.version);
  return view.progress.items[id]?.done === true;
}

/**
 * Newcomer welcome (specs §30.7): package from the community admins, private checklist progress
 * (own devices only), explicit rules acknowledgement to the named reviewers, and recommended
 * groups that still go through ask-to-join. Completion grants nothing.
 */
export function WelcomeCard({ client, community, view, groups, onAskToJoin }: {
  client: EnclaveClient; community: CommunityView; view: OnboardingView; groups: CommunityGroup[]; onAskToJoin: (groupId: string) => void;
}) {
  const { t } = useI18n();
  const [hidden, setHidden] = useState(false);
  const [expanded, setExpanded] = useState(false);
  // Optimistic ticks: shown at once, confirmed when the encrypted progress is saved.
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const done = (id: string) => ticks[id] ?? itemDone(view, id);
  const [busy, setBusy] = useState(false);
  const { pkg, progress } = view;
  const rules = pkg.rules;
  const rulesCurrent = !!rules && progress.rulesAck?.version === rules.version;
  const rulesOutdated = !!rules?.ackRequired && !!progress.rulesAck && !rulesCurrent && !view.reviewer;
  const required = pkg.checklist.filter((i) => i.required && (i.id !== 'ack-rules' || rules?.ackRequired));
  const complete = required.every((i) => done(i.id));
  const recommended = pkg.recommended.map((id) => groups.find((g) => g.groupId === id && g.status === 'active' && g.visibility === 'discoverable')).filter((g): g is CommunityGroup => !!g);
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => { if (rules) void Promise.all(rules.reviewers.map((id) => id === client.accountId ? Promise.resolve(t('ack.you')) : client.displayName(id))).then(setNames); }, [client, rules, t]);

  const rulesNeeded = !!rules?.ackRequired && !rulesCurrent && !view.reviewer;
  if (hidden || (complete && !rulesNeeded && !expanded)) {
    return (
      <div className="welcome-collapsed">
        {rulesOutdated && <p className="ack-note" role="status" data-testid="rules-updated">{t('onboarding.rulesUpdated')}</p>}
        <button className="btn btn-ghost" onClick={() => { setHidden(false); setExpanded(true); }} data-testid="show-welcome">
          {complete && !rulesNeeded ? t('onboarding.allSet') : t('onboarding.resume')}</button>
      </div>
    );
  }
  return (
      <section className="welcome-card" aria-labelledby="welcome-title" data-testid="welcome-card">
        <h3 id="welcome-title">{t('onboarding.title', { name: community.name || t('community.unnamed') })}</h3>
        {pkg.welcome && <p className="welcome-text" data-testid="welcome-text">{pkg.welcome}</p>}
        {rulesOutdated && <p className="ack-note" role="status" data-testid="rules-updated">{t('onboarding.rulesUpdated')}</p>}
        {rules && (
          <details className="welcome-rules" open={!rulesCurrent && rules.ackRequired}>
            <summary>{t('onboarding.rules', { version: rules.version })}</summary>
            <p className="welcome-text" data-testid="rules-text">{rules.text}</p>
            {rules.ackRequired && view.reviewer && <p className="muted-text">{t('onboarding.youReview')}</p>}
            {rules.ackRequired && !view.reviewer && (rulesCurrent ? (
              <p className="ack-state" data-testid="rules-state" data-state={progress.rulesAck!.pending.length ? 'pending' : 'sent'}>
                {progress.rulesAck!.pending.length ? t('ack.pending') : t('onboarding.rulesAcked', { version: rules.version })}
              </p>
            ) : (
              <button className="btn btn-primary" disabled={busy} data-testid="rules-ack"
                onClick={() => { setBusy(true); void client.acknowledgeRules(community).finally(() => setBusy(false)); }}>{t('onboarding.ackRules', { version: rules.version })}</button>
            ))}
            {rules.ackRequired && !view.reviewer && <p className="muted-text">{t('onboarding.rulesGoesTo', { names: names.join(', ') })}</p>}
          </details>
        )}
        {recommended.length > 0 && (
          <div className="welcome-section">
            <h4>{t('onboarding.recommended')}</h4>
            <ul className="list">
              {recommended.map((g) => (
                <li key={g.groupId} className="community-group" data-testid="recommended-group">
                  <span className="row-main"><span className="row-title">{g.name ?? t('community.privateGroup')}</span></span>
                  {g.member ? <span className="muted-text">{t('community.joined')}</span>
                    : <button className="btn" onClick={() => onAskToJoin(g.groupId)} data-testid="recommended-join">{t('community.askToJoin')}</button>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {pkg.checklist.length > 0 && (
          <div className="welcome-section">
            <h4>{t('onboarding.checklist')}</h4>
            <ul className="welcome-checklist" data-testid="checklist">
              {pkg.checklist.map((item) => {
                const checked = done(item.id);
                const auto = item.id === 'ack-rules';
                const label = PRESET_ITEMS.find((p) => p.id === item.id) ? t(PRESET_ITEMS.find((p) => p.id === item.id)!.label) : item.label;
                return (
                  <li key={item.id} data-testid="checklist-item" data-item={item.id} data-done={checked}>
                    <label>
                      <input type="checkbox" checked={checked} disabled={auto} onChange={(e) => {
                        const value = e.target.checked;
                        setTicks((t) => ({ ...t, [item.id]: value }));
                        void client.setChecklistItem(community, item.id, value);
                      }} />
                      <span>{label}</span>
                    </label>
                    <span className={`chip${item.required ? ' required' : ''}`}>{t(item.required ? 'onboarding.required' : 'onboarding.optional')}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {pkg.contact && <p className="muted-text">{t('onboarding.contact', { contact: pkg.contact })}</p>}
        <p className="muted-text">{t('onboarding.private')}</p>
        <button className="btn btn-ghost" onClick={() => { setHidden(true); setExpanded(false); }} data-testid="continue-later">{t('onboarding.later')}</button>
      </section>
    );
}

/** Admin editor for the onboarding package (E2EE community metadata). */
export function OnboardingEditor({ client, community, view, groups, onClose }: {
  client: EnclaveClient; community: CommunityView; view?: OnboardingView; groups: CommunityGroup[]; onClose: () => void;
}) {
  const { t } = useI18n();
  const pkg = view?.pkg;
  const [welcome, setWelcome] = useState(pkg?.welcome ?? '');
  const [rules, setRules] = useState(pkg?.rules?.text ?? '');
  const [ackRequired, setAckRequired] = useState(pkg?.rules?.ackRequired ?? false);
  const [recommended, setRecommended] = useState<string[]>(pkg?.recommended ?? []);
  const [checklist, setChecklist] = useState(pkg?.checklist ?? PRESET_ITEMS.filter((p) => p.id !== 'notifications').map((p) => ({ id: p.id, label: t(p.label), required: p.id !== 'choose-groups' })));
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const discoverable = groups.filter((g) => g.status === 'active' && g.visibility === 'discoverable');
  const toggle = (id: string, label: string, on: boolean) => setChecklist((c) => on ? [...c, { id, label, required: false }] : c.filter((i) => i.id !== id));
  return (
    <form className="onboarding-editor" data-testid="onboarding-editor" onSubmit={(e) => {
      e.preventDefault(); setBusy(true); setError(false);
      void client.saveOnboarding(community, { welcome, rules, ackRequired: ackRequired && !!rules.trim(), recommended, checklist }).then(onClose).catch(() => { setError(true); setBusy(false); });
    }}>
      <h3>{t('onboarding.editorTitle')}</h3>
      <label className="field"><span>{t('onboarding.welcomeLabel')}</span>
        <textarea rows={3} maxLength={4000} value={welcome} onChange={(e) => setWelcome(e.target.value)} data-testid="onboarding-welcome" /></label>
      <label className="field"><span>{t('onboarding.rulesLabel')}</span>
        <textarea rows={4} maxLength={8000} value={rules} onChange={(e) => setRules(e.target.value)} data-testid="onboarding-rules" /></label>
      <label className="ack-toggle"><input type="checkbox" checked={ackRequired} onChange={(e) => setAckRequired(e.target.checked)} data-testid="onboarding-rules-ack" /> {t('onboarding.requireRulesAck')}</label>
      {view?.reviewer && pkg?.rules?.ackRequired && <p className="muted-text" data-testid="rules-ack-count">{t('onboarding.rulesCount', { version: pkg.rules.version, done: view.rulesAcknowledged.length, total: view.audience.length })}</p>}
      {discoverable.length > 0 && (
        <fieldset className="community-visibility"><legend>{t('onboarding.recommended')}</legend>
          {discoverable.map((g) => (
            <label key={g.groupId}><input type="checkbox" checked={recommended.includes(g.groupId)} data-testid="onboarding-recommend"
              onChange={(e) => setRecommended((r) => e.target.checked ? [...r, g.groupId] : r.filter((x) => x !== g.groupId))} /> {g.name ?? t('community.privateGroup')}</label>
          ))}
        </fieldset>
      )}
      <fieldset className="community-visibility"><legend>{t('onboarding.checklist')}</legend>
        {PRESET_ITEMS.map((p) => (
          <label key={p.id}><input type="checkbox" checked={checklist.some((i) => i.id === p.id)} onChange={(e) => toggle(p.id, t(p.label), e.target.checked)} /> {t(p.label)}</label>
        ))}
        {checklist.filter((i) => !PRESET_ITEMS.some((p) => p.id === i.id)).map((i) => (
          <label key={i.id}><input type="checkbox" checked onChange={() => toggle(i.id, i.label, false)} /> {i.label}</label>
        ))}
        <span className="lock-actions">
          <input className="underline-input" maxLength={120} value={custom} placeholder={t('onboarding.customItem')} onChange={(e) => setCustom(e.target.value)} data-testid="onboarding-custom" />
          <button type="button" className="btn" disabled={!custom.trim() || checklist.length >= 20}
            onClick={() => { setChecklist((c) => [...c, { id: `c-${crypto.randomUUID().slice(0, 8)}`, label: custom.trim(), required: false }]); setCustom(''); }}>{t('onboarding.addItem')}</button>
        </span>
        {checklist.map((i) => (
          <label key={`r-${i.id}`} className="muted-text"><input type="checkbox" checked={i.required}
            onChange={(e) => setChecklist((c) => c.map((x) => x.id === i.id ? { ...x, required: e.target.checked } : x))} /> {t('onboarding.requiredFor', { item: i.label })}</label>
        ))}
      </fieldset>
      {error && <p role="alert" className="failed">{t('community.actionFailed')}</p>}
      <div className="lock-actions">
        <button className="btn btn-primary" type="submit" disabled={busy} data-testid="onboarding-save">{t('storeLock.save')}</button>
        <button className="btn btn-ghost" type="button" onClick={onClose}>{t('storeLock.cancel')}</button>
      </div>
    </form>
  );
}
