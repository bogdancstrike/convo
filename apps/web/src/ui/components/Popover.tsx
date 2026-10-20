import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react-dom';
import { createPortal } from 'react-dom';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** One menu entry; `children` renders a submenu. */
export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  testId?: string;
  onSelect?: () => void;
  children?: MenuItem[];
}

/**
 * Anchored dropdown menu (header ⋮ menu, attach menu). Closes on outside click, Escape or
 * selection; one level of submenu. Items are buttons for keyboard and screen-reader access.
 */
export function Menu({
  trigger,
  items,
  label,
  placement = 'below-end',
  className = '',
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode;
  items: MenuItem[];
  label: string;
  placement?: 'below-end' | 'above-start';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<MenuItem | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLUListElement>(null);
  const { refs, floatingStyles } = useFloating({ open, strategy: 'fixed', placement: placement === 'above-start' ? 'top-start' : 'bottom-end',
    middleware: [offset(6), flip(), shift({ padding: 8 })], whileElementsMounted: autoUpdate });
  useLayoutEffect(() => { refs.setReference(root.current); refs.setFloating(panel.current); }, [open, sub, refs]);


  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (close(), root.current?.querySelector('button')?.focus());
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setSub(null);
  };

  useEffect(() => { if (open) panel.current?.querySelector('button')?.focus({ preventScroll: true }); }, [open, sub]);

  const list = sub?.children ?? items;
  return (
    <div className={`menu ${className}`} ref={root}>
      {trigger({ open, toggle: () => (open ? close() : setOpen(true)) })}
      {open && createPortal(
        <ul className={`menu-list floating-menu ${className}`} ref={panel} style={floatingStyles} role="menu" aria-label={label}
          onKeyDown={(e) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault(); const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }}>
          {sub && (
            <li role="none">
              <button role="menuitem" className="menu-back" onClick={() => setSub(null)}>
                <Icon name="back" size={18} /> {sub.label}
              </button>
            </li>
          )}
          {list.map((item) => (
            <li key={item.label} role="none">
              <button
                role="menuitem"
                className={item.danger ? 'danger' : ''}
                data-testid={item.testId}
                aria-haspopup={item.children ? 'menu' : undefined}
                onClick={() => {
                  if (item.children) {
                    setSub(item);
                    return;
                  }
                  close();
                  item.onSelect?.();
                }}
              >
                {item.icon && <span className={`menu-icon icon-${item.icon}`}><Icon name={item.icon} size={20} /></span>}
                <span className="menu-label">{item.label}</span>
                {item.children && <Icon name="next" size={16} />}
              </button>
            </li>
          ))}
        </ul>, root.current?.closest('dialog') ?? document.body,
      )}
    </div>
  );
}
