import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Bell, Plus, Trash2 } from 'lucide-react';
import { MarketPrice, PairId } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { useAlerts } from '../../lib/alerts/store';
import { formatNumber } from '../../lib/format';

/**
 * Per-asset alert control.
 *
 * Fase 8 removed the standalone Alerts page, but not the feature: rules are created here, right
 * on the asset they belong to, which is where a trader is when they decide they want one. The
 * evaluation engine (lib/alerts/engine.ts) and the rule store are untouched - only the entry
 * point moved.
 *
 * The threshold field is pre-filled with the live quote so the common case ("tell me if it breaks
 * above where it is now") is one click, and a rule can never be created without a live price to
 * anchor it - the same discipline the paper-trading module uses.
 */
export const AlertBell: React.FC<{
  pairId: PairId;
  market: MarketPrice | undefined;
  /** Compact = icon only, for dense table rows. */
  size?: number;
}> = ({ pairId, market, size = 14 }) => {
  const { t } = useTranslation();
  const { rules, addRule, removeRule } = useAlerts();
  const [isOpen, setIsOpen] = useState(false);
  const [comparator, setComparator] = useState<'above' | 'below'>('above');
  const [threshold, setThreshold] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const assetRules = useMemo(() => rules.filter((rule) => rule.subject === pairId), [rules, pairId]);

  // Close on outside click - the popover sits inside clickable table rows, so it must not swallow
  // or block the row's own navigation once dismissed.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen]);

  const openPopover = (e: React.MouseEvent) => {
    e.stopPropagation();
    setThreshold(market ? String(Number(market.price.toFixed(market.digits))) : '');
    setIsOpen((prev) => !prev);
  };

  const handleAdd = (e: React.MouseEvent) => {
    e.stopPropagation();
    const value = Number(threshold);
    if (!Number.isFinite(value)) return;
    addRule('price', pairId, comparator, value, 'dashboard');
    setIsOpen(false);
  };

  const hasRules = assetRules.length > 0;

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        type="button"
        onClick={openPopover}
        aria-label={`${t('alerts.addRule')} ${pairId}`}
        title={hasRules ? `${assetRules.length} ${t('alerts.activeRules')}` : t('alerts.addRule')}
        className={`p-1 rounded cursor-pointer transition-colors ${
          hasRules ? 'text-[var(--color-warn)]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
        }`}
      >
        <Bell style={{ width: size, height: size }} fill={hasRules ? 'currentColor' : 'none'} />
      </button>

      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1 z-50 w-60 p-3 rounded-xl border border-[var(--border-strong)] bg-[var(--bg-panel)] shadow-2xl font-mono space-y-2.5"
        >
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[var(--text-muted)]">
            {pairId} · {t('alerts.kindPrice')}
          </div>

          {!market ? (
            <p className="text-[10px] text-[var(--color-warn)] leading-relaxed">{t('alerts.noQuote')}</p>
          ) : (
            <>
              <div className="flex gap-1">
                {(['above', 'below'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setComparator(value);
                    }}
                    className={`flex-1 px-2 py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                      comparator === value
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] border-[var(--border-strong)]'
                        : 'text-[var(--text-secondary)] border-[var(--border-subtle)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {t(value === 'above' ? 'alerts.above' : 'alerts.below')}
                  </button>
                ))}
              </div>

              <div className="flex gap-1.5">
                <input
                  type="number"
                  step="any"
                  value={threshold}
                  onChange={(e) => setThreshold(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 min-w-0 bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded px-2 py-1 text-[11px] text-[var(--text-primary)] tabular-nums focus:outline-none focus:border-[var(--border-strong)]"
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  className="px-2.5 py-1 rounded bg-[var(--text-primary)] text-[var(--bg-base)] text-[10px] font-extrabold uppercase tracking-wider hover:opacity-90 cursor-pointer shrink-0"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>

              <p className="text-[9px] text-[var(--text-muted)] leading-relaxed">
                {t('alerts.nowAt')} {formatNumber(market.price, market.digits)}
              </p>
            </>
          )}

          {assetRules.length > 0 && (
            <div className="pt-2 border-t border-[var(--border-subtle)] space-y-1">
              {assetRules.map((rule) => (
                <div key={rule.id} className="flex items-center gap-2 text-[10px]">
                  <span className="flex-1 min-w-0 truncate text-[var(--text-secondary)]">
                    {t(rule.comparator === 'above' ? 'alerts.above' : 'alerts.below')}{' '}
                    <span className="tabular-nums font-bold text-[var(--text-primary)]">
                      {formatNumber(rule.threshold ?? null, market?.digits ?? 2)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeRule(rule.id);
                    }}
                    aria-label={t('alerts.delete')}
                    className="p-0.5 rounded text-[var(--text-muted)] hover:text-[var(--color-down)] cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
