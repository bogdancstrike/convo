import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Descriptions, Divider, Dropdown, Space, Spin, Tag, Typography } from 'antd';
import { KeyOutlined, LockOutlined, LogoutOutlined, SafetyOutlined, StopOutlined, UnlockOutlined } from '@ant-design/icons';
import { api, errorText, type Permission, type SignInAccount } from '../api';
import { ACTION_LABELS, CREDENTIAL_LABELS, fmtAgo, fmtTime, ROLE_LABELS } from '../format';
import { useReason, useSecret } from './confirm';

/**
 * A sign-in account at the identity provider and what administrators may do with it. Passwords
 * are never shown or stored: a reset creates a temporary password, shown once, that the person
 * must change at their next sign-in.
 */
export function SignInPanel({ load, can, onChanged, sections = ['details', 'actions', 'roles'] }: {
  load: () => Promise<SignInAccount>; can: (p: Permission) => boolean; onChanged?: () => void; sections?: Section[];
}) {
  const state = useSignIn(load);
  return <SignInSections {...state} can={can} onChanged={onChanged} sections={sections} />;
}

export type Section = 'details' | 'actions' | 'roles';

/** Loads one sign-in account and lets sections refresh it after a change. */
export function useSignIn(load: () => Promise<SignInAccount>) {
  const [account, setAccount] = useState<SignInAccount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => {
    let active = true; setError(null);
    void load().then((v) => { if (active) setAccount(v); }).catch((e) => { if (active) setError(errorText(e)); });
    return () => { active = false; };
  }, [load, version]);
  return { account, error, refresh };
}

