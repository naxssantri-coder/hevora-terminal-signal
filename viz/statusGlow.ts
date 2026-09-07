/**
 * Maps a card's composite reading to the shared `.hev-glow-*` CSS class (index.css) - one place
 * so "what counts as important enough to glow" stays a single decision instead of a per-card
 * judgment call. Returns '' (no glow) for anything not currently in an important state - glow is
 * reserved for the reading a trader should notice first, not a decoration on every card.
 */
export type GlowStatus = 'up' | 'down' | 'warn' | null;

export const glowClass = (status: GlowStatus): string => {
  if (status === 'up') return 'hev-glow-up';
  if (status === 'down') return 'hev-glow-down';
  if (status === 'warn') return 'hev-glow-warn';
  return '';
};

/** Regime-style score (0-100, higher = more risk-on): glows green deep in RISK-ON, red deep in
 *  RISK-OFF, amber nowhere in between - the extremes are what deserves the eye, not the middle. */
export const glowForRegimeScore = (score: number | null): GlowStatus => {
  if (score === null) return null;
  if (score >= 70) return 'up';
  if (score <= 30) return 'down';
  return null;
};

/** Risk-style score (0-100, higher = more risk): glows amber once elevated, red once high. */
export const glowForRiskScore = (score: number | null, elevatedAt = 50, highAt = 75): GlowStatus => {
  if (score === null) return null;
  if (score >= highAt) return 'down';
  if (score >= elevatedAt) return 'warn';
  return null;
};
