import { isValidElement, type ReactNode } from 'react';
import { ChartCard, ChartViewSwitch, useChartHeader } from './ChartCard';
import type { Edge, Node } from '@xyflow/react';
import { LocalDataTable } from './LocalDataTable';
import { useViewState } from './useViewState';

function labelText(value: unknown): string {
  if (value == null || typeof value === 'boolean') return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(labelText).filter(Boolean).join(' · ');
  if (isValidElement<{ children?: ReactNode; 'aria-hidden'?: boolean | 'true' | 'false' }>(value)) return value.props['aria-hidden'] === true || value.props['aria-hidden'] === 'true' ? '' : labelText(value.props.children);
  return '';
}
interface Props { id: string; nodes: Node[]; edges: Edge[]; onSelect?: (id: string) => void; children: ReactNode }
export function DiagramView(props: Props) {
  const header = useChartHeader();
  return header === undefined ? <ChartCard title="Organization chart"><DiagramBody {...props} /></ChartCard> : <DiagramBody {...props} />;
}
function DiagramBody({ id, nodes, edges, onSelect, children }: Props) {
  const key = `diagram_${id}`;
  const { view, update } = useViewState({ [key]: 'chart' });
  const mode = view[key];
  const labels = new Map(nodes.map((n) => [n.id, labelText(n.data.label)]));
  return <div className="diagram-view"><ChartViewSwitch diagram mode={mode} onChange={(next) => update({ [key]: next })} />
    <div className="diagram-view-content">{mode === 'table' ? <LocalDataTable id={`diagram-${id}`} height={450} onRow={(row) => onSelect?.(String(row.key))} columns={[{ key: 'name', title: 'Card' }, { key: 'connected', title: 'Connections' }]} rows={nodes.map((n) => ({ key: n.id, name: labels.get(n.id) ?? n.id, connected: edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => labels.get(e.source === n.id ? e.target : e.source) ?? '').join(' / ') || '—' }))} /> : children}</div>
  </div>;
}