/** Details, credential/session actions and admin roles of a loaded sign-in account. */
export function SignInSections({ account, error, refresh, can, onChanged, sections }: ReturnType<typeof useSignIn> & {
  can: (p: Permission) => boolean; onChanged?: () => void; sections: Section[];
}) {
  const { message } = App.useApp();
  const ask = useReason();
  const secret = useSecret();
  if (error) return <Alert type="warning" showIcon message={error} />;
  if (!account) return <Spin />;
  const u = account.user;
  const run = async (work: Promise<unknown>, done: string) => {
    try { await work; message.success(done); refresh(); onChanged?.(); } catch (e) { message.error(errorText(e)); }
  };
  const credentials = can('USERS_CREDENTIALS');
  return (
    <div data-testid="signin-panel">
      {sections.includes('details') && <Descriptions column={1} bordered>
        <Descriptions.Item label="Username">{u.username}</Descriptions.Item>
        <Descriptions.Item label="Name">{[u.firstName, u.lastName].filter(Boolean).join(' ') || '—'}</Descriptions.Item>
        <Descriptions.Item label="Email">{u.email || '—'}</Descriptions.Item>
        <Descriptions.Item label="Phone">{u.phone || '—'}</Descriptions.Item>
        <Descriptions.Item label="Sign-in">{u.enabled ? <Tag color="green">Allowed</Tag> : <Tag color="red" data-testid="signin-blocked">Blocked</Tag>}</Descriptions.Item>
        <Descriptions.Item label="Sign-in methods">
          <Space wrap data-testid="signin-credentials">{u.credentialTypes.length ? u.credentialTypes.map((c) => <Tag key={c} icon={c.includes('webauthn') ? <KeyOutlined /> : undefined}>{CREDENTIAL_LABELS[c] ?? c}</Tag>) : '—'}</Space>
        </Descriptions.Item>
        <Descriptions.Item label="At next sign-in">
          <Space wrap data-testid="signin-required">{u.requiredActions.length ? u.requiredActions.map((a) => <Tag key={a} color="gold">{ACTION_LABELS[a] ?? a}</Tag>) : 'nothing pending'}</Space>
        </Descriptions.Item>
        <Descriptions.Item label="Sessions">{u.sessions} active · last activity {fmtAgo(u.lastAccess)}</Descriptions.Item>
        <Descriptions.Item label="Created">{fmtTime(u.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="Convo">{account.convoAccountId ? <Tag color="blue">Signed in at least once</Tag> : <Tag>Not signed in yet</Tag>}</Descriptions.Item>
        <Descriptions.Item label="Guest access"><GuestAccess id={u.id} version={account} /></Descriptions.Item>
        <Descriptions.Item label="Admin roles"><Space wrap>{u.roles.length ? u.roles.map((r) => <Tag key={r} color="purple">{ROLE_LABELS[r] ?? r}</Tag>) : 'none'}</Space></Descriptions.Item>
      </Descriptions>}
      {sections.includes('actions') && !credentials && <Alert type="info" showIcon message="Your admin role cannot change sign-in credentials." />}
      {sections.includes('actions') && credentials && (
        <>
          <Divider orientation="left" plain>Credentials and sessions</Divider>
          <Space wrap>
            <Button icon={<LockOutlined />} data-testid="signin-reset-password" onClick={async () => {
              const reason = await ask('Reset password', `${u.username} gets a temporary password that must be changed at the next sign-in. Their Convo devices stay linked.`);
              if (!reason) return;
              try { const r = await api.resetPassword(u.id, reason); secret('Temporary password', r.temporaryPassword, 'Give it to the person through a trusted channel. It is shown only now and must be changed at the next sign-in.'); refresh(); }
              catch (e) { message.error(errorText(e)); }
            }}>Reset password</Button>
            <Dropdown menu={{ items: Object.entries(ACTION_LABELS).map(([key, label]) => ({ key, label })), onClick: async ({ key }) => {
              const reason = await ask(`Require: ${ACTION_LABELS[key]}`, `${u.username} must complete this at the next sign-in.`);
              if (reason) await run(api.requireActions(u.id, [key], reason), 'Required at next sign-in');
            } }}>
              <Button icon={<SafetyOutlined />} data-testid="signin-require">Require at next sign-in</Button>
            </Dropdown>
            <Button icon={<LogoutOutlined />} data-testid="signin-sign-out" onClick={async () => {
              const reason = await ask('Sign out everywhere', `Ends every sign-in session of ${u.username}. Convo devices stay linked and keep their messages.`);
              if (reason) await run(api.signOutEverywhere(u.id, reason), 'Signed out everywhere');
            }}>Sign out everywhere</Button>
            {u.enabled
              ? <Button danger icon={<StopOutlined />} data-testid="signin-block" onClick={async () => {
                  const reason = await ask('Block sign-in', `${u.username} can no longer sign in; current sessions end. To also stop their Convo devices, disable the Convo account.`, true);
                  if (reason) await run(api.setSignInEnabled(u.id, false, reason), 'Sign-in blocked');
                }}>Block sign-in</Button>
              : <Button icon={<UnlockOutlined />} data-testid="signin-allow" onClick={async () => {
                  const reason = await ask('Allow sign-in', `${u.username} can sign in again.`);
                  if (reason) await run(api.setSignInEnabled(u.id, true, reason), 'Sign-in allowed');
                }}>Allow sign-in</Button>}
            {can('ACCOUNT_STATUS') && <Dropdown menu={{ items: [7, 30, 90, 180].map((d) => ({ key: String(d), label: `${d} days from now` })), onClick: async ({ key }) => {
              const reason = await ask(`Guest access for ${key} days`, `${u.username} becomes (or stays) a guest until ${key} days from now; expired guests are re-enabled.`);
              if (reason) await run(api.extendGuest(u.id, Number(key), reason), 'Guest access set');
            } }}>
              <Button data-testid="signin-guest">Guest access…</Button>
            </Dropdown>}
          </Space>
        </>
      )}
      {sections.includes('roles') && !can('ROLES_MANAGE') && <Alert type="info" showIcon message="Only administrators with the Administrator (all) role grant or remove roles." />}
      {sections.includes('roles') && can('ROLES_MANAGE') && (
        <>
          <Divider orientation="left" plain>Admin roles</Divider>
          <Space wrap>{Object.entries(ROLE_LABELS).map(([role, label]) => {
            const has = u.roles.includes(role);
            return <Button key={role} type={has ? 'primary' : 'default'} ghost={has} data-testid={`role-${role}`} onClick={async () => {
              const reason = await ask(has ? `Remove ${label}` : `Grant ${label}`, has ? 'The role is removed when the access token renews or they sign in again.' : 'Grants administrator rights in this console.', !has);
              if (reason) await run(api.setRole(u.id, role, !has, reason), has ? 'Role removed' : 'Role granted');
            }}>{has ? '✓ ' : ''}{label}</Button>;
          })}</Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>You cannot change your own roles or credentials; another administrator must.</Typography.Paragraph>
        </>
      )}
    </div>
  );
}

/** Guest expiry of a sign-in account, or "Member" (the endpoint answers 404 for members). */
function GuestAccess({ id, version }: { id: string; version: unknown }) {
  const [status, setStatus] = useState<{ expiresAt: string; expiredAt: string | null } | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void api.guestStatus(id).then((s) => { if (active) setStatus(s); }).catch(() => { if (active) setStatus(null); });
    return () => { active = false; };
  }, [id, version]);
  if (status === undefined) return <Spin size="small" />;
  if (status === null) return <span data-testid="guest-status">Member (no expiry)</span>;
  return status.expiredAt
    ? <Tag color="red" data-testid="guest-status">Guest · expired {fmtTime(status.expiredAt)}</Tag>
    : <Tag color="orange" data-testid="guest-status">Guest until {fmtTime(status.expiresAt)}</Tag>;
}
