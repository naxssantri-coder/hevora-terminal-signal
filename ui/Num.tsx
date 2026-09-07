import React from 'react';
import { directionClass, formatNumber, formatPercent } from '../../lib/format';

/**
 * Numeric cell (§5): monospace, tabular figures, right-aligned, fixed decimals. Using this
 * everywhere is what stops one table from showing 63574.1 while the next shows 63,574.10.
 */
interface NumProps {
  value: number | null | undefined;
  digits?: number;
  /** Colours the value green/red by sign - only for changes, never for absolute prices. */
  colored?: boolean;
  signed?: boolean;
  percent?: boolean;
  className?: string;
}

export const Num: React.FC<NumProps> = ({
  value,
  digits = 2,
  colored = false,
  signed = false,
  percent = false,
  className = '',
}) => (
  <span
    className={`font-mono tabular-nums text-right ${colored ? directionClass(value) : ''} ${className}`}
  >
    {percent ? formatPercent(value, digits, { signed }) : formatNumber(value, digits, { signed })}
  </span>
);
