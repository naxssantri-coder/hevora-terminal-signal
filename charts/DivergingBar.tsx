import React from 'react';
import { formatNumber } from '../../lib/format';

/**
 * Two opposing quantities in one bar (§4) - long versus short, institutional versus retail. The
 * left/right split is the actual proportion, and both raw figures are printed beside it so the
 * bar never has to be read as a precise value.
 */
export const DivergingBar: React.FC<{
  label: string;
  leftValue: number;
  rightValue: number;
  leftLabel: string;
  rightLabel: string;
  digits?: number;
  sublabel?: string;
}> = ({ label, leftValue, rightValue, leftLabel, rightLabel, digits = 0, sublabel }) => {
  const total = leftValue + rightValue;
  const leftPercent = total > 0 ? (leftValue / total) * 100 : 50;

  return (
    <div className="space-y-1 font-mono">
      <div className="flex items-center justify-between text-[10px]">
        <span className="font-bold text-[var(--text-primary)] uppercase tracking-wider">{label}</span>
        {sublabel && <span className="text-[9px] text-[var(--text-muted)]">{sublabel}</span>}
      </div>

      <div className="flex h-4 rounded-sm overflow-hidden bg-[var(--bg-surface)]">
        <span
          className="hev-bar-grow flex items-center justify-start pl-1.5 text-[9px] font-bold text-white"
          style={{
            width: `${leftPercent}%`,
            background: 'linear-gradient(90deg, var(--color-down), color-mix(in srgb, var(--color-down) 65%, transparent))',
            transformOrigin: 'left center',
            transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {leftPercent >= 18 && `${leftPercent.toFixed(0)}%`}
        </span>
        <span
          className="hev-bar-grow flex items-center justify-end pr-1.5 text-[9px] font-bold text-white"
          style={{
            width: `${100 - leftPercent}%`,
            background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-up) 65%, transparent), var(--color-up))',
            transformOrigin: 'right center',
            transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {100 - leftPercent >= 18 && `${(100 - leftPercent).toFixed(0)}%`}
        </span>
      </div>

      <div className="flex items-center justify-between text-[9px] text-[var(--text-secondary)] tabular-nums">
        <span>
          {leftLabel} {formatNumber(leftValue, digits)}
        </span>
        <span>
          {rightLabel} {formatNumber(rightValue, digits)}
        </span>
      </div>
    </div>
  );
};
