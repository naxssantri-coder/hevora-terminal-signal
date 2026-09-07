import React, { useId } from 'react';
import { motion } from 'motion/react';
import { AnimatedNumber } from './AnimatedNumber';

export interface GaugeZone {
  /** 0-100 range this zone covers. */
  from: number;
  to: number;
  color: string;
  label: string;
}

/**
 * Needle-style semicircle gauge for a composite 0-100 score (Policy Regime, Positioning Strength,
 * Geopolitical Risk, etc.) - the visual upgrade over a bare "62 CENDERUNG RISK-ON" text line.
 *
 * The track is a single continuous arc filled with a linear gradient built from the zone colours
 * (a stop at each zone's midpoint), not N discrete flat-coloured segments - for this specific
 * semicircle (angle sweeps -180deg to 0deg as value goes 0 to 100) x-position is a monotonic
 * function of value, so a left-to-right gradient reads as a genuine colour sweep along the arc,
 * not just an approximation glued on. The needle animates to the current value on top of it; it
 * is the only thing that moves, and only when `value` itself changes - never a replay animation
 * on every re-render.
 */
export const GaugeRadial: React.FC<{
  value: number | null;
  zones: GaugeZone[];
  label?: string;
  size?: number;
  /** Overrides the auto-picked zone label/colour under the number - use for a null-safe caption. */
  captionOverride?: string;
  /** Tick marks drawn along the arc at these 0-100 positions. Defaults to a 0/25/50/75/100 scale -
   *  pass [] to disable, or your own set (e.g. zone boundaries) for a gauge where those matter more
   *  than an even scale. */
  ticks?: number[];
}> = ({ value, zones, label, size = 168, captionOverride, ticks = [0, 25, 50, 75, 100] }) => {
  // Pure canvas padding (card-precision fix): the arc/needle/tick geometry below is unchanged by
  // this - cx, cy and radius stay anchored to `size` exactly as before, so the gauge looks
  // pixel-identical. What changes is the viewBox: it now extends `pad` beyond that geometry on
  // every side, so the tightest existing margins (the arc's round-cap endpoints and the 50-tick
  // at the top of the sweep, ~7-9.5px from the old viewBox edge by construction - constant
  // regardless of `size`, not a rendering bug, just too little headroom for comfort) get real
  // breathing room instead of sitting close enough to the edge to read as clipped once a
  // feGaussianBlur glow or sub-pixel rounding is layered on top.
  const pad = 8;
  const radius = size / 2 - 14;
  const cx = size / 2;
  const cy = size / 2;
  const clamped = value === null ? null : Math.max(0, Math.min(100, value));
  const gradientId = useId();
  const glowId = useId();

  const activeZone = clamped === null ? null : zones.find((z) => clamped >= z.from && clamped <= z.to) ?? null;
  const needleColor = activeZone?.color ?? 'var(--text-muted)';

  // Angle: -180deg (left, value=0) to 0deg (right, value=100), measured from the positive x-axis.
  const angleForValue = (v: number) => -180 + (v / 100) * 180;
  const needleAngle = clamped === null ? -90 : angleForValue(clamped);

  const polarPoint = (angleDeg: number, r: number) => {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const trackStart = polarPoint(-180, radius);
  const trackEnd = polarPoint(0, radius);
  const tickInner = radius - 7;
  const tickOuter = radius + 7;
  const needleLength = radius - 14;
  const needleTip = polarPoint(needleAngle, needleLength);

  return (
    <div className="flex flex-col items-center" style={{ width: size + pad * 2 }}>
      <svg
        width={size + pad * 2}
        height={size / 2 + 16 + pad * 2}
        viewBox={`${-pad} ${-pad} ${size + pad * 2} ${size / 2 + 16 + pad * 2}`}
        role="img"
        aria-label={label}
      >
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
            {zones.map((zone) => (
              <stop key={zone.label} offset={`${(zone.from + zone.to) / 2}%`} stopColor={zone.color} />
            ))}
          </linearGradient>
          {/* Dedicated glow filter (same feGaussianBlur+feMerge pattern FlowParticles uses for its
              particles) for the needle's endpoint dot only - kept as its own filter rather than
              reusing FlowParticles' so each component's glow radius stays tuned to its own scale. */}
          <filter id={glowId} x="-300%" y="-300%" width="700%" height="700%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <path
          d={`M ${trackStart.x.toFixed(2)} ${trackStart.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${trackEnd.x.toFixed(2)} ${trackEnd.y.toFixed(2)}`}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={9}
          strokeLinecap="round"
        />
        {/* hev-gauge-arc (pasted design-system class): stroke-width/linecap/fill come from the
            class. `stroke` itself is overridden per instance via inline style (higher specificity
            than the class) rather than the class's literal shared #hevGaugeGradient id - this
            gauge's colour order is driven by the CALLER's zones (e.g. Market Regime runs
            red->white->green left to right, Positioning Strength runs green->amber->red) so a
            single shared low-to-high ramp would silently invert the meaning of "which side is
            bad" for about half of this app's gauges. The shared #hevGaugeGradient def is still
            added once at the app root (AppShell) exactly as specified, for any gauge that is
            happy with its literal default order. */}
        <path
          className="hev-gauge-arc"
          d={`M ${trackStart.x.toFixed(2)} ${trackStart.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${trackEnd.x.toFixed(2)} ${trackEnd.y.toFixed(2)}`}
          style={{ stroke: `url(#${gradientId})`, opacity: clamped === null ? 0.35 : 0.95, transition: 'opacity 300ms ease-out' }}
        />

        {/* Tick marks - scale reference points along the arc, independent of the needle so a
            reader can place the current value against the full 0-100 range at a glance instead of
            only reading the printed number below. */}
        {ticks.map((t) => {
          const angle = angleForValue(Math.max(0, Math.min(100, t)));
          const inner = polarPoint(angle, tickInner);
          const outer = polarPoint(angle, tickOuter);
          return (
            <line
              key={t}
              x1={inner.x.toFixed(2)}
              y1={inner.y.toFixed(2)}
              x2={outer.x.toFixed(2)}
              y2={outer.y.toFixed(2)}
              stroke="var(--text-muted)"
              strokeWidth={1}
              strokeLinecap="round"
              opacity={0.45}
            />
          );
        })}

        {clamped !== null && (
          <g>
            {/* Needle rotation is NOT done via CSS transform/rotate - framer-motion defaults SVG
                elements to transform-box: fill-box, which (verified in DevTools) makes any
                transform-origin relative to this needle's OWN content bounding box rather than
                the gauge's absolute centre, and setting transformBox: 'view-box' explicitly still
                gets silently overridden back to a fill-box-relative "50% 50%" once motion owns a
                `rotate` transform on the same element. Real bug, predates this pass, never caught
                because every gauge in this app had only ever been screenshotted with value=null
                (needle not rendered) until this checkpoint forced a real value through to verify
                it - the needle's actual on-screen position landed hundreds of pixels outside the
                gauge card. Fixed by animating the needle tip's raw x2/y2 SVG attributes instead
                (the same technique FlowParticles already uses for its cx/cy particle motion),
                which has no transform-origin ambiguity at all. */}
            <motion.line
              x1={cx}
              y1={cy}
              className="hev-gauge-needle"
              initial={false}
              animate={{ x2: needleTip.x, y2: needleTip.y }}
              transition={{ type: 'spring', stiffness: 120, damping: 16 }}
            />
            <circle cx={cx} cy={cy} r={4} fill="#fff" />
            {/* Animated glowing endpoint - a soft pulse in the active zone's own colour at the
                needle tip, so the reader's eye lands exactly where the needle is pointing rather
                than having to trace the whole line from the centre. Position tracks the needle via
                the same spring on cx/cy; the pulse itself animates r (radius) directly rather than
                a CSS `scale` transform, for the same transform-origin-safety reason as above. */}
            <motion.circle
              r={3.5}
              fill={needleColor}
              filter={`url(#${glowId})`}
              initial={false}
              animate={{
                cx: needleTip.x,
                cy: needleTip.y,
                opacity: [0.55, 1, 0.55],
                r: [3, 3.9, 3],
              }}
              transition={{
                cx: { type: 'spring', stiffness: 120, damping: 16 },
                cy: { type: 'spring', stiffness: 120, damping: 16 },
                opacity: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' },
                r: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' },
              }}
            />
          </g>
        )}
      </svg>

      <div className="-mt-4 flex flex-col items-center">
        <AnimatedNumber
          value={clamped}
          digits={0}
          className="font-mono hev-hero-number hev-count-transition"
          style={{ color: needleColor }}
        />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] mt-1" style={{ color: needleColor }}>
          {captionOverride ?? activeZone?.label ?? '—'}
        </span>
        {label && (
          <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--text-muted)] mt-0.5">{label}</span>
        )}
      </div>
    </div>
  );
};
