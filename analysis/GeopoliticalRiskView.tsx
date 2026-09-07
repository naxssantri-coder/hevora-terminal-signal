import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { GeopoliticalRiskResponse } from '../../types';
import { useEndpoint } from '../../lib/useEndpoint';
import { statusFromAge } from '../../lib/dataState';
import { Badge, DataQualityBadge, LoadingState, Panel, PanelHeader, UnavailableState } from '../ui';
import { GaugeRadial, glowClass, InfoTooltip, RangePositionBar, type GaugeZone } from '../viz';

const NEW_WINDOW_MS = 6 * 60 * 60_000;
const TOP_N = 3;

const scoreBandKey = (score: number): string => (score >= 66 ? 'ELEVATED' : score >= 33 ? 'MODERATE' : 'LOW');

const RISK_ZONES: GaugeZone[] = [
  { from: 0, to: 33, color: 'var(--color-up)', label: 'LOW' },
  { from: 33, to: 66, color: 'var(--color-warn)', label: 'MODERATE' },
  { from: 66, to: 100, color: 'var(--color-down)', label: 'ELEVATED' },
];

/**
 * Geopolitical Risk (spec §L). Score/gauge computation untouched (Tahap F, blueprint §49 - the
 * Live Intelligence pipeline's own relevance scoring). GaugeRadial stays (reuse-first) with an
 * added RangePositionBar LOW->HIGH read underneath, same pattern as Market Regime's RISK-OFF/
 * RISK-ON bar.
 *
 * Two things spec §L asks for are left out, both per §AG's "never fabricate" rule:
 *  - "TOP RISK AREAS" grouped by region (MIDDLE EAST / EASTERN EUROPE / ENERGY): the API's
 *    GeopoliticalRiskContributor has no region/category field at all (types.ts) - only
 *    id/title/score/weight/createdAt. Inventing a region label per headline would be exactly the
 *    "AI mengarang interpretasi" spec §AG forbids, so this keeps the real per-headline list
 *    instead (now capped to 3, per the instruction to show only the most relevant headlines).
 *  - "14D CHANGE" and "RISK TIMELINE" (Aug 18/20/23 style history): the score is computed live on
 *    every poll and never persisted as a series anywhere in this build - there is no real history
 *    to plot, the same gap already documented for the Correlation window and FX Strength timeframe.
 */
export const GeopoliticalRiskView: React.FC = () => {
  const { data, isLoading } = useEndpoint<GeopoliticalRiskResponse>('/api/intelligence/geopolitical-risk', 15 * 60_000);

  if (isLoading && !data) return <LoadingState variant="cards" />;

  const hasScore = data && !data.unavailable && data.score !== null;
  const score = hasScore ? (data!.score as number) : null;
  const top = (data?.topContributors ?? []).slice(0, TOP_N);

  const tooltipText = hasScore
    ? `Geopolitical relevance scored by HEVORA's Live Intelligence pipeline. ${data!.methodology}`
    : 'Geopolitical relevance scored by HEVORA Live Intelligence.';

  return (
    <Panel className={`flex flex-col h-full ${glowClass(score === null ? null : score >= 66 ? 'down' : score >= 33 ? 'warn' : null)}`}>
      <PanelHeader
        eyebrow="ANALYSIS"
        title="GEOPOLITICAL RISK"
        icon={<ShieldAlert className="w-4 h-4" />}
        actions={
          <div className="flex items-center gap-2">
            {data && (
              <DataQualityBadge
                meta={{ source: data.source, lastUpdated: data.generatedAt, status: statusFromAge(data.generatedAt, 20 * 60_000, 60 * 60_000) }}
              />
            )}
            <InfoTooltip text={tooltipText} />
          </div>
        }
      />

      {!hasScore ? (
        <div className="mt-4 flex-1 min-h-0 flex items-center justify-center">
          <UnavailableState className="w-full" source={data?.source ?? 'HEVORA Live Intelligence'} detail={data?.error} />
        </div>
      ) : (
        <div className="mt-3 flex-1 min-h-0 flex flex-col items-center gap-3">
          <div className="shrink-0 w-full flex flex-col items-center gap-3">
            <GaugeRadial value={score} zones={RISK_ZONES} captionOverride={scoreBandKey(score as number)} size={130} />

            <div className="w-full flex items-center gap-2">
              <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--color-up)] shrink-0">LOW</span>
              <RangePositionBar low={0} high={100} value={score as number} width={200} height={10} />
              <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--color-down)] shrink-0">HIGH</span>
            </div>
          </div>

          {top.length > 0 && (
            <div className="w-full flex-1 min-h-0 overflow-y-auto pt-2 border-t border-[var(--border-subtle)] space-y-1.5">
              {top.map((c) => {
                const isNew = Date.now() - new Date(c.createdAt).getTime() < NEW_WINDOW_MS;
                return (
                  <div key={c.id} title={c.title} className="text-[10px] leading-tight">
                    <span className="flex items-center gap-1.5 min-w-0">
                      {isNew && <Badge tone="up">NEW</Badge>}
                      <span className="min-w-0 truncate text-[var(--text-primary)] font-bold">{c.title}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
};
