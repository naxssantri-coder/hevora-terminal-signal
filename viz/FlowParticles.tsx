import React, { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'motion/react';

export interface FlowNode {
  id: string;
  label: string;
  sublabel?: string;
  /** Position as a percentage of the diagram's own box (0-100 each axis). */
  x: number;
  y: number;
  tone?: 'up' | 'down' | 'neutral';
}

export interface FlowEdge {
  from: string;
  to: string;
  /** 0-1: how many particles flow, how wide the line is and how visible it is - drive this from
   *  real magnitude (e.g. contracts, dollar flow), never a fixed decorative value. */
  intensity: number;
  color?: string;
}

const TONE_COLOR: Record<'up' | 'down' | 'neutral', string> = {
  up: 'var(--color-up)',
  down: 'var(--color-down)',
  neutral: 'var(--text-secondary)',
};

/** Deterministic pseudo-random in [0,1) from integer seeds - stable across re-renders (no jitter
 *  on every poll) but still looks organic per strand, unlike Math.random(). */
const seededUnit = (a: number, b: number): number => {
  const x = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Directed particle-flow diagram (§ animation rule 4: shows the direction real data moves in, not
 * decoration). Used for the Policy Transmission chain (FED -> RATES -> LIQUIDITY -> MARKETS) and
 * for COT's open-interest split into LONG/SHORT. Particle COUNT, SIZE, and the flow-line BUNDLE
 * are all driven by each edge's `intensity`, which callers compute from a real quantity - a
 * flat/empty edge (intensity 0) still draws its line bundle, just fainter, rather than being
 * silently hidden. `maxParticles` (default 14) is deliberately generous - a thin trickle of 2-3
 * dots read as "barely working" against a wide panel; a real, sizeable flow should look dense.
 *
 * Each edge renders as a BUNDLE of individually-curved .hev-flow-line strands (8-10+ per edge,
 * never 2-3 - a single stroked line reads as a diagram, a bundle of them reads as an actual flow)
 * fanned out around the straight a->b path, each with its own deterministic stroke-width and
 * opacity so the bundle has real visual texture instead of N identical copies of one line.
 * Particles still travel along the centre strand for the motion cue.
 *
 * Geometry is measured, not viewBox-scaled (Bagian E self-audit fix): this used to render into a
 * fixed 100x100 viewBox with the default preserveAspectRatio="xMidYMid meet", which letterboxes a
 * square coordinate system into a centred square the size of the SHORTER side - on every real
 * caller here (a wide, short panel strip) that meant the whole diagram rendered as a tiny cluster
 * in the middle of the box with most of its width sitting empty, the opposite of the "spread
 * nodes across the full width" the node layout was designed for. A ResizeObserver now measures
 * the box's actual rendered width once and the SVG viewBox matches the real pixel box exactly (1
 * unit = 1px on both axes), so percentages map straight to real pixels with no distortion and no
 * empty margins, the same way LineChart's own viewBox already tracks its real rendered box.
 */
export const FlowParticles: React.FC<{
  nodes: FlowNode[];
  edges: FlowEdge[];
  height?: number;
  maxParticles?: number;
  /** Strands per edge (the "8-10+ lines per side" rule) - constant regardless of intensity, only
   *  their width/opacity/visibility respond to it, so a thin edge still reads as a bundle. */
  strandsPerEdge?: number;
}> = ({ nodes, edges, height = 180, maxParticles = 14, strandsPerEdge = 9 }) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const glowId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  // 600 is a reasonable pre-measurement fallback (roughly this app's narrowest real panel width)
  // so the first paint is never a zero-width/collapsed diagram before the observer fires.
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const px = (pct: number) => (pct / 100) * width;
  const py = (pct: number) => (pct / 100) * height;

  return (
    <div ref={containerRef} className="w-full">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Flow diagram">
        <defs>
          <filter id={glowId} x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {edges.map((edge, edgeIndex) => {
          const aNode = byId.get(edge.from);
          const bNode = byId.get(edge.to);
          if (!aNode || !bNode) return null;
          const a = { x: px(aNode.x), y: py(aNode.y) };
          const b = { x: px(bNode.x), y: py(bNode.y) };
          const color = edge.color ?? 'var(--border-strong)';
          const clamped = Math.max(0, Math.min(1, edge.intensity));
          // Even a nonzero-but-small edge still shows at least a couple of particles - a real flow
          // should never read as visually identical to zero.
          const particleCount = clamped <= 0 ? 0 : Math.max(2, Math.round(clamped * maxParticles));
          const particleRadius = 2 + clamped * 2.4;
          const duration = 2.6 - clamped * 1.1;

          // Perpendicular unit vector to a->b, used to fan the bundle's strands out from the
          // straight line rather than stacking them all on top of each other. Bow is sized off the
          // diagram's own height (a stable ~100-180px range across every caller) rather than the
          // edge's pixel length, so the fan looks the same whether an edge spans 200px or 1200px.
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;

          return (
            <g key={`${edge.from}-${edge.to}`}>
              {Array.from({ length: strandsPerEdge }).map((_, i) => {
                // Deterministic per (edge, strand) so the bundle's texture is stable across
                // renders, not a new random shape every poll.
                const spread = (i / (strandsPerEdge - 1) - 0.5) * 2; // -1..1 across the bundle
                const bow = spread * height * (0.05 + seededUnit(edgeIndex, i) * 0.12);
                const controlX = midX + nx * bow;
                const controlY = midY + ny * bow;
                const strokeWidth = 0.8 + seededUnit(edgeIndex * 7 + i, i) * 2;
                const baseOpacity = 0.2 + seededUnit(i, edgeIndex * 3 + 1) * 0.65;
                return (
                  <path
                    key={i}
                    className="hev-flow-line"
                    d={`M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${controlX.toFixed(1)} ${controlY.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`}
                    stroke={color}
                    strokeWidth={strokeWidth}
                    opacity={clamped <= 0 ? baseOpacity * 0.25 : baseOpacity * (0.5 + clamped * 0.5)}
                  />
                );
              })}
              {Array.from({ length: particleCount }).map((_, i) => (
                <motion.circle
                  key={i}
                  r={particleRadius}
                  fill={color}
                  filter={`url(#${glowId})`}
                  initial={{ cx: a.x, cy: a.y, opacity: 0 }}
                  animate={{ cx: [a.x, b.x], cy: [a.y, b.y], opacity: [0, 1, 1, 0] }}
                  transition={{
                    duration,
                    repeat: Infinity,
                    ease: 'linear',
                    delay: (i / Math.max(1, particleCount)) * duration,
                  }}
                />
              ))}
            </g>
          );
        })}

        {nodes.map((node) => {
          const color = node.tone ? TONE_COLOR[node.tone] : 'var(--text-primary)';
          const cx = px(node.x);
          const cy = py(node.y);
          // hev-flow-center-ring: the hub/source node (tone 'neutral' or unset, by this app's own
          // existing convention - 'oi'/'book' in every current caller) gets the amber ring
          // treatment instead of the plain outlined dot, matching the COT reference's "centre
          // circle holding the net position" - the up/down destination nodes keep their own
          // tone-coloured ring.
          const isCenter = !node.tone || node.tone === 'neutral';
          // A label at an edge-positioned node (the common hub->spoke layout every caller here
          // uses, e.g. x=92 for a destination on the right) centres past the panel's own edge once
          // rendered at a real, legible font size - anchor away from whichever edge the node sits
          // near instead of always centring blindly on cx.
          const textAnchor = node.x >= 80 ? 'end' : node.x <= 20 ? 'start' : 'middle';
          const labelX = textAnchor === 'end' ? cx + 10 : textAnchor === 'start' ? cx - 10 : cx;
          return (
            <g key={node.id}>
              {isCenter ? (
                <circle cx={cx} cy={cy} r={7} className="hev-flow-center-ring" />
              ) : (
                <circle cx={cx} cy={cy} r={6} fill="var(--bg-panel)" stroke={color} strokeWidth={1.5} />
              )}
              <text
                x={labelX}
                y={cy - 12}
                textAnchor={textAnchor}
                fontSize={10.5}
                fontWeight={700}
                fill={color}
                fontFamily="var(--font-mono, monospace)"
                letterSpacing={0.2}
              >
                {node.label}
              </text>
              {node.sublabel && (
                <text
                  x={labelX}
                  y={cy + 18}
                  textAnchor={textAnchor}
                  fontSize={9}
                  fill="var(--text-muted)"
                  fontFamily="var(--font-mono, monospace)"
                >
                  {node.sublabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
