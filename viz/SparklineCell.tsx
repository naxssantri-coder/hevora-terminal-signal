import React from 'react';
import { Sparkline } from '../charts';

/**
 * Table-row-sized sparkline (§ Policy Factors, Volatility, Commodity Board, watchlist rows) - a
 * thin wrapper over charts/Sparkline with the small dimensions those contexts need, so callers
 * don't repeat the same width/height everywhere the pattern is used.
 */
export const SparklineCell: React.FC<{ values: number[]; color?: string }> = ({ values, color }) => (
  <Sparkline values={values} width={64} height={20} color={color} />
);
