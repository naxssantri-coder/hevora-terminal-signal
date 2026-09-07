import React from 'react';
import { DataMeta, DataStatus, formatAge } from '../../lib/dataState';

/**
 * Source-health chip (§4: a status dot, not a chart; §7.4: source + timestamp + state travel
 * with every number). Rendering this next to data is what keeps the terminal honest - a stale
 * figure is visibly stale rather than quietly passed off as live.
 */

const STATUS_STYLE: Record<DataStatus, { dot: string; text: string; label: string }> = {
  LIVE: { dot: 'bg-[var(--color-up)]', text: 'text-[var(--color-up)]', label: 'LIVE' },
  DELAYED: { dot: 'bg-[var(--color-warn)]', text: 'text-[var(--color-warn)]', label: 'DELAYED' },
  STALE: { dot: 'bg-[var(--color-warn)]', text: 'text-[var(--color-warn)]', label: 'STALE' },
  UNAVAILABLE: { dot: 'bg-[var(--text-muted)]', text: 'text-[var(--text-muted)]', label: 'UNAVAILABLE' },
  ERROR: { dot: 'bg-[var(--color-down)]', text: 'text-[var(--color-down)]', label: 'ERROR' },
  LOADING: { dot: 'bg-[var(--text-muted)]', text: 'text-[var(--text-muted)]', label: 'LOADING' },
};

interface DataQualityBadgeProps {
  meta: DataMeta;
  /** Hides the provider name when the surrounding panel already states it. */
  compact?: boolean;
  className?: string;
}

export const DataQualityBadge: React.FC<DataQualityBadgeProps> = ({ meta, compact = false, className = '' }) => {
  const style = STATUS_STYLE[meta.status];
  const age = formatAge(meta.lastUpdated ?? meta.timestamp);

  return (
    <span
      // flex-wrap (layout audit): on a narrow panel this badge's own dot/label/source/age spans
      // could run wider than the space PanelHeader gives its actions slot - wrapping onto a
      // second line here instead of overflowing past the card's edge, which .hev-card-v2's own
      // overflow:hidden was otherwise clipping mid-word.
      className={`inline-flex flex-wrap items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)] ${className}`}
      title={
        meta.message ||
        `${meta.source}${meta.lastUpdated ? ` · updated ${new Date(meta.lastUpdated).toLocaleString()}` : ''}`
      }
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot} ${meta.status === 'LIVE' ? 'animate-subtle-pulse' : ''}`}
      />
      <span className={`font-bold ${style.text}`}>{style.label}</span>
      {!compact && <span className="text-[var(--text-muted)]">· {meta.source}</span>}
      {age !== '—' && meta.status !== 'UNAVAILABLE' && <span className="text-[var(--text-muted)]">· {age}</span>}
    </span>
  );
};
