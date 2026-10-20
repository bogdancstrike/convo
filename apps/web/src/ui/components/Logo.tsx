import { useId } from 'react';

/**
 * Enclave mark: chat bubble with a lock, Ice → Cyan → Ocean → Navy gradient and an amber dot.
 * Mirrors `docs/assets/logo.svg`; gradient IDs are unique per instance.
 */
export function Logo({ size = 48, title = 'Enclave' }: { size?: number; title?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={title}>
      <defs>
        <linearGradient id={id} x1="10" y1="6" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#8BD3E2" />
          <stop offset="0.5" stopColor="#2596BE" />
          <stop offset="1" stopColor="#17324D" />
        </linearGradient>
      </defs>
      <path
        d="M32 5C17.1 5 5 15.9 5 29.4c0 7 3.2 13.3 8.4 17.8L10.5 59l12.2-6.3c2.9.9 6.1 1.4 9.3 1.4 14.9 0 27-10.9 27-24.4S46.9 5 32 5z"
        fill={`url(#${id})`}
      />
      <path d="M25.5 28.5v-4.2a6.5 6.5 0 0 1 13 0v4.2" fill="none" stroke="#F4F8FA" strokeWidth="3.6" strokeLinecap="round" />
      <rect x="21.5" y="27.5" width="21" height="16" rx="4.5" fill="#F4F8FA" />
      <circle cx="32" cy="34.2" r="2.6" fill="#17324D" />
      <rect x="30.8" y="35" width="2.4" height="5" rx="1.2" fill="#17324D" />
      <circle cx="47.5" cy="16.5" r="3.2" fill="#F2B66D" />
    </svg>
  );
}
