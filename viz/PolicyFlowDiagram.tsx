import React, { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { FlowNode } from './FlowParticles';

export interface PolicyFlowEdge {
  from: string;
  to: string;
}

const STANCE_COLOR: Record<'dovish' | 'hawkish' | 'neutral', string> = {
  dovish: 'var(--color-up)',
  hawkish: 'var(--color-down)',
  neutral: 'var(--text-secondary)',
};

/**
 * Single-strand directional process diagram (card-precision fix, Masalah 2). FlowParticles draws
 * each edge as a BUNDLE of 9 individually-fanned, randomly-varied strands - the right visual for
 * "does real volume genuinely flow here" diagrams like Order Book / Institutional Flow, where the
 * bundle's texture IS the signal. Policy Transmission isn't that: it's a fixed 4-step chain (FED
 * -> the rate that trades -> the liquidity backdrop -> markets) that always reads the same
 * direction, so a randomly-fanned bundle over a short edge just reads as zigzag noise instead of a
 * process. This draws exactly what the chain is: one clean line per segment, a small arrowhead
 * marking direction, and a single particle travelling start-to-end - never several, never random.
 *
 * Colour follows the stance gauge's own convention (dovish = up/green, hawkish = down/red) rather
 * than the neutral border-grey FlowParticles uses, so the diagram itself carries the "which way is
 * policy leaning" read, not just the gauge above it. The gradient fades in along the chain (faint
 * at FED, full strength at Markets) rather than the neutral-to-neutral solid stroke a plain colour
 * would give - flowing the transmission from source to effect exactly as this diagram already
 * argues it does, no synthetic per-edge meaning invented on top of it.
 *
 * Same measured-width pattern as FlowParticles (see that file's own note on the viewBox-scaling
 * squish bug this fixes) - not shared code, but a proven fix worth repeating verbatim.
 */
export const PolicyFlowDiagram: React.FC<{
  nodes: FlowNode[];
  edges: PolicyFlowEdge[];
  stance: 'dovish' | 'hawkish' | 'neutral';
  height?: number;
}> = ({ nodes, edges, stance, height = 150 }) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const gradientId = useId();
  const glowId = useId();
  const arrowId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
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
  const color = STANCE_COLOR[stance];
  const nodeRadius = 7;
  // Clearance between a line's endpoints and the node circles it connects, so the stroke starts
  // clear of the source dot and the arrowhead lands just short of the destination dot rather than
  // drawing through or on top of either.
  const gap = 4;

  return (
    <div ref={containerRef} className="w-full">
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Policy transmission flow">
        <defs>
          {/* userSpaceOnUse (not the objectBoundingBox default): each edge here is a perfectly
              horizontal line, so its own bounding box has zero height - objectBoundingBox
              gradients need a non-degenerate box to build their coordinate transform from, and
              silently fail to paint anything when they don't get one (verified via DevTools: the
              stroke attribute resolved fine, computed style showed opacity 1 and display
              inline, yet nothing rendered - the paint server itself was the dead end). userSpaceOnUse
              sidesteps that entirely, and as a side effect makes the fade span the FULL diagram
              width once instead of restarting on every edge's own short bbox. */}
          <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={width} y2={0}>
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={1} />
          </linearGradient>
          {/* userSpaceOnUse (not the objectBoundingBox default) for the same reason as the
              gradient above: this filter is shared by both the edge lines (zero-height bbox)
              and the particle dots, and an objectBoundingBox filter region on a zero-height
              target is itself degenerate - it clips the filter's own output to nothing rather
              than merely failing to blur it, which was silently hiding the entire line, not
              just its glow. A fixed region generously covering the whole diagram works
              identically for both shapes. */}
          <filter id={glowId} filterUnits="userSpaceOnUse" x={-20} y={-20} width={width + 40} height={height + 40}>
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* userSpaceOnUse (not the default strokeWidth scaling): keeps the arrowhead a small,
              constant size regardless of the line's own strokeWidth. */}
          <marker id={arrowId} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M0,0 L8,4 L0,8 Z" fill={color} />
          </marker>
        </defs>

        {edges.map((edge) => {
          const aNode = byId.get(edge.from);
          const bNode = byId.get(edge.to);
          if (!aNode || !bNode) return null;
          const a = { x: px(aNode.x), y: py(aNode.y) };
          const b = { x: px(bNode.x), y: py(bNode.y) };
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const start = { x: a.x + ux * (nodeRadius + gap), y: a.y + uy * (nodeRadius + gap) };
          const end = { x: b.x - ux * (nodeRadius + gap + 6), y: b.y - uy * (nodeRadius + gap + 6) };

          return (
            <g key={`${edge.from}-${edge.to}`}>
              <path
                d={`M ${start.x.toFixed(1)} ${start.y.toFixed(1)} L ${end.x.toFixed(1)} ${end.y.toFixed(1)}`}
                stroke={`url(#${gradientId})`}
                strokeWidth={2.5}
                strokeLinecap="round"
                fill="none"
                filter={`url(#${glowId})`}
                markerEnd={`url(#${arrowId})`}
              />
              {/* Raw cx/cy attribute animation (not a CSS transform) - the same technique
                  GaugeRadial's needle and FlowParticles' own particles already use, since
                  framer-motion's transform-box defaults make SVG transform-origin unreliable. */}
              <motion.circle
                r={3.2}
                fill={color}
                filter={`url(#${glowId})`}
                initial={{ cx: start.x, cy: start.y, opacity: 0 }}
                animate={{ cx: [start.x, end.x], cy: [start.y, end.y], opacity: [0, 1, 1, 0] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'linear' }}
              />
            </g>
          );
        })}

        {nodes.map((node) => {
          const cx = px(node.x);
          const cy = py(node.y);
          const textAnchor = node.x >= 80 ? 'end' : node.x <= 20 ? 'start' : 'middle';
          const labelX = textAnchor === 'end' ? cx + 10 : textAnchor === 'start' ? cx - 10 : cx;
          return (
            <g key={node.id}>
              <circle cx={cx} cy={cy} r={nodeRadius} fill="var(--bg-panel)" stroke="var(--text-secondary)" strokeWidth={1.5} />
              <text
                x={labelX}
                y={cy - 14}
                textAnchor={textAnchor}
                fontSize={10.5}
                fontWeight={700}
                fill="var(--text-primary)"
                fontFamily="var(--font-mono, monospace)"
                letterSpacing={0.2}
              >
                {node.label}
              </text>
              {node.sublabel && (
                <text
                  x={labelX}
                  y={cy + 20}
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
