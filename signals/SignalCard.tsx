import React from 'react';
import { ArrowRight, Target } from 'lucide-react';
import { MarketPrice, Signal } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { formatNumber, formatPercent } from '../../lib/format';
import { distanceToEntryPercent, statusTone } from '../../lib/signals';
import { BlurredValue } from '../BlurredValue';
import { PairIcon } from '../PairIcon';
import { Badge } from '../ui';

/**
 * One active setup, exactly as the engine published it - entry zone, stop, both targets, its
 * risk:reward and the AI confidence recorded at creation. Nothing here is recomputed client-side;
 * the only derived figure is how far price currently sits from the entry zone, which is a
 * comparison of two live numbers, not a new signal.
 */
export const SignalCard: React.FC<{
  signal: Signal;
  market?: MarketPrice;
  blurred?: boolean;
  onOpen: (signal: Signal) => void;
}> = ({ signal, market, blurred = false, onOpen }) => {
  const { t } = useTranslation();
  const digits = market?.digits ?? 2;
  const isBuy = signal.type === 'BUY';
  const isWin = signal.status === 'TP1 Hit' || signal.status === 'TP2 Hit';
  const distance = distanceToEntryPercent(signal, market);

  const level = (label: string, value: number, className = 'text-[var(--text-primary)]') => (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">{label}</span>
      <span className={`text-[11px] font-bold tabular-nums ${className}`}>
        <BlurredValue blurred={blurred}>{formatNumber(value, digits)}</BlurredValue>
      </span>
    </div>
  );

  return (
    <button
      type="button"
      onClick={() => onOpen(signal)}
      className="w-full text-left hev-card-v2 border border-[var(--border-subtle)] hover:border-[var(--border-strong)] rounded-[14px] p-4 flex flex-col gap-3 transition-colors duration-150 cursor-pointer font-mono"
      style={{ borderLeftWidth: '3px', borderLeftColor: isBuy ? 'var(--color-up)' : 'var(--color-down)' }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <PairIcon pairId={signal.pairId} size={18} />
          <span className="font-black text-sm text-[var(--text-primary)] tracking-tight truncate">
            {signal.pairName}
          </span>
          <Badge tone={isBuy ? 'up' : 'down'}>{signal.type}</Badge>
          {/* XAU/USD-only tiering (Task 4) - undefined for every other pair. */}
          {signal.signalTier && <Badge tone={signal.signalTier === 'SCALP' ? 'warning' : 'info'}>{signal.signalTier}</Badge>}
        </div>
        <Badge tone={statusTone(signal.status)}>
          {isWin && <Target className="w-2.5 h-2.5" />}
          {signal.status}
        </Badge>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
            {t('signals.entryZone')}
          </span>
          <span className="text-[11px] font-bold tabular-nums text-[var(--text-primary)]">
            <BlurredValue blurred={blurred}>
              {formatNumber(signal.entryMin, digits)}–{formatNumber(signal.entryMax, digits)}
            </BlurredValue>
          </span>
        </div>
        {level(t('signals.stopLoss'), signal.stopLoss, 'text-[var(--color-down)]')}
        {level('TP1', signal.takeProfit1, 'text-[var(--color-up)]')}
        {level('TP2', signal.takeProfit2, 'text-[var(--color-up)]')}
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
            {t('signals.riskReward')}
          </span>
          <span className="text-[11px] font-bold tabular-nums text-[var(--text-primary)]">
            {signal.riskReward || '—'}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--border-subtle)] text-[10px]">
        <div className="flex items-center gap-3 min-w-0 text-[var(--text-secondary)]">
          <span className="uppercase tracking-wider text-[var(--text-muted)]">{signal.category}</span>
          <span className="text-[var(--text-muted)]">{signal.timeframe}</span>
          <span>
            {t('signals.aiScore')}{' '}
            <span className="font-bold text-[var(--text-primary)] tabular-nums">
              {signal.aiConfidenceScore ?? '—'}
            </span>
          </span>
          {market && (
            <span className="hidden sm:inline">
              {t('signals.distanceToEntry')}{' '}
              <span className="font-bold text-[var(--text-primary)] tabular-nums">
                {distance === null ? '—' : distance === 0 ? t('signals.inZone') : formatPercent(distance, 2, { signed: false })}
              </span>
            </span>
          )}
        </div>
        <span className="font-bold text-[var(--text-primary)] inline-flex items-center gap-1 shrink-0">
          {t('signals.openAsset')}
          <ArrowRight className="w-3 h-3" />
        </span>
      </div>
    </button>
  );
};
