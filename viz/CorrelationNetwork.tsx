import React from 'react';
import { FlowParticles, type FlowEdge, type FlowNode } from './FlowParticles';

export interface NetworkAsset {
  id: string;
  label: string;
  /** Position as a percentage of the diagram's own box (0-100 each axis) - caller lays out the
   *  mesh (e.g. a triangle for 3 assets), this component does not auto-layout. */
  x: number;
  y: number;
}

export interface NetworkEdgeValue {
  from: string;
  to: string;
  /** Pearson correlation, -1..1, or null when not enough overlap to compute one. */
  value: number | null;
}

/**
 * Correlation network graph (spec §K): reuses FlowParticles verbatim for the actual line/particle
 * rendering - no new graph-drawing code, no new dependency (no d3-force or similar; this repo
 * only ever needs 3-7 manually-positioned nodes, never a general force-directed layout) - and adds
 * only what FlowParticles does not already do: a correlation value printed near each edge's
 * midpoint. Nodes get tone 'neutral' uniformly (FlowParticles' amber centre-ring treatment) since
 * every asset here is a peer, not a source/destination pair the way COT's open-interest split or
 * the Policy Transmission chain are.
 *
 * Label positions are plain CSS percentages over the same box FlowParticles renders into, not a
 * second pixel measurement - node.x/y are already 0-100 percentages of that box, so a label at the
 * midpoint of two nodes only needs the average of their x/y, no ResizeObserver duplication.
 */
export const CorrelationNetwork: React.FC<{
  assets: NetworkAsset[];
  edges: NetworkEdgeValue[];
  height?: number;
}> = ({ assets, edges, height = 200 }) => {
  const byId = new Map(assets.map((a) => [a.id, a]));

  const nodes: FlowNode[] = assets.map((a) => ({ id: a.id, label: a.label, x: a.x, y: a.y, tone: 'neutral' }));

  const flowEdges: FlowEdge[] = edges
    .filter((e) => e.value !== null)
    .map((e) => ({
      from: e.from,
      to: e.to,
      intensity: Math.abs(e.value as number),
      color: (e.value as number) >= 0 ? 'var(--color-up)' : 'var(--color-down)',
    }));

  return (
    <div className="relative w-full">
      <FlowParticles nodes={nodes} edges={flowEdges} height={height} strandsPerEdge={6} maxParticles={8} />
      <div className="pointer-events-none absolute inset-0">
        {edges.map((edge) => {
          const a = byId.get(edge.from);
          const b = byId.get(edge.to);
          if (!a || !b) return null;
          const midX = (a.x + b.x) / 2;
          const midY = (a.y + b.y) / 2;
          const color = edge.value === null ? 'var(--text-muted)' : edge.value >= 0 ? 'var(--color-up)' : 'var(--color-down)';
          return (
            <span
              key={`${edge.from}-${edge.to}`}
              className="absolute -translate-x-1/2 -translate-y-1/2 font-mono text-[10px] font-bold tabular-nums px-1 rounded bg-[var(--bg-panel)]"
              style={{ left: `${midX}%`, top: `${midY}%`, color }}
            >
              {edge.value === null ? '—' : edge.value.toFixed(2)}
            </span>
          );
        })}
      </div>
    </div>
  );
};
