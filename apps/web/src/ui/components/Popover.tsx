import { useEffect, useRef, useState, type ReactNode } from 'react';
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

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
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

  const list = sub?.children ?? items;
  return (
    <div className={`menu ${className}`} ref={root}>
      {trigger({ open, toggle: () => (open ? close() : setOpen(true)) })}
      {open && (
        <ul className={`menu-list ${placement}`} role="menu" aria-label={label}>
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
        </ul>
      )}
    </div>
  );
}
