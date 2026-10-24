import { createContext, useContext, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Card, Tooltip, type CardProps } from 'antd';
import { ApartmentOutlined, LineChartOutlined, TableOutlined } from '@ant-design/icons';
import { useDark } from './useDark';

// A panel owns its header; the chart or diagram supplies its own view state to that header.
const HeaderSlot = createContext<HTMLElement | null | undefined>(undefined);
export const useChartHeader = () => useContext(HeaderSlot);

export function ChartCard({ children, title, description, extra, className, ...props }: CardProps & { description?: ReactNode }) {
  const [slot, setSlot] = useState<HTMLSpanElement | null>(null);
  return <HeaderSlot.Provider value={slot}><Card {...props} title={<div className="chart-heading"><div>{title}</div>{description && <div className="chart-description">{description}</div>}</div>} className={`chart-card${className ? ` ${className}` : ''}`} extra={<div className="chart-header-actions">{extra}<span className="chart-header-slot" ref={setSlot} /></div>}>{children}</Card></HeaderSlot.Provider>;
}

export function ChartViewSwitch({ mode, onChange, label, diagram = false }: { mode: string | undefined; onChange: (mode: 'chart' | 'table') => void; label?: string; diagram?: boolean }) {
  const slot = useChartHeader();
  const dark = useDark();
  const controls = <div className={`chart-view-switch${dark ? ' chart-view-switch-dark' : ''}`} role="group" aria-label={`${label ?? 'Diagram'} presentation`}>
    <Tooltip title={diagram ? 'Diagram' : 'Chart'}><button type="button" aria-label={diagram ? 'Show diagram' : `Show chart: ${label}`} aria-pressed={mode !== 'table'} onClick={() => onChange('chart')}>{diagram ? <ApartmentOutlined /> : <LineChartOutlined />}</button></Tooltip>
    <Tooltip title="Table"><button type="button" aria-label={diagram ? 'Show diagram as table' : `Show table: ${label}`} aria-pressed={mode === 'table'} onClick={() => onChange('table')}><TableOutlined /></button></Tooltip>
  </div>;
  return slot ? createPortal(controls, slot) : null;
}

/** Header chrome for a diagram that is already inside another card or detail view. */
export function DiagramPanel({ title, description, extra, children, className = '' }: { title: string; description?: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  const [slot, setSlot] = useState<HTMLSpanElement | null>(null);
  return <HeaderSlot.Provider value={slot}><section className={`diagram-panel ${className}`}>
    <header className="diagram-panel-header"><div className="diagram-panel-heading"><h3>{title}</h3>{description && <div className="diagram-panel-description">{description}</div>}</div><div className="chart-header-actions">{extra}<span className="chart-header-slot" ref={setSlot} /></div></header>
    {children}
  </section></HeaderSlot.Provider>;
}
