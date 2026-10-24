import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Input, Modal, Select, Skeleton, Space, Tag, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined, MinusCircleOutlined, QuestionCircleOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons';
import type { ComponentHealth, ComponentStatus, SystemHealth } from '../api';
import { fmtTime } from '../format';
import { useViewState } from './useViewState';
import { useDark } from './useDark';

const STATUS = {
  UP: { label: 'Healthy', color: '#2E9D6A', icon: <CheckCircleOutlined /> },
  DOWN: { label: 'Unavailable', color: '#D14B4B', icon: <CloseCircleOutlined /> },
  DEGRADED: { label: 'Degraded', color: '#D9922E', icon: <ExclamationCircleOutlined /> },
  DISABLED: { label: 'Disabled', color: '#82909f', icon: <MinusCircleOutlined /> },
  UNKNOWN: { label: 'Not verified', color: '#82909f', icon: <QuestionCircleOutlined /> },
};
export function SystemHealthView({ snapshot, error, busy, onRefresh }: { snapshot: SystemHealth | null; error: string | null; busy: boolean; onRefresh: () => void }) {
  const { view, update } = useViewState({ healthQuery: '', healthStatus: 'all', healthComponent: '' });
  const dark = useDark();
  const container = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(3);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setColumns(Math.max(1, Math.min(4, Math.floor((entry.contentRect.width + 14) / 294)))); });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const selected = snapshot?.components.find((c) => c.id === view.healthComponent);
  const query = view.healthQuery.trim().toLowerCase();
  const components = snapshot?.components.filter((c) => (view.healthStatus === 'all' || c.status === view.healthStatus) && (!query || `${c.name} ${c.group} ${c.scope} ${c.detail}`.toLowerCase().includes(query))) ?? [];
  const spans = balancedSpans(components.length, columns);
  const overall = STATUS[snapshot?.status ?? 'UNKNOWN'];
  const stale = snapshot && Date.now() - Date.parse(snapshot.checkedAt) > 90_000;
  return <div className={`health-system-view${dark ? ' health-system-dark' : ''}`} data-testid="system-health">
    {error && <Alert type="error" showIcon message={snapshot ? 'Could not refresh system health. Showing the last available checks.' : 'System health is unavailable.'} description={error} />}
    {stale && <Alert type="warning" showIcon message="These checks are more than 90 seconds old. Refresh before relying on their status." />}
    {snapshot ? <div className="health-overall" data-testid="health-overall"><div className="health-overall-heading"><span className="health-overall-icon" style={{ color: overall.color }}>{overall.icon}</span><div><h2>{snapshot.status === 'UP' ? 'Core services are operational' : snapshot.status === 'DOWN' ? 'A core service needs attention' : 'Some components need attention'}</h2><span>{snapshot.components.length} components · checked {fmtTime(snapshot.checkedAt)}</span></div></div><Space size={6} wrap>{(Object.keys(STATUS) as ComponentStatus[]).map((status) => {
      const count = snapshot.components.filter((c) => c.status === status).length;
      return count ? <Button type="text" size="small" key={status} aria-pressed={view.healthStatus === status} onClick={() => update({ healthStatus: view.healthStatus === status ? 'all' : status })}><span style={{ color: STATUS[status].color }}>{count} {STATUS[status].label.toLowerCase()}</span></Button> : null;
    })}</Space></div> : busy ? <Skeleton active paragraph={{ rows: 2 }} /> : null}
    <div className="health-component-toolbar"><Input prefix={<SearchOutlined />} allowClear placeholder="Search components or checks" aria-label="Search health components" value={view.healthQuery} onChange={(e) => update({ healthQuery: e.target.value }, true)} /><Select aria-label="Filter health status" value={view.healthStatus} onChange={(healthStatus) => update({ healthStatus })} options={[{ value: 'all', label: 'All statuses' }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label }))]} /><Typography.Text type="secondary">Auto-refresh 30s{snapshot ? ` · cache ${snapshot.cacheSeconds}s` : ''}</Typography.Text></div>
    <div className="health-components" ref={container}>
      {!components.length && !busy && <Empty description={snapshot ? 'No components match your filters' : 'No health snapshot is available'} />}
      <div className="health-component-grid">{components.map((component, index) => <ComponentTile span={spans[index] ?? 12} key={component.id} component={component} onClick={() => update({ healthComponent: component.id })} />)}</div>
    </div>
    <Modal open={!!selected} title={selected?.name} onCancel={() => update({ healthComponent: '' }, true)} footer={<Space><Button onClick={() => update({ healthComponent: '' }, true)}>Close</Button><Button type="primary" loading={busy} onClick={onRefresh}>Refresh health</Button></Space>}>
      {selected && <><Alert type={selected.status === 'UP' ? 'success' : selected.status === 'DOWN' ? 'error' : selected.status === 'DEGRADED' ? 'warning' : 'info'} showIcon message={STATUS[selected.status].label} description={selected.detail} style={{ marginBottom: 20 }} /><Descriptions column={1} bordered><Descriptions.Item label="Area">{selected.group}</Descriptions.Item><Descriptions.Item label="Dependency">{selected.required ? 'Required service' : 'Supporting service'}</Descriptions.Item><Descriptions.Item label="What is checked">{selected.scope}</Descriptions.Item><Descriptions.Item label="Response time">{selected.status === 'DISABLED' || selected.status === 'UNKNOWN' ? '—' : `${selected.latencyMs} ms`}</Descriptions.Item><Descriptions.Item label="Checked">{fmtTime(selected.checkedAt)}</Descriptions.Item></Descriptions></>}
    </Modal>
  </div>;
}
function ComponentTile({ component: c, onClick, span }: { component: ComponentHealth; onClick: () => void; span: number }) {
  const status = STATUS[c.status];
  return <button type="button" className="health-component-tile" style={{ gridColumn: `span ${span}` }} onClick={onClick} data-testid={`health-component-${c.id}`} aria-label={`${c.name}: ${status.label}`}>
    <span className="health-component-top"><span className="health-component-icon" style={{ color: status.color }}>{status.icon}</span><span className="health-component-area">{c.group}</span><Tag color={c.status === 'UP' ? 'success' : c.status === 'DOWN' ? 'error' : c.status === 'DEGRADED' ? 'warning' : 'default'} bordered={false}>{status.label}</Tag></span>
    <strong>{c.name}</strong><span className="health-component-scope">{c.scope}</span><span className="health-component-bottom"><span>{c.status === 'DISABLED' || c.status === 'UNKNOWN' ? 'No live response' : `${c.latencyMs < 1 ? '<1' : c.latencyMs} ms response`}</span><RightOutlined /></span>
  </button>;
}

/** Distribute rows evenly so the final row fills the width as well. */
function balancedSpans(total: number, columns: number): number[] {
  if (!total) return [];
  const rows = Math.ceil(total / columns), base = Math.floor(total / rows), extra = total % rows;
  return Array.from({ length: rows }, (_, row) => Array(base + (row < extra ? 1 : 0)).fill(12 / (base + (row < extra ? 1 : 0)))).flat() as number[];
}
