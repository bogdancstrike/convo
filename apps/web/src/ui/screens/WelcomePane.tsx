import { Icon, type IconName } from '../components/Icon';
import { Logo } from '../components/Logo';
import { useI18n } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';

/**
 * Shown when no conversation is open: what Enclave is, the encryption promise, and quick actions
 * (send a document, new chat, new group, note to self, link a device).
 */
export function WelcomePane({
  onAction,
}: {
  onAction: (action: 'document' | 'chat' | 'group' | 'note' | 'link') => void;
}) {
  const { t } = useI18n();
  const actions: { key: Parameters<typeof onAction>[0]; icon: IconName; label: MessageKey }[] = [
    { key: 'document', icon: 'file', label: 'home.sendDocument' },
    { key: 'chat', icon: 'newChat', label: 'home.newChat' },
    { key: 'group', icon: 'group', label: 'home.newGroup' },
    { key: 'note', icon: 'note', label: 'home.noteToSelf' },
    { key: 'link', icon: 'devices', label: 'home.linkDevice' },
  ];
  return (
    <section className="welcome-pane" aria-labelledby="home-title">
      <div className="welcome-inner">
        <div className="welcome-card">
          <Logo size={96} />
          <h2 id="home-title">{t('home.title')}</h2>
          <p>{t('home.body')}</p>
        </div>
        <ul className="quick-actions">
          {actions.map((a) => (
            <li key={a.key}>
              <button onClick={() => onAction(a.key)} data-testid={`home-${a.key}`}>
                <span className="qa-icon">
                  <Icon name={a.icon} />
                </span>
                <span>{t(a.label)}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="lock">
          <Icon name="lock" size={14} /> {t('home.encrypted')}
        </p>
      </div>
    </section>
  );
}

/** Right-hand pane while Settings is open. */
export function SettingsHome() {
  const { t } = useI18n();
  return (
    <section className="welcome-pane" aria-labelledby="settings-home-title">
      <div className="welcome-inner">
        <span className="settings-hero">
          <Icon name="settings" size={72} />
        </span>
        <h2 id="settings-home-title" style={{ margin: 0 }}>{t('settings.pageTitle')}</h2>
        <p className="muted-text" style={{ maxWidth: 420, textAlign: 'center', margin: 0 }}>{t('settings.pageBody')}</p>
      </div>
    </section>
  );
}

/** What a section is for, shown in the main pane while nothing is open there. */
const INTROS = {
  calls: { icon: 'calls', title: 'nav.calls', body: 'intro.calls.body', uses: ['intro.calls.use1', 'intro.calls.use2', 'intro.calls.use3'], privacy: 'intro.calls.privacy' },
  channels: { icon: 'channels', title: 'nav.channels', body: 'intro.channels.body', uses: ['intro.channels.use1', 'intro.channels.use2', 'intro.channels.use3'], privacy: 'intro.channels.privacy' },
  communities: { icon: 'community', title: 'community.title', body: 'intro.communities.body', uses: ['intro.communities.use1', 'intro.communities.use2', 'intro.communities.use3'], privacy: 'intro.communities.privacy' },
} as const satisfies Record<string, { icon: IconName; title: MessageKey; body: MessageKey; uses: readonly MessageKey[]; privacy: MessageKey }>;

export function FeatureIntro({ feature }: { feature: keyof typeof INTROS }) {
  const { t } = useI18n();
  const intro = INTROS[feature];
  return (
    <section className="welcome-pane" aria-labelledby="intro-title" data-testid={`intro-${feature}`}>
      <div className="welcome-inner feature-intro">
        <span className="feature-intro-icon"><Icon name={intro.icon} size={56} /></span>
        <h2 id="intro-title">{t(intro.title)}</h2>
        <p className="feature-intro-body">{t(intro.body)}</p>
        <div className="feature-intro-uses">
          <h3>{t('intro.useWhen')}</h3>
          <ul>{intro.uses.map((key) => <li key={key}><Icon name="check" size={16} /> <span>{t(key)}</span></li>)}</ul>
        </div>
        <p className="lock"><Icon name="lock" size={14} /> {t(intro.privacy)}</p>
      </div>
    </section>
  );
}
