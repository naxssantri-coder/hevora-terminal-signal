import React from 'react';

/**
 * Panel - the one container every module builds on, so a screen assembled from six different
 * modules still reads as one terminal. Borders/radii/paddings live here rather than being
 * re-typed per view.
 */
interface PanelProps {
  children: React.ReactNode;
  className?: string;
  /** Removes inner padding for tables/charts that manage their own edges. */
  flush?: boolean;
  as?: 'div' | 'section' | 'article';
  /** Adds the breathing cyan "this panel is streaming live data right now" ring (.is-live) - opt
   *  in per caller (e.g. tie it to a DataQualityBadge's status === 'LIVE'), never on by default,
   *  so it stays meaningful instead of decorating every panel equally. */
  live?: boolean;
  /** 'flat' (Institutional Detail Page visual fix, dense-data reference: CoinGlass/Koyfin/Arkham):
   *  drops hev-card-v2's gradient background + 16px radius + generous padding entirely - a data-
   *  dense panel (ranking table, heatmap, funding/OI/volume/liquidation chart) reads as one flat
   *  surface with a thin separator instead of a "SaaS card kit" tile. No default border is added
   *  here (unlike the default variant's border-subtle box) - the caller adds its own border-t/
   *  border-b/border-l via className where a separator is actually needed, or none at all when a
   *  grid/gap already does that job, per the specific layout it sits in. Opt-in per caller ONLY -
   *  every other of the 40+ Panel call sites across the app (Pasar/Analisis/Makro/dashboard/etc)
   *  keeps the exact 'default' look untouched. */
  variant?: 'default' | 'flat';
}

export const Panel: React.FC<PanelProps> = ({
  children,
  className = '',
  flush = false,
  as = 'div',
  live = false,
  variant = 'default',
}) => {
  const Tag = as;

  if (variant === 'flat') {
    return <Tag className={`${flush ? '' : 'p-3 sm:p-4'} ${className}`}>{children}</Tag>;
  }

  return (
    <Tag
      // hev-card-v2 (design-system layer, premium redesign v2): every module built on Panel -
      // which is most of the terminal - gets the same glass-gradient card treatment from this one
      // place, instead of each hub re-applying it piecemeal.
      className={`hev-card-v2 ${live ? 'is-live' : ''} border border-[var(--border-subtle)] rounded-[14px] ${
        flush ? '' : 'p-3 sm:p-4'
      } ${className}`}
    >
      {children}
    </Tag>
  );
};

interface PanelHeaderProps {
  title: string;
  /** Small uppercase kicker above the title (e.g. 'MACRO'). */
  eyebrow?: string;
  subtitle?: string;
  /** Right-hand slot for data-quality badges, toggles, or a drill-down link. */
  actions?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  /** 'chart' (editorial-financial chart redesign, Bloomberg Terminal reference): a bolder,
   *  slightly larger title with clearer breathing room above its subtitle - for a header that
   *  directly introduces a LineChart/DualAxisAreaChart (Yield Curve, Real Yield, Treasury/M2,
   *  XAU Futures Curve). Opt-in per caller so the 40+ other panels sharing this same header
   *  (news, tables, alerts, etc.) keep their exact current look - this only changes headers that
   *  explicitly ask for it. */
  titleVariant?: 'default' | 'chart';
}

