import { useMemo, useState } from 'react';
import { Space, Tag, Typography } from 'antd';
import { Background, Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from '@xyflow/react';
import type { RoleView } from '../api';
import { PERMISSIONS, ROLE_LABELS } from '../format';
import { BRAND, SERIES } from '../theme';
import { useDark } from './useDark';
const COLORS: Record<string, string> = { People: SERIES[0], 'Sign-in': SERIES[2], Audit: SERIES[3], Operations: SERIES[4] };

export function PermissionMap({ roles, focus, onFocus }: { roles: RoleView[]; focus: string; onFocus: (id: string) => void }) {
  const dark = useDark();
  const [hovered, setHovered] = useState<string | null>(null);
  const active = hovered ?? focus;
  const { nodes, edges } = useMemo(() => {
    const connections = roles.flatMap((r) => r.permissions.map((p) => ({ source: r.role, target: p })));
    const connected = new Set(connections.filter((e) => e.source === active || e.target === active).flatMap((e) => [e.source, e.target]));
    if (active) connected.add(active);
    const style = (id: string) => ({
      opacity: !active || connected.has(id) ? 1 : 0.12,
      background: dark ? '#17212b' : '#fff', color: dark ? '#e8f0f7' : '#17324d',
      border: `1px solid ${id === active ? BRAND.ocean : dark ? '#4a5c6e' : '#c3d2df'}`,
      boxShadow: id === active ? `0 0 0 3px ${BRAND.ocean}44, 0 6px 18px #17324d20` : undefined,
      transition: 'opacity 120ms, box-shadow 120ms', borderRadius: 10,
    });
    const nodes: Node[] = [
      ...roles.map((r, i) => ({ id: r.role, position: { x: 0, y: 50 + i * 120 }, data: { label: `${ROLE_LABELS[r.role] ?? r.role} · ${r.holders.length}` },
        className: active === r.role ? 'permission-focused' : connected.has(r.role) ? 'permission-connected' : '', style: { ...style(r.role), width: 225, fontWeight: 600 }, sourcePosition: Position.Right, targetPosition: Position.Left })),
      ...Object.entries(PERMISSIONS).sort((a, b) => a[1].group.localeCompare(b[1].group)).map(([p, meta], i) => ({ id: p, position: { x: 510, y: i * 52 }, data: { label: meta.label },
        className: active === p ? 'permission-focused' : connected.has(p) ? 'permission-connected' : '', style: { ...style(p), width: 310, fontSize: 12, borderInlineStart: `4px solid ${COLORS[meta.group]}` }, sourcePosition: Position.Right, targetPosition: Position.Left })),
    ];
    const edges: Edge[] = connections.map((e) => {
      const highlighted = !!active && (e.source === active || e.target === active);
      const color = highlighted ? BRAND.ocean : dark ? '#4a5c6e' : '#bcccd9';
      return { ...e, id: `${e.source}-${e.target}`, type: 'straight', className: highlighted ? 'permission-edge-highlighted' : '',
        style: { stroke: color, strokeWidth: highlighted ? 2.5 : 1, opacity: !active || highlighted ? 1 : 0.04 }, markerEnd: { type: MarkerType.ArrowClosed, color } };
    });
    return { nodes, edges };
  }, [roles, active, dark]);
  return <div className="diagram-frame" data-testid="permission-map"><Space wrap style={{ marginBottom: 12 }}>
    {Object.entries(COLORS).map(([group, color]) => <Tag key={group} style={{ borderInlineStart: `4px solid ${color}` }}>{group}</Tag>)}
    <Typography.Text type="secondary">Hover over any card to follow its connections. Click to pin; click the background to clear.</Typography.Text>
  </Space><div className="permission-canvas" onPointerMove={(event) => {
      const id = (event.target as Element).closest('.react-flow__node')?.getAttribute('data-id') ?? null;
      setHovered((old) => old === id ? old : id);
    }} onPointerLeave={() => setHovered(null)}><ReactFlow nodes={nodes} edges={edges} fitView colorMode={dark ? 'dark' : 'light'} nodesDraggable={false} nodesConnectable={false} proOptions={{ hideAttribution: true }}
    onNodeClick={(_, n) => onFocus(focus === n.id ? '' : n.id)} onPaneClick={() => onFocus('')}>
    <Background gap={24} /><Controls showInteractive={false} />
  </ReactFlow></div></div>;
}
