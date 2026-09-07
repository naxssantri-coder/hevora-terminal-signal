import React from 'react';

export const SIGNAL_BLUR_MESSAGE = 'Sedang maintenance sistem — sinyal disembunyikan sementara';

/**
 * Wraps a single signal/price number so it can be hidden while the admin has "Blur Signal
 * Publik" mode on (see AdminDashboard settings tab). The wrapped value keeps its layout space
 * (no content-shift) but becomes visually unreadable and unselectable; hovering surfaces why via
 * a native tooltip, since the full explanation sentence doesn't fit inside small table
 * cells/badges as a literal overlay. A single `SignalBlurBanner` per view carries that same
 * sentence visibly instead - render one near the top of the view, not one per blurred value.
 *
 * Never used on /admin - AdminDashboard doesn't import this component at all, so admins always
 * see exact numbers regardless of this setting.
 */
export const BlurredValue: React.FC<{
  blurred: boolean;
  children: React.ReactNode;
  className?: string;
}> = ({ blurred, children, className = '' }) => {
  if (!blurred) return <>{children}</>;
  return (
    <span
      className={`inline-block blur-[8px] select-none pointer-events-none ${className}`}
      aria-hidden="true"
      title={SIGNAL_BLUR_MESSAGE}
    >
      {children}
    </span>
  );
};

/** Single explanatory banner - render once near the top of a public view when signals are blurred. */
export const SignalBlurBanner: React.FC = () => (
  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] border-l-4 border-l-[#F5B942] rounded-[14px] p-3.5 flex items-center gap-2.5 text-[11px] leading-relaxed text-[var(--text-secondary)] shadow-sm font-mono">
    <span className="text-base leading-none shrink-0">🛠️</span>
    <span className="font-extrabold uppercase tracking-wide text-[var(--text-primary)]">{SIGNAL_BLUR_MESSAGE}</span>
  </div>
);
