import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Accessible modal built on the native `<dialog>` element (focus trapping, Escape to close and
 * inert background are provided by the browser).
 */
export function Dialog({ labelledBy, onClose, children, className }: { className?: string; labelledBy: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}