export const PanelHeader: React.FC<PanelHeaderProps> = ({
  title,
  eyebrow,
  subtitle,
  actions,
  icon,
  className = '',
  titleVariant = 'default',
}) => (
  // flex-wrap + flex-auto on the title block (layout audit fix): a shrink-0 actions slot with an
  // unusually long child - a DataQualityBadge whose source string runs long, e.g.
  // "HEVORA Live Intelligence (AI classification, Gemini)" - used to claim its full natural width
  // unconditionally while the title block (min-w-0, no flex-grow) had nothing forcing it to keep
  // any space at all, so the flex algorithm shrank it to near-zero instead: title, eyebrow and
  // subtitle all rendered in a sliver a few pixels wide, each word wrapping onto its own line
  // (GeopoliticalRiskView was the panel that actually hit this on desktop - its badge is the
  // longest source string in the app - but the bug lived here, not in that one caller).
  // flex-auto (flex: 1 1 auto), NOT flex-1 (flex: 1 1 0%), matters here: a 0% flex-basis makes
  // the browser's line-wrapping test treat this item as contributing ~0 width when deciding
  // whether `actions` fits beside it, so flex-wrap never actually triggered - a first attempt at
  // this fix used flex-1 and still crushed the title on a narrow (390px) viewport with a shorter
  // badge (verified via DevTools: title-block width measured 6.98px). flex-auto's basis reflects
  // this block's real content size, so the wrap test correctly sends `actions` to its own line
  // once there truly isn't room, instead of only ever shrinking this block toward zero.
  <div className={`flex flex-wrap items-start justify-between gap-x-3 gap-y-1 ${className}`}>
    <div className="min-w-0 flex-auto">
      {eyebrow && (
        <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-muted)] mb-1">
          {eyebrow}
        </div>
      )}
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="text-[var(--text-secondary)] shrink-0">{icon}</span>}
        <h2
          className={
            titleVariant === 'chart'
              ? 'text-base font-extrabold tracking-tight text-[var(--text-primary)] truncate'
              : 'text-sm font-bold text-[var(--text-primary)] truncate'
          }
        >
          {title}
        </h2>
      </div>
      {/* line-clamp-1 on mobile (layout audit): a 2-3 sentence subtitle at 11px on a narrow phone
          screen used to wrap across 2-3 lines under every single panel title, pushing real
          content down and making a quick scroll feel like reading a wall of captions instead of
          a terminal. Clamped to one line below the sm breakpoint with the full text still reachable
          via the native title tooltip (tap-and-hold on mobile, hover on desktop) - nothing is
          deleted, it just doesn't force multi-line height at the size it's least readable at.
          Unclamped from sm: up, where the extra width already fits most subtitles on one line
          anyway and the ones that don't have room to wrap without crowding anything out. */}
      {subtitle && (
        <p
          className={`text-[11px] text-[var(--text-secondary)] leading-relaxed line-clamp-1 sm:line-clamp-none ${
            titleVariant === 'chart' ? 'mt-2' : 'mt-1'
          }`}
          title={subtitle}
        >
          {subtitle}
        </p>
      )}
    </div>
    {/* max-w-full (layout audit): once flex-wrap sends this to its own line under the title on a
        narrow panel, shrink-0 alone still let a long DataQualityBadge (or any other actions
        content) overflow straight past the card's edge - .hev-card-v2's own overflow:hidden was
        clipping it mid-word rather than the badge itself wrapping or truncating. Capping to the
        parent's actual width, combined with DataQualityBadge's own flex-wrap below, lets it wrap
        onto a second line instead. */}
    {actions && <div className="shrink-0 flex items-center gap-2 max-w-full">{actions}</div>}
  </div>
);

/** Uppercase category label (§5) used between panel groups. */
export const SectionLabel: React.FC<{ children: React.ReactNode; className?: string }> = ({
  children,
  className = '',
}) => (
  <div
    className={`text-[10px] font-mono font-bold uppercase tracking-[0.2em] text-[var(--text-muted)] ${className}`}
  >
    {children}
  </div>
);

/**
 * A single stat inside a Panel - one light card layer (`bg-surface` + `border-subtle`), never
 * `hev-card-v2` again on top of an already-`hev-card-v2` Panel (§ visual redesign rule: one data
 * element gets one card layer, not two stacked borders/gradients). Shared by every stat-grid
 * across the Institutional Watchlist detail page instead of each caller re-typing its own tile
 * markup - `size="lg"` is the same chrome at a bigger value type, for a 2-4 stat header row that
 * wants to read as a hero number (e.g. funding rate/open interest/long-short ratio) rather than a
 * compact multi-tile grid.
 */
export const StatTile: React.FC<{
  label: string;
  value: string;
  tone?: 'up' | 'down';
  /** Optional line below the value - a static unit ('per 8h'), a signed delta, or a one-line hint. */
  hint?: string;
  hintTone?: 'up' | 'down';
  size?: 'sm' | 'lg';
  /** CoinGlass parity ROUND 2 (Bagian B - "font-black bikin SEMUA angka di halaman ini terasa
   *  gemuk"): value font-weight, default 'bold' (700) instead of the old fixed 'black' (900) -
   *  still tabular-nums and bold enough to anchor a dashboard number, just not the heaviest weight
   *  Tailwind has. Pass 'black' only for a caller that specifically wants the old, heavier look. */
  weight?: 'bold' | 'black';
}> = ({ label, value, tone, hint, hintTone, size = 'sm', weight = 'bold' }) => (
  <div className="bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-[10px] p-2">
    <div className="text-[8px] uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</div>
    <div
      className={`${weight === 'black' ? 'font-black' : 'font-bold'} tabular-nums ${size === 'lg' ? 'text-xl' : 'text-sm'} ${
        tone === 'up' ? 'text-[var(--color-up)]' : tone === 'down' ? 'text-[var(--color-down)]' : 'text-[var(--text-primary)]'
      }`}
    >
      {value}
    </div>
    {hint && (
      <div
        className={`text-[9px] mt-1 ${
          hintTone === 'up' ? 'text-[var(--color-up)]' : hintTone === 'down' ? 'text-[var(--color-down)]' : 'text-[var(--text-muted)]'
        }`}
      >
        {hint}
      </div>
    )}
  </div>
);
