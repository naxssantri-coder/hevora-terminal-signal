import React, { useMemo } from 'react';
import { Zap } from 'lucide-react';
import { MarketPrice, PairId, ScanStatus, Signal } from '../../types';
import { useTranslation } from '../../i18n/LanguageContext';
import { PAIRS_LIST } from '../../data/pairs';
import { distanceToEntryPercent, isActiveSignal, statusTone } from '../../lib/signals';
import { formatJakartaTime, formatNumber, formatPercent } from '../../lib/format';
import { aggregateFeedMeta } from '../../lib/dataState';
import { useRiskConsent } from '../../lib/useRiskConsent';
import { BlurredValue, SignalBlurBanner } from '../BlurredValue';
import { PairIcon } from '../PairIcon';
import { Badge, DataQualityBadge, Panel, PanelHeader } from '../ui';
import { SignalGate } from './SignalGate';
import { LiveValue } from '../viz';

/**
 * Scalping Radar - what is about to happen, rather than what already has.
 *
 * Live Signals lists setups that exist. This is the other half of the same feed: every covered
 * pair, ordered by how close price is to its entry zone, including the pairs the engine is still
 * scanning and the reason it has not fired (scanStatus.lastScanReason, straight from the engine).
 * Every column is a published field or a comparison of two published numbers - no thresholds,
 * scores or setups are invented here.
 */

interface ScalpingRadarViewProps {
  prices: Record<PairId, MarketPrice>;
  signals: Record<PairId, Signal | null>;
  scanStatus: Partial<Record<PairId, ScanStatus>>;
  signalsBlurred: boolean;
  onOpenAsset: (pairId: PairId) => void;
}

export const ScalpingRadarView: React.FC<ScalpingRadarViewProps> = ({
  prices,
  signals,
  scanStatus,
  signalsBlurred,
  onOpenAsset,
}) => {
  const { t } = useTranslation();
  const { state: consentState, markGranted } = useRiskConsent();

  const rows = useMemo(() => {
    return PAIRS_LIST.map((pair) => {
      const market = prices[pair.id];
      const signal = signals[pair.id] ?? null;
      const active = signal && isActiveSignal(signal) ? signal : null;
      return {
        pair,
        market,
        signal: active,
        scan: scanStatus[pair.id],
        distance: active ? distanceToEntryPercent(active, market) : null,
      };
    }).sort((a, b) => {
      // Closest to entry first; pairs with no active setup sink to the bottom but stay visible,
      // because "nothing here yet, and here is why" is itself information on a radar.
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });
  }, [prices, signals, scanStatus]);

  const armedCount = rows.filter((r) => r.signal).length;

  return (
    <SignalGate state={consentState} onAcknowledged={markGranted}>
      <div className="space-y-4 font-mono">
        {signalsBlurred && <SignalBlurBanner />}

        <Panel flush>
          <div className="p-4 sm:p-5">
            <PanelHeader
              eyebrow={t('category.market')}
              title={t('market.scalpingRadar')}
              subtitle={t('signals.radarSubtitle')}
              icon={<Zap className="w-4 h-4" />}
              actions={
                <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {armedCount}/{rows.length} {t('signals.armed')}
                </span>
              }
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] border-y border-[var(--border-subtle)]">
                  <th className="text-left font-bold px-4 py-2">{t('signals.colAsset')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('signals.colPrice')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('signals.col24h')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('signals.colDistance')}</th>
                  <th className="text-right font-bold px-3 py-2">{t('signals.colScore')}</th>
                  <th className="text-left font-bold px-3 py-2">{t('signals.colState')}</th>
                  <th className="text-left font-bold px-4 py-2">{t('signals.colEngineNote')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ pair, market, signal, scan, distance }) => (
                  <tr
                    key={pair.id}
                    onClick={() => onOpenAsset(pair.id)}
                    className="border-b border-[var(--border-subtle)] last:border-b-0 hover:bg-[var(--card-hover-bg)] transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <PairIcon pairId={pair.id} size={16} />
                        <span className="font-bold text-[var(--text-primary)]">{pair.name}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                      {market ? (
                        <LiveValue value={market.price} as="span" render={(v) => formatNumber(v as number, market.digits)} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td
                      className={`px-3 py-2.5 text-right tabular-nums font-bold ${
                        !market
                          ? 'text-[var(--text-muted)]'
                          : market.change24h >= 0
                            ? 'text-[var(--color-up)]'
                            : 'text-[var(--color-down)]'
                      }`}
                    >
                      {market ? (
                        <LiveValue value={market.change24h} as="span" render={(v) => formatPercent(v as number, 2, { signed: true })} />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                      {distance === null ? (
                        <span className="text-[var(--text-muted)]">—</span>
                      ) : distance === 0 ? (
                        <span className="text-[var(--color-up)] font-bold">{t('signals.inZone')}</span>
                      ) : (
                        <BlurredValue blurred={signalsBlurred}>{formatPercent(distance, 2, { signed: false })}</BlurredValue>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                      {signal?.aiConfidenceScore ?? <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {signal ? (
                        <span className="flex items-center gap-1.5">
                          <Badge tone={signal.type === 'BUY' ? 'up' : 'down'}>{signal.type}</Badge>
                          <Badge tone={statusTone(signal.status)}>{signal.status}</Badge>
                        </span>
                      ) : (
                        <Badge tone="neutral">{t('signals.scanning')}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[280px]">
                      <span className="block truncate" title={scan?.lastScanReason || ''}>
                        {scan?.lastScanReason || t('signals.noEngineNote')}
                      </span>
                      <span className="block text-[9px] text-[var(--text-muted)] tabular-nums">
                        {scan?.lastScanAt ? formatJakartaTime(scan.lastScanAt) : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-4 py-2.5 border-t border-[var(--border-subtle)] flex items-center justify-between gap-3">
            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)]">
              {t('signals.radarFootnote')}
            </span>
            <DataQualityBadge
              meta={aggregateFeedMeta(
                'HEVORA Signal Engine',
                rows.map((row) => row.market),
                15_000,
                120_000
              )}
            />
          </div>
        </Panel>
      </div>
    </SignalGate>
  );
};
