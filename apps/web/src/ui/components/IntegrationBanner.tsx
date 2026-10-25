import { useEffect, useState } from 'react';
import type { EnclaveClient } from '../../core/client';
import type { Conversation } from '../../core/model';
import { useI18n } from '../i18n/i18n';
import { Icon } from './Icon';

type Participant = Awaited<ReturnType<EnclaveClient['integrationParticipants']>>[number];

/**
 * Persistent disclosure above a chat that includes an archive or bot (FR-EXT-02, AC-INT-01/02):
 * who receives every message and what happens to it. It cannot be dismissed, so nobody types into
 * a chat with an integration without seeing it.
 */
export function IntegrationBanner({ client, conversation }: { client: EnclaveClient; conversation: Conversation }) {
  const { t } = useI18n();
  const [participants, setParticipants] = useState<Participant[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => void client.integrationParticipants(conversation.id).then((p) => { if (!cancelled) setParticipants(p); }).catch(() => undefined);
    load();
    const off = client.on('groups', load);
    return () => { cancelled = true; off(); };
  }, [client, conversation.id]);
  if (!participants.length) return null;
  return (
    <div className="integration-banner" role="note" data-testid="integration-banner">
      <Icon name="alert" size={16} />
      <div>
        {participants.map((p) => (
          <p key={p.accountId}>
            <strong>{p.addressedOnly ? t('integration.addressedOnly', { name: p.name }) : t('integration.receives', { name: p.name, kind: t(`integration.${p.kind}`) })}</strong> {p.retention}
          </p>
        ))}
      </div>
    </div>
  );
}
