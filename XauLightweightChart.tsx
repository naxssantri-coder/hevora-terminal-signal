import React from 'react';
import { LightweightChart } from './LightweightChart';
import { Signal } from '../types';

interface XauLightweightChartProps {
  pairName: string;
  /** Active XAUUSD signal (if any) - its entry/SL/TP1/TP2 levels are overlaid as horizontal price
   *  lines when present. Purely a visual overlay; never mutated here. */
  signal?: Signal | null;
  /** 2026-09-01 (Bagian F, drawing-tools framework, branch-only): forwarded straight to
   *  LightweightChart, defaults false. Not driven by any UI here - MarketView.tsx flips it on only
   *  behind an explicit `?drawingTools=1` URL param, so this branch's preview deploy can actually
   *  show the feature without changing anything about how a normal visit behaves. */
  drawingToolsEnabled?: boolean;
}

/**
 * XAUUSD-only chart, replacing the TradingView widget for this one pair (2026-08-31, "single
 * source of truth" audit; visually polished the same day, then again with indicators/4H/softer
 * short-history messaging in a follow-up pass).
 *
 * 2026-09-01 (Bagian H): the actual rendering logic moved to LightweightChart.tsx, generalized to
 * accept any pairId - this component is now a thin wrapper that pins pairId to 'XAUUSD' and its
 * known digits (2), so every existing call site (MarketView.tsx) and XAUUSD's own behavior stay
 * completely unchanged. Every other pair still uses TradingViewChart, untouched.
 */
export const XauLightweightChart: React.FC<XauLightweightChartProps> = ({ pairName, signal, drawingToolsEnabled }) => (
  <LightweightChart pairId="XAUUSD" pairName={pairName} digits={2} signal={signal} drawingToolsEnabled={drawingToolsEnabled} />
);
