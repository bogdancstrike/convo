import { useId, type ReactNode } from 'react';

/**
 * Form controls used across settings and dialogs: an accessible switch (`role="switch"`) with label
 * and helper text, and a segmented control (radio group) for small exclusive choices.
 */
export function Switch({
  checked,
  disabled = false,
  onChange,
  label,
  description,
  testId,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <div className="switch-row">
      <span className="switch-text">
        <label htmlFor={id}>{label}</label>
        {description && <span className="muted-text">{description}</span>}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        disabled={disabled}
        aria-checked={checked}
        className="switch"
        onClick={() => onChange(!checked)}
        data-testid={testId}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  testId,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  testId?: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          data-testid={testId ? `${testId}-${o.value}` : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
