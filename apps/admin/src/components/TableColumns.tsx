import { useEffect, useRef, useState, type HTMLAttributes, type PointerEvent } from 'react';
import type { ColumnType } from 'antd/es/table';

interface ResizeControl { label: string; width: number; nextWidth: number; change: (delta: number, width: number, nextWidth: number) => void; reset: () => void }
interface HeaderProps extends HTMLAttributes<HTMLTableCellElement> { columnResize?: ResizeControl }

function ResizableHeaderCell({ children, columnResize: resize, ...props }: HeaderProps) {
  const start = useRef<{ x: number; width: number; next: number } | null>(null);
  const finish = (event: PointerEvent<HTMLSpanElement>) => {
    start.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <th {...props}>{children}{resize && <span className="table-column-resizer" role="separator" aria-orientation="vertical" aria-label={`Resize ${resize.label} column`} aria-valuenow={Math.round(resize.width)} aria-valuemin={80} tabIndex={0} title="Drag to resize columns. Double-click to reset widths."
    onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); resize.reset(); }}
    onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); start.current = { x: e.clientX, width: resize.width, next: resize.nextWidth }; e.currentTarget.setPointerCapture(e.pointerId); }}
    onPointerMove={(e) => { if (start.current) { e.preventDefault(); e.stopPropagation(); resize.change(e.clientX - start.current.x, start.current.width, start.current.next); } }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={() => { start.current = null; }}
    onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); resize.change((e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 10), resize.width, resize.nextWidth); } else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); resize.reset(); } }} />}</th>;
}
export const TABLE_COMPONENTS = { header: { cell: ResizableHeaderCell } };

/** Equal widths by default; resizing a boundary trades width with the adjacent column. */
export function useTableColumns<T extends object>(id: string, columns: ColumnType<T>[]) {
  const container = useRef<HTMLDivElement | null>(null);
  const storageKey = `convo-table-widths-${id}`;
  const read = () => { try { const value = JSON.parse(localStorage.getItem(storageKey) || '{}') as Record<string, unknown>; return Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0)) as Record<string, number>; } catch { return {}; } };
  const [weights, setWeights] = useState<Record<string, number>>(read);
  const [width, setWidth] = useState(0);
  useEffect(() => { setWeights(read()); }, [storageKey]);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => { if (entry) setWidth(entry.contentRect.width); });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const keys = columns.map((c, index) => String(c.key ?? c.dataIndex ?? index));
  const total = Math.max(width, keys.length * 100);
  const values = keys.map((key) => weights[key] ?? 1);
  const sum = values.reduce((a, b) => a + b, 0);
  const sizes = values.map((value) => 80 + (total - keys.length * 80) * (sum ? value / sum : 1 / keys.length));
  const save = (next: Record<string, number>) => { setWeights(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* private mode */ } };
  const reset = () => save({});
  const sized: ColumnType<T>[] = columns.map((column, index) => ({ ...column, width: sizes[index], ellipsis: column.ellipsis ?? true,
    onHeaderCell: (c) => ({ ...column.onHeaderCell?.(c), columnResize: index < columns.length - 1 ? {
      label: typeof column.title === 'string' ? column.title : keys[index]!, width: sizes[index]!, nextWidth: sizes[index + 1]!, reset,
      change: (delta: number, a: number, b: number) => {
        const change = Math.max(80 - a, Math.min(b - 80, delta));
        const next = [...sizes]; next[index] = a + change; next[index + 1] = b - change;
        save({ ...weights, ...Object.fromEntries(keys.map((key, i) => [key, Math.max(0, next[i]! - 80)])) });
      },
    } satisfies ResizeControl : undefined }),
  }));
  return { container, columns: sized, tableWidth: total, resetWidths: reset };
}
