import React from 'react';

/**
 * Global SVG defs shared app-wide, mounted once. Currently just the pasted-verbatim
 * #hevGaugeGradient (design-system layer, premium redesign v2) - a green->amber->red default ramp
 * any gauge can reference via `stroke="url(#hevGaugeGradient)"` when its own zone order already
 * runs low-risk-to-high-risk left to right. GaugeRadial itself still builds a per-instance
 * gradient from its caller's zones (documented at its own call site) because several of this
 * app's gauges need the reverse order - this shared def exists for the gauges that don't.
 * Rendered with zero size/hidden so it contributes nothing to layout, only to the DOM's <defs>.
 */
export const HevSvgDefs: React.FC = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
    <defs>
      <linearGradient id="hevGaugeGradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="#22C55E" />
        <stop offset="50%" stopColor="#F5B942" />
        <stop offset="100%" stopColor="#EF4444" />
      </linearGradient>
    </defs>
  </svg>
);
