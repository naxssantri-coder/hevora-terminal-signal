import React from 'react';
import { AlertTriangle, Inbox, PlugZap, RefreshCw } from 'lucide-react';
import { UNAVAILABLE_TEXT } from '../../lib/dataState';
import { Skeleton, SkeletonCards, SkeletonTable } from './Skeleton';

/**
 * The six states every module must be able to render (§7.10) - loading, empty, error,
 * unavailable, stale, live. Centralised so no module ever ends up blank when an API fails, and
 * so "unavailable" always looks the same wherever a provider goes down.
 */

interface StateShellProps {
  icon: React.ReactNode;
  title: string;
  detail?: string;
  /** Source name + timestamp so the user can see WHAT failed, not just that something did. */
  source?: string;
  timestamp?: string | null;
  action?: React.ReactNode;
  className?: string;
}

// hev-empty-state (design-system layer, premium redesign v2): a provider-down panel used to
// dominate the screen with a tall centred block - exactly the "empty box eating the layout" look
// flagged from the checkpoint 3 screenshots. This caps it at a single compact row: icon, title,
// then detail/source packed into the same line with a "·" separator, ellipsis-truncated rather
// than wrapping - a reader can still see the panel's shape and the rest of the page around it.
// The full detail text is still available as a native title tooltip on hover, so nothing is lost,
// only de-prioritised relative to the panels that actually have data to show.
const StateShell: React.FC<StateShellProps> = ({
  icon,
  title,
  detail,
  source,
  timestamp,
  action,
  className = '',
}) => {
  const metaParts = [
    detail,
    source ? `SOURCE: ${source}` : null,
    timestamp ? `LAST: ${new Date(timestamp).toLocaleString()}` : null,
  ].filter(Boolean);

  return (
    <div className={`hev-empty-state ${className}`} role="status" title={metaParts.join(' · ') || undefined}>
      <span className="shrink-0 text-[var(--text-muted)]">{icon}</span>
      <div className="min-w-0 flex-1 flex items-baseline gap-2 overflow-hidden">
        <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-[var(--text-primary)] shrink-0">
          {title}
        </p>
        {metaParts.length > 0 && (
          // min-w-0 (Analysis grid rework bugfix): a flex item's default min-width is `auto`,
          // which for `white-space: nowrap` text (part of what `truncate` sets) resolves to the
          // text's FULL width, not a shrinkable min-content size - so without this, `truncate`'s
          // ellipsis never actually engages, the row silently renders at full natural width
          // instead. Harmless-looking before (overflow:visible let it spill past the card edge,
          // still fully readable), but turned into real, invisible clipped text the moment any
          // ancestor sets overflow-x to something other than visible - exactly what AnalysisHub's
          // fixed-height grid cells do (lg:overflow-x-hidden) for their own unrelated reason.
          <p className="min-w-0 text-[10px] text-[var(--text-secondary)] truncate">{metaParts.join(' · ')}</p>
        )}
      </div>
      {action && <span className="shrink-0">{action}</span>}
    </div>
  );
};

export const LoadingState: React.FC<{ variant?: 'cards' | 'table' | 'text'; className?: string }> = ({
  variant = 'table',
  className = '',
}) => (
  <div className={`space-y-3 ${className}`} role="status" aria-busy="true">
    <Skeleton className="h-3 w-40" />
    {variant === 'cards' ? <SkeletonCards /> : variant === 'table' ? <SkeletonTable /> : <Skeleton className="h-32 w-full rounded-[14px]" />}
  </div>
);

export const EmptyState: React.FC<{ title?: string; detail?: string; action?: React.ReactNode; className?: string }> = ({
  title = 'No data for this selection',
  detail,
  action,
  className,
}) => <StateShell icon={<Inbox className="w-5 h-5" />} title={title} detail={detail} action={action} className={className} />;

export const ErrorState: React.FC<{
  title?: string;
  detail?: string;
  source?: string;
  onRetry?: () => void;
  className?: string;
}> = ({ title = 'Something went wrong', detail, source, onRetry, className }) => (
  <StateShell
    icon={<AlertTriangle className="w-5 h-5 text-[var(--color-down)]" />}
    title={title}
    detail={detail}
    source={source}
    className={className}
    action={
      onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" />
          Retry
        </button>
      ) : undefined
    }
  />
);

/**
 * Shown when every provider in the chain failed and no valid cache remains. Deliberately states
 * the source and the last successful timestamp instead of substituting a number (§1).
 *
 * `title` defaults to UNAVAILABLE_TEXT ("Live data temporarily unavailable") for every existing
 * caller - correct for the common case, a live feed that is down right now but expected back. A
 * handful of callers (Data-freshness audit, 2026-08-26: CME FedWatch, PBOC/Bank Indonesia policy
 * rates) are a structurally different case - no free, legal provider exists at all, so nothing is
 * ever coming back without a licensing deal this app doesn't have. Calling that "temporarily
 * unavailable" reads as a bug; those callers pass an explicit calmer title instead (e.g. "Provider
 * berlisensi belum terpasang" / "Licensed provider not wired") so the two situations don't look
 * identical to the reader.
 */
export const UnavailableState: React.FC<{
  source?: string;
  timestamp?: string | null;
  detail?: string;
  title?: string;
  action?: React.ReactNode;
  className?: string;
}> = ({ source, timestamp, detail, title, action, className }) => (
  <StateShell
    icon={<PlugZap className="w-5 h-5" />}
    title={title ?? UNAVAILABLE_TEXT}
    detail={detail ?? 'No live provider responded and no valid cached value is available. Nothing is estimated or filled in.'}
    source={source}
    timestamp={timestamp}
    action={action}
    className={className}
  />
);
