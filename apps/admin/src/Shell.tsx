import { useCallback, useEffect, useMemo, useState } from 'react';
import { App as AntApp, Avatar, Badge, Button, Card, ConfigProvider, Dropdown, Layout, Menu, Result, Space, Spin, Switch, Tooltip, Typography } from 'antd';
import { ApartmentOutlined, AuditOutlined, BellOutlined, DesktopOutlined, DashboardOutlined, EllipsisOutlined, HeartOutlined, LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, MoonOutlined, TeamOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { AdminError, api, type Me, type Permission } from './api';
import { session, signIn, signOut } from './auth';
import { themeConfig } from './theme';
import { DarkContext } from './components/useDark';
import { ROLE_LABELS } from './format';
import { OverviewPage } from './pages/Overview';
import { UsersPage } from './pages/Users';
import { AuditPage } from './pages/Audit';
import { HealthPage } from './pages/Health';
import { SessionsPage } from './pages/Sessions';
import { AlertsPage } from './pages/Alerts';
import { PolicyPage } from './pages/Policy';
import { SecurityAlertContext, useSecurityAlertInbox } from './components/SecurityAlertContext';
import { RolesPage } from './pages/Roles';

/** Pages, the permission each needs, and their menu entry. */
const PAGES = [
  { key: 'overview', label: 'Overview & activity', icon: <DashboardOutlined />, needs: 'STATS_READ' as Permission },
  { key: 'users', label: 'Users', icon: <TeamOutlined />, needs: 'ACCOUNTS_READ' as Permission },
  { key: 'roles', label: 'Roles & permissions', icon: <ApartmentOutlined />, needs: 'ACCOUNTS_READ' as Permission },
  { key: 'sessions', label: 'Live sessions', icon: <DesktopOutlined />, needs: 'SESSIONS_READ' as Permission },
  { key: 'alerts', label: 'Security alerts', icon: <BellOutlined />, needs: 'ALERTS_READ' as Permission },
  { key: 'policy', label: 'Organization policy', icon: <SafetyCertificateOutlined />, needs: 'POLICY_READ' as Permission },
  { key: 'audit', label: 'Audit log', icon: <AuditOutlined />, needs: 'AUDIT_READ' as Permission },
  { key: 'health', label: 'Health', icon: <HeartOutlined />, needs: 'HEALTH_READ' as Permission },
] as const;
type PageKey = (typeof PAGES)[number]['key'];

function useHashRoute(): [string, (r: string) => void] {
  const [route, setRoute] = useState(() => window.location.hash.replace(/^#\/?/, ''));
  useEffect(() => {
    const on = () => setRoute(window.location.hash.replace(/^#\/?/, ''));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return [route, (r) => { window.location.hash = `/${r}`; }];
}

/** Organization admin console (ADM-01): separate origin, admin roles only, every change audited. */
export function Shell() {
  const [dark, setDark] = useState(() => {
    try { return (localStorage.getItem('convo-admin-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'; } catch { return false; }
  });
  useEffect(() => { try { localStorage.setItem('convo-admin-theme', dark ? 'dark' : 'light'); } catch { /* private mode */ } }, [dark]);
  return (
    <ConfigProvider theme={themeConfig(dark)}>
      <DarkContext.Provider value={dark}>
        <AntApp><Console dark={dark} setDark={setDark} /></AntApp>
      </DarkContext.Provider>
    </ConfigProvider>
  );
}

function Console({ dark, setDark }: { dark: boolean; setDark: (d: boolean) => void }) {
  const [admin, setAdmin] = useState<string | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [route, navigate] = useHashRoute();
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('convo-admin-sidebar') === 'collapsed'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('convo-admin-sidebar', collapsed ? 'collapsed' : 'expanded'); } catch { /* private mode */ } }, [collapsed]);
  useEffect(() => { void session().then(setAdmin).catch(() => setAdmin(null)); }, []);
  // A signed-in person without an admin role is refused by the API: show "no role", not an outage.
  useEffect(() => { if (admin) void api.me().then(setMe).catch((e) => (e instanceof AdminError && (e.status === 403 || e.status === 401) ? setMe({ actor: admin, roles: [], permissions: [] }) : setFailed(true))); }, [admin]);
  const can = useCallback((p: Permission) => !!me?.permissions.includes(p), [me]);
  const alertInbox = useSecurityAlertInbox(can('ALERTS_READ'), me?.actor ?? '');
  const visible = useMemo(() => PAGES.filter((p) => can(p.needs)), [can]);
  const [routePath = '', routeQuery] = route.split('?');
  const canonicalPath = routePath.replace(/^activity(?=\/|$)/, 'overview').replace(/^sign-in(?:\/(.*))?$/, (_, id: string | undefined) => id ? `users/sign-in/${id}` : 'users');
  const canonical = canonicalPath + (routeQuery ? `?${routeQuery}` : '');
  const [section = '', ...rest] = canonicalPath.split('/');
  const page = (visible.find((p) => p.key === section)?.key ?? visible[0]?.key) as PageKey | undefined;
  useEffect(() => { if (me && page && (section !== page || canonical !== route)) navigate(section === page ? canonical : page); }, [me, page, section, navigate, canonical, route]);

  if (admin === undefined) return <div className="signin"><Spin size="large" /></div>;
  if (!admin) return <SignInScreen />;
  if (failed) return <Result status="error" title="The admin service is unreachable" extra={<Button onClick={() => window.location.reload()}>Retry</Button>} />;
  if (!me) return <div className="signin"><Spin size="large" /></div>;
  if (me.permissions.length === 0) {
    return <div data-testid="admin-no-role"><Result status="403" title="No administrator role"
      subTitle={`${admin} is signed in, but has no Convo administrator role.`} extra={<Button onClick={() => void signOut()}>Sign out</Button>} /></div>;
  }
  const props = { can, navigate, param: rest.join('/') };
  return (
    <SecurityAlertContext.Provider value={alertInbox}><Layout className="console-frame">
      <Layout.Sider collapsible trigger={null} collapsed={collapsed} onCollapse={setCollapsed} breakpoint="lg" collapsedWidth={64} width={232} theme={dark ? 'dark' : 'light'} style={{ borderRight: '1px solid var(--ant-color-border-secondary, transparent)' }}>
        <div className={`brand${collapsed ? ' brand-collapsed' : ''}`}><img src="/logo.svg" alt="" />{!collapsed && <span>Convo<small>Admin console</small></span>}</div>
        <Menu mode="inline" inlineCollapsed={collapsed} selectedKeys={page ? [page] : []} onClick={(e) => navigate(e.key)} data-testid="admin-menu"
          items={visible.map((p) => ({ key: p.key, icon: p.icon, label: p.key === 'alerts' ? <span className="sidebar-alert-label">{p.label}<Badge size="small" count={alertInbox.summary?.open ?? 0} overflowCount={99} /></span> : p.label, 'data-testid': `admin-tab-${p.key}` }))} />
        <div className="sidebar-footer">
          <Dropdown trigger={['click', 'hover']} placement="topRight" menu={{ items: [{ key: 'out', icon: <LogoutOutlined />, label: 'Sign out', onClick: () => void signOut() }] }}>
            <button type="button" className="sidebar-account" aria-label={`Account menu for ${admin}`}>
              <Avatar size={32} className="sidebar-avatar">{admin.slice(0, 1).toUpperCase()}</Avatar>
              <span className={`sidebar-account-info${collapsed ? ' sidebar-name-collapsed' : ''}`}>
                <strong data-testid="admin-name" title={admin}>{admin}</strong>
                <span className="sidebar-account-roles" data-testid="admin-roles" title={me.roles.map((r) => ROLE_LABELS[r] ?? r).join(' · ')}>{me.roles.map((r) => ROLE_LABELS[r] ?? r).join(' · ')}</span>
              </span>
              {!collapsed && <EllipsisOutlined className="sidebar-account-more" />}
            </button>
          </Dropdown>
          <div className="sidebar-appearance"><span className="sidebar-appearance-label"><MoonOutlined />{!collapsed && <span>Dark theme</span>}</span><Switch size="small" checked={dark} onChange={setDark} aria-label="Dark theme" /></div>
          <Tooltip title={collapsed ? 'Expand sidebar' : undefined} placement="right"><Button type="text" className="sidebar-toggle" icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />} onClick={() => setCollapsed((v) => !v)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} data-testid="sidebar-toggle">{!collapsed && 'Collapse sidebar'}</Button></Tooltip>
        </div>
      </Layout.Sider>
      <Layout>
        <Layout.Content className="console-content">
          {page === 'overview' && <OverviewPage {...props} />}
          {page === 'users' && <UsersPage {...props} />}
          {page === 'roles' && <RolesPage {...props} />}
          {page === 'sessions' && <SessionsPage {...props} />}
          {page === 'alerts' && <AlertsPage {...props} />}
          {page === 'policy' && <PolicyPage {...props} />}
          {page === 'audit' && <AuditPage {...props} />}
          {page === 'health' && <HealthPage {...props} />}
        </Layout.Content>
      </Layout>
    </Layout></SecurityAlertContext.Provider>
  );
}

function SignInScreen() {
  return (
    <div className="signin">
      <Card className="signin-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <img src="/logo.svg" alt="" />
          <Typography.Title level={3} style={{ margin: 0 }}>Convo admin console</Typography.Title>
          <Typography.Text type="secondary">For organization administrators. Every action is recorded in a tamper-evident audit log. This console cannot read anyone's messages.</Typography.Text>
          <Button type="primary" size="large" block onClick={() => void signIn()} data-testid="admin-sign-in">Sign in</Button>
        </Space>
      </Card>
    </div>
  );
}

/** Props every page receives. */
export interface PageProps { can: (p: Permission) => boolean; navigate: (route: string) => void; param: string }
