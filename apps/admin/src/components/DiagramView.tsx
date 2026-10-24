import { isValidElement, type ReactNode } from 'react';
import { Button, Space, Tooltip } from 'antd';
import { ApartmentOutlined, TableOutlined } from '@ant-design/icons';
import type { Edge, Node } from '@xyflow/react';
import { LocalDataTable } from './LocalDataTable';
import { useViewState } from './useViewState';

function labelText(value: unknown): string {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(labelText).filter(Boolean).join(' · ');
  if (isValidElement<{ children?: ReactNode }>(value)) return labelText(value.props.children);
  return '';
}
export function DiagramView({ id, nodes, edges, onSelect, children }: { id: string; nodes: Node[]; edges: Edge[]; onSelect?: (id: string) => void; children: ReactNode }) {
  const key = `diagram_${id}`;
  const { view, update } = useViewState({ [key]: 'chart' });
  const mode = view[key];
  const labels = new Map(nodes.map((n) => [n.id, labelText(n.data.label)]));
  return <div className="diagram-view"><div className="chart-view-controls"><Space.Compact><Tooltip title="Diagram"><Button size="small" icon={<ApartmentOutlined />} aria-label="Show diagram" type={mode === 'chart' ? 'primary' : 'default'} onClick={() => update({ [key]: 'chart' })} /></Tooltip><Tooltip title="Table"><Button size="small" icon={<TableOutlined />} aria-label="Show diagram as table" type={mode === 'table' ? 'primary' : 'default'} onClick={() => update({ [key]: 'table' })} /></Tooltip></Space.Compact></div>
    <div className="diagram-view-content">{mode === 'table' ? <LocalDataTable id={`diagram-${id}`} height={450} onRow={(row) => onSelect?.(String(row.key))} columns={[{ key: 'name', title: 'Card' }, { key: 'connected', title: 'Connections' }]} rows={nodes.map((n) => ({ key: n.id, name: labels.get(n.id) ?? n.id, connected: edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => labels.get(e.source === n.id ? e.target : e.source) ?? '').join(' / ') || '—' }))} /> : children}</div>
  </div>;
}
