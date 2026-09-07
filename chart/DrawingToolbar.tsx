import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  MousePointer2,
  TrendingUp,
  ArrowUpRight,
  ArrowLeftRight,
  Minus,
  MoveRight,
  SeparatorVertical,
  Square,
  Circle,
  Egg,
  Triangle,
  Spline,
  AlignHorizontalDistributeCenter,
  Percent,
  PercentCircle,
  PercentSquare,
  Type,
  StickyNote,
  Tag,
  Ruler,
  Target,
  Magnet,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Copy,
  Trash2,
  Eraser,
  Undo2,
  Redo2,
  Palette,
  Star,
  X,
  TriangleRight,
  ArrowUp,
  Flag,
  MapPin,
  MessageSquare,
  Signpost,
  Crosshair,
  GitCompare,
  Activity,
  Paintbrush,
  Highlighter,
  CircleDot,
  Radar,
  Fan,
  AlignVerticalDistributeCenter,
  Orbit,
} from 'lucide-react';
import { DrawingObject, DrawingTool, DEFAULT_DRAWING_COLOR, DEFAULT_DRAWING_LINE_WIDTH } from './drawingTypes';
import { DrawingTemplate } from './drawingTemplates';

// Bagian J Tugas 5 (drawing templates/style presets, 2026-09-01): a fixed palette rather than a
// free-form color input - matches this toolbar's existing low-ceremony pattern (window.prompt for
// text tools, window.confirm for clear-all) and every swatch is guaranteed readable against both
// this app's light and dark chart backgrounds, which an arbitrary picked color isn't.
const STYLE_COLOR_PALETTE: readonly string[] = [
  '#F2B84B', '#2ECC71', '#FF4D4F', '#3B82F6', '#A855F7',
  '#EC4899', '#22D3EE', '#F97316', '#FFFFFF', '#94A3B8',
];
const STYLE_LINE_WIDTHS: readonly number[] = [1, 2, 3, 4];

const TOOL_ICON: Record<Exclude<DrawingTool, 'cursor'>, React.ComponentType<{ className?: string }>> = {
  trendline: TrendingUp,
  ray: ArrowUpRight,
  extendedLine: ArrowLeftRight,
  horizontalLine: Minus,
  horizontalRay: MoveRight,
  verticalLine: SeparatorVertical,
  rectangle: Square,
  circle: Circle,
  ellipse: Egg,
  triangle: Triangle,
  polyline: Spline,
  parallelChannel: AlignHorizontalDistributeCenter,
  fibRetracement: Percent,
  fibExtension: PercentCircle,
  fibChannel: PercentSquare,
  text: Type,
  note: StickyNote,
  priceLabel: Tag,
  measure: Ruler,
  position: Target,
  trendAngle: TriangleRight,
  arrowMarker: ArrowUp,
  flagMark: Flag,
  pin: MapPin,
  callout: MessageSquare,
  signpost: Signpost,
  crossline: Crosshair,
  disjointChannel: GitCompare,
  regressionTrend: Activity,
  brush: Paintbrush,
  highlighter: Highlighter,
  fibCircles: CircleDot,
  fibArcs: Radar,
  fibSpeedFan: Fan,
  fibTimeZone: AlignVerticalDistributeCenter,
  fibSpiral: Orbit,
};

const TOOL_LABEL: Record<DrawingTool, string> = {
  cursor: 'Cursor',
  trendline: 'Trend Line',
  ray: 'Ray',
  extendedLine: 'Extended Line',
  horizontalLine: 'Horizontal Line',
  horizontalRay: 'Horizontal Ray',
  verticalLine: 'Vertical Line',
  rectangle: 'Rectangle',
  circle: 'Circle',
  ellipse: 'Ellipse',
  triangle: 'Triangle',
  polyline: 'Polyline',
  parallelChannel: 'Parallel Channel',
  fibRetracement: 'Fib Retracement',
  fibExtension: 'Fib Extension',
  fibChannel: 'Fib Channel',
  text: 'Text',
  note: 'Note',
  priceLabel: 'Price Label',
  measure: 'Measure',
  position: 'Long/Short Position',
  trendAngle: 'Trend Angle',
  arrowMarker: 'Arrow Marker',
  flagMark: 'Flag Mark',
  pin: 'Pin',
  callout: 'Callout',
  signpost: 'Signpost',
  crossline: 'Crossline',
  disjointChannel: 'Disjoint Channel',
  regressionTrend: 'Regression Trend',
  brush: 'Brush',
  highlighter: 'Highlighter',
  fibCircles: 'Fib Circles',
  fibArcs: 'Fib Arcs',
  fibSpeedFan: 'Fib Speed Resistance Fan',
  fibTimeZone: 'Fib Time Zone',
  fibSpiral: 'Fib Spiral',
};

// Grouped/flyout redesign (Bagian I, per the user's own TradingView reference video: a handful of
// category icons in the main rail - "LINES / CHANNELS / MEASURERS"-style - each opening a flyout
// of that category's tools, rather than 20 tools flat-stacked needing internal scroll). Every tool
// still belongs to exactly one category; nothing here changes which tools exist (see Bagian F's own
// TOOL_ORDER in drawingTypes.ts for the authoritative list), only how they're reached.
type ToolCategory = 'lines' | 'channels' | 'fibonacci' | 'shapes' | 'text' | 'markers' | 'measure';

const CATEGORY_ORDER: ToolCategory[] = ['lines', 'channels', 'fibonacci', 'shapes', 'text', 'markers', 'measure'];

const CATEGORY_TOOLS: Record<ToolCategory, Exclude<DrawingTool, 'cursor'>[]> = {
  lines: ['trendline', 'ray', 'extendedLine', 'trendAngle', 'crossline', 'horizontalLine', 'horizontalRay', 'verticalLine'],
  channels: ['parallelChannel', 'disjointChannel', 'fibChannel'],
  fibonacci: ['fibRetracement', 'fibExtension', 'fibCircles', 'fibArcs', 'fibSpeedFan', 'fibTimeZone', 'fibSpiral'],
  shapes: ['rectangle', 'circle', 'ellipse', 'triangle', 'polyline', 'brush', 'highlighter'],
  text: ['text', 'note', 'priceLabel'],
  // Tier 2 markers cluster (Bagian J Tugas 4) - its own category rather than folded into "Text &
  // Labels", since these are icon-first (arrow/flag/pin) with text as an optional add-on for
  // callout/signpost only, not text-first like the existing text/note/priceLabel trio.
  markers: ['arrowMarker', 'flagMark', 'pin', 'callout', 'signpost'],
  measure: ['measure', 'position', 'regressionTrend'],
};

const CATEGORY_LABEL: Record<ToolCategory, string> = {
  lines: 'Line Tools',
  channels: 'Channels',
  fibonacci: 'Fibonacci',
  shapes: 'Shapes',
  text: 'Text & Labels',
  markers: 'Markers',
  measure: 'Measure & Position',
};

// Default (nothing from this category active yet) icon shown on the category's own rail button -
// once a tool from that category becomes the active tool, the rail button swaps to THAT tool's own
// icon instead (see the render below), so the rail always reflects what's actually selected.
const CATEGORY_DEFAULT_ICON: Record<ToolCategory, React.ComponentType<{ className?: string }>> = {
  lines: TrendingUp,
  channels: AlignHorizontalDistributeCenter,
  fibonacci: Percent,
  shapes: Square,
  text: Type,
  markers: MapPin,
  measure: Ruler,
};

function categoryOf(tool: DrawingTool): ToolCategory | null {
  for (const cat of CATEGORY_ORDER) {
    if ((CATEGORY_TOOLS[cat] as DrawingTool[]).includes(tool)) return cat;
  }
  return null;
}

interface DrawingToolbarProps {
  activeTool: DrawingTool;
  onSelectTool: (tool: DrawingTool) => void;
  magnetMode: boolean;
  onToggleMagnet: () => void;
  selectedDrawing: DrawingObject | null;
  /** Right-click-on-a-drawing context menu (2026-09-01) - position in page coordinates, or null
   *  when closed. handleContextMenu in useDrawingTools.ts already selects the right-clicked
   *  drawing at the same time it sets this, so `selectedDrawing` above is always the menu's own
   *  target - no separate "which drawing" prop needed. */
  contextMenu: { x: number; y: number } | null;
  onCloseContextMenu: () => void;
  onToggleLock: () => void;
  onToggleHide: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClearAll: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  /** Bagian J Tugas 5 (drawing templates). `defaultStyle` is null when no template is currently
   *  set as default (falls back to DEFAULT_DRAWING_COLOR/DEFAULT_DRAWING_LINE_WIDTH, same as
   *  before this feature existed). */
  templates: DrawingTemplate[];
  defaultTemplateId: string | null;
  defaultStyle: { color: string; lineWidth: number } | null;
  onUpdateSelectedStyle: (patch: Partial<Pick<DrawingObject, 'color' | 'lineWidth'>>) => void;
  onSaveTemplate: (name: string, color: string, lineWidth: number) => void;
  onDeleteTemplate: (id: string) => void;
  onApplyTemplate: (id: string) => void;
}

/**
 * Vertical left-side toolbar - redesigned (Bagian I) from a flat 20-tool stack into grouped
 * categories with flyouts, matching the user's own TradingView reference video. Every tool listed
 * anywhere here is a genuinely working tool (see useDrawingTools.ts) - no placeholder buttons for
 * tools that don't exist yet. Built on a separate branch, not wired into the production chart
 * route.
 */
export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool,
  onSelectTool,
  magnetMode,
  onToggleMagnet,
  selectedDrawing,
  contextMenu,
  onCloseContextMenu,
  onToggleLock,
  onToggleHide,
  onDuplicate,
  onDelete,
  onClearAll,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  templates,
  defaultTemplateId,
  defaultStyle,
  onUpdateSelectedStyle,
  onSaveTemplate,
  onDeleteTemplate,
  onApplyTemplate,
}) => {
  const [openCategory, setOpenCategory] = useState<ToolCategory | null>(null);
  // Where to portal the open flyout - computed from the trigger button's own on-screen position
  // (see below) rather than relying on CSS `absolute` positioning, because the toolbar rail itself
  // needs `overflow-y-auto` (it can be taller than the chart card, see the root div's own comment)
  // and CSS overflow rules force overflow-x to behave as 'auto' too the moment overflow-y isn't
  // 'visible' - an absolutely-positioned flyout would get clipped by that same scroll container
  // instead of overflowing next to it. Portaling to document.body sidesteps this entirely.
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const categoryButtonRefs = useRef<Partial<Record<ToolCategory, HTMLButtonElement | null>>>({});
  const flyoutRef = useRef<HTMLDivElement>(null);

  // Close the open flyout on an outside click or Escape - same convention already used for the
  // Indicators dropdown in LightweightChart.tsx.
  useEffect(() => {
    if (!openCategory) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (toolbarRef.current?.contains(target) || flyoutRef.current?.contains(target)) return;
      setOpenCategory(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenCategory(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openCategory]);

  // Bagian J Tugas 5 (drawing templates/style presets) - same open/position/outside-click-close
  // pattern as the category flyouts above, kept as its own independent piece of state since the
  // Style flyout isn't a tool category and can be open at the same time none of them are.
  const [styleOpen, setStyleOpen] = useState(false);
  const styleButtonRef = useRef<HTMLButtonElement>(null);
  const styleFlyoutRef = useRef<HTMLDivElement>(null);
  const [styleFlyoutPos, setStyleFlyoutPos] = useState<{ top: number; left: number } | null>(null);

  const effectiveColor = selectedDrawing?.color ?? defaultStyle?.color ?? DEFAULT_DRAWING_COLOR;
  const effectiveWidth = selectedDrawing?.lineWidth ?? defaultStyle?.lineWidth ?? DEFAULT_DRAWING_LINE_WIDTH;

  useEffect(() => {
    if (!styleOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (toolbarRef.current?.contains(target) || styleFlyoutRef.current?.contains(target)) return;
      setStyleOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStyleOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [styleOpen]);

  // Right-click-on-a-drawing context menu (2026-09-01) - same outside-click/Escape-close pattern
  // as the style flyout above, except EVERYTHING outside the menu itself closes it (including a
  // click on the toolbar rail), since unlike the style flyout this isn't opened from a toolbar
  // button in the first place - it's anchored to an arbitrary point on the canvas.
  const contextMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!contextMenu) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (contextMenuRef.current?.contains(target)) return;
      onCloseContextMenu();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseContextMenu();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu, onCloseContextMenu]);

  const activeCategory = categoryOf(activeTool);

  return (
    <div ref={toolbarRef} className="flex flex-col items-center gap-1 py-2 px-1.5 border-r border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 shrink-0 h-full min-h-0 overflow-y-auto">
      <button
        type="button"
        onClick={() => { onSelectTool('cursor'); setOpenCategory(null); }}
        title={TOOL_LABEL.cursor}
        className={`w-8 h-8 flex items-center justify-center rounded transition-colors cursor-pointer ${
          activeTool === 'cursor' ? 'bg-[var(--color-brand)]/20 text-[var(--color-brand)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]'
        }`}
      >
        <MousePointer2 className="w-4 h-4" />
      </button>

      <div className="w-6 h-px bg-[var(--border-subtle)] my-1" />

      {CATEGORY_ORDER.map((cat) => {
        const isActiveCat = activeCategory === cat;
        // Rail icon reflects the actually-active tool once one from this category is picked;
        // otherwise falls back to the category's own representative icon.
        const RailIcon = isActiveCat ? TOOL_ICON[activeTool as Exclude<DrawingTool, 'cursor'>] : CATEGORY_DEFAULT_ICON[cat];
        const isOpen = openCategory === cat;
        return (
          <div key={cat} className="relative">
            <button
              ref={(el) => { categoryButtonRefs.current[cat] = el; }}
              type="button"
              onClick={() => {
                if (openCategory === cat) {
                  setOpenCategory(null);
                  return;
                }
                const rect = categoryButtonRefs.current[cat]?.getBoundingClientRect();
                if (rect) setFlyoutPos({ top: rect.top, left: rect.right + 6 });
                setOpenCategory(cat);
              }}
              title={CATEGORY_LABEL[cat]}
              aria-expanded={isOpen}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors cursor-pointer ${
                isActiveCat || isOpen ? 'bg-[var(--color-brand)]/20 text-[var(--color-brand)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]'
              }`}
            >
              <RailIcon className="w-4 h-4" />
            </button>

            {isOpen && flyoutPos && createPortal(
              <div
                ref={flyoutRef}
                style={{ position: 'fixed', top: flyoutPos.top, left: flyoutPos.left }}
                className="z-[100] w-48 py-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-lg"
              >
                <div className="px-3 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">{CATEGORY_LABEL[cat]}</div>
                {CATEGORY_TOOLS[cat].map((tool) => {
                  const Icon = TOOL_ICON[tool];
                  const isActiveTool = activeTool === tool;
                  return (
                    <button
                      key={tool}
                      type="button"
                      onClick={() => { onSelectTool(tool); setOpenCategory(null); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] font-bold text-left transition-colors cursor-pointer ${
                        isActiveTool ? 'text-[var(--color-brand)] bg-[var(--color-brand)]/10' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      {TOOL_LABEL[tool]}
                    </button>
                  );
                })}
              </div>,
              document.body,
            )}
          </div>
        );
      })}

      <div className="w-6 h-px bg-[var(--border-subtle)] my-1" />

      <button
        type="button"
        onClick={onToggleMagnet}
        title="Magnet mode (snap new points to real candle O/H/L/C)"
        className={`w-8 h-8 flex items-center justify-center rounded transition-colors cursor-pointer ${
          magnetMode ? 'bg-[var(--color-brand)]/20 text-[var(--color-brand)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]'
        }`}
      >
        <Magnet className="w-4 h-4" />
      </button>

      {/* Style/Templates (Bagian J Tugas 5) - edits the SELECTED drawing's color/lineWidth live
          when one is selected; otherwise edits the default style every newly drawn object starts
          with. The rail button's own icon shows the currently effective color as a small dot, so
          the current style is visible without opening the flyout. */}
      <div className="relative">
        <button
          ref={styleButtonRef}
          type="button"
          onClick={() => {
            if (styleOpen) {
              setStyleOpen(false);
              return;
            }
            const rect = styleButtonRef.current?.getBoundingClientRect();
            if (rect) setStyleFlyoutPos({ top: rect.top, left: rect.right + 6 });
            setStyleOpen(true);
          }}
          title="Style & Templates"
          aria-expanded={styleOpen}
          className={`w-8 h-8 flex items-center justify-center rounded transition-colors cursor-pointer relative ${
            styleOpen ? 'bg-[var(--color-brand)]/20 text-[var(--color-brand)]' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]'
          }`}
        >
          <Palette className="w-4 h-4" />
          <span className="absolute bottom-1 right-1 w-1.5 h-1.5 rounded-full border border-[var(--bg-surface)]" style={{ backgroundColor: effectiveColor }} />
        </button>

        {styleOpen && styleFlyoutPos && createPortal(
          <div
            ref={styleFlyoutRef}
            style={{ position: 'fixed', top: styleFlyoutPos.top, left: styleFlyoutPos.left }}
            className="z-[100] w-56 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-lg"
          >
            <div className="px-3 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">
              {selectedDrawing ? 'Warna & Ketebalan (Terpilih)' : 'Default Gambar Baru'}
            </div>
            <div className="px-3 py-1.5 flex items-center gap-1.5 flex-wrap">
              {STYLE_COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => onUpdateSelectedStyle({ color })}
                  title={color}
                  className={`w-5 h-5 rounded-full border-2 cursor-pointer transition-transform ${
                    effectiveColor.toLowerCase() === color.toLowerCase() ? 'border-[var(--text-primary)] scale-110' : 'border-transparent hover:scale-110'
                  }`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="px-3 py-1.5 flex items-center gap-1.5">
              {STYLE_LINE_WIDTHS.map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onUpdateSelectedStyle({ lineWidth: w })}
                  title={`${w}px`}
                  className={`flex-1 h-6 flex items-center justify-center rounded cursor-pointer transition-colors ${
                    effectiveWidth === w ? 'bg-[var(--color-brand)]/20' : 'hover:bg-[var(--bg-panel)]'
                  }`}
                >
                  <span className="w-full rounded-full bg-[var(--text-secondary)]" style={{ height: w }} />
                </button>
              ))}
            </div>
            {!selectedDrawing && (
              <div className="px-3 pb-1 text-[9px] text-[var(--text-muted)] leading-snug">
                Tidak ada gambar terpilih - warna/ketebalan di atas jadi default untuk gambar BARU.
              </div>
            )}

            <div className="w-full h-px bg-[var(--border-subtle)] my-1.5" />
            <div className="px-3 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">Template</div>
            {templates.length === 0 && (
              <div className="px-3 py-1 text-[10px] text-[var(--text-muted)]">Belum ada template tersimpan.</div>
            )}
            <div className="max-h-32 overflow-y-auto">
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold cursor-pointer transition-colors ${
                    defaultTemplateId === tpl.id ? 'text-[var(--color-brand)] bg-[var(--color-brand)]/10' : 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)]'
                  }`}
                  onClick={() => onApplyTemplate(tpl.id)}
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tpl.color }} />
                  <span className="flex-1 truncate text-left">{tpl.name}</span>
                  {defaultTemplateId === tpl.id && <Star className="w-3 h-3 shrink-0 fill-current" />}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteTemplate(tpl.id);
                    }}
                    title="Hapus template"
                    className="shrink-0 text-[var(--text-muted)] hover:text-[var(--color-down)] cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                const name = window.prompt('Nama template:');
                if (name && name.trim()) onSaveTemplate(name.trim(), effectiveColor, effectiveWidth);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-left text-[var(--color-brand)] hover:bg-[var(--color-brand)]/10 transition-colors cursor-pointer"
            >
              + Simpan gaya saat ini
            </button>
          </div>,
          document.body,
        )}
      </div>

      <div className="w-6 h-px bg-[var(--border-subtle)] my-1" />

      {/* Undo/redo act on the drawings history (see useDrawingTools.ts's undo/redo stacks) -
          disabled (not hidden) when there's nothing to undo/redo, same convention as the
          selected-drawing controls below. */}
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo"
        className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
          canUndo ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] cursor-pointer' : 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
        }`}
      >
        <Undo2 className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo"
        className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
          canRedo ? 'text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] cursor-pointer' : 'text-[var(--text-muted)] opacity-40 cursor-not-allowed'
        }`}
      >
        <Redo2 className="w-4 h-4" />
      </button>

      {/* Selected-drawing controls - only shown once something is actually selected, since a
          lock/hide/duplicate/delete button with nothing selected has nothing to act on. */}
      {selectedDrawing && (
        <>
          <div className="w-6 h-px bg-[var(--border-subtle)] my-1" />
          <button type="button" onClick={onToggleLock} title={selectedDrawing.locked ? 'Unlock' : 'Lock'} className="w-8 h-8 flex items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] cursor-pointer">
            {selectedDrawing.locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </button>
          <button type="button" onClick={onToggleHide} title={selectedDrawing.hidden ? 'Show' : 'Hide'} className="w-8 h-8 flex items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] cursor-pointer">
            {selectedDrawing.hidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button type="button" onClick={onDuplicate} title="Duplicate" className="w-8 h-8 flex items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] cursor-pointer">
            <Copy className="w-4 h-4" />
          </button>
          <button type="button" onClick={onDelete} title="Delete" className="w-8 h-8 flex items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--color-down)]/10 hover:text-[var(--color-down)] cursor-pointer">
            <Trash2 className="w-4 h-4" />
          </button>
        </>
      )}

      {/* Remove-all - always visible (unlike the selected-drawing controls above, this doesn't
          need anything selected), pinned to the bottom of the rail matching the trash-can position
          in the user's own TradingView reference video. Confirms first (native window.confirm,
          same low-ceremony pattern already used for the text/note tools' window.prompt) so an
          accidental click can't wipe every drawing on the chart. */}
      <div className="mt-auto pt-1">
        <div className="w-6 h-px bg-[var(--border-subtle)] mb-1" />
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Hapus semua gambar di chart ini?')) onClearAll();
          }}
          title="Hapus semua drawing"
          className="w-8 h-8 flex items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--color-down)]/10 hover:text-[var(--color-down)] cursor-pointer"
        >
          <Eraser className="w-4 h-4" />
        </button>
      </div>

      {/* Right-click-on-a-drawing context menu (2026-09-01) - the same color/width controls and
          lock/hide/duplicate/delete actions the toolbar rail above already offers for whatever's
          selected, just anchored at the click instead of requiring a trip to the rail - the
          discoverable, TradingView-shaped gesture for "change THIS drawing" rather than only ever
          being able to set style for new drawings by default. Position is clamped to the viewport
          (a right-click near the right/bottom edge of the chart is completely ordinary) and
          portaled to document.body for the same overflow-clipping reason the style flyout is. */}
      {contextMenu && selectedDrawing && createPortal(
        <div
          ref={contextMenuRef}
          style={{
            position: 'fixed',
            top: Math.min(contextMenu.y, window.innerHeight - 260),
            left: Math.min(contextMenu.x, window.innerWidth - 200),
          }}
          className="z-[100] w-48 py-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] shadow-lg"
        >
          <div className="px-3 py-1 text-[9px] font-black uppercase tracking-wider text-[var(--text-muted)]">
            {TOOL_LABEL[selectedDrawing.tool]}
          </div>
          <div className="px-3 py-1.5 flex items-center gap-1.5 flex-wrap">
            {STYLE_COLOR_PALETTE.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onUpdateSelectedStyle({ color })}
                title={color}
                className={`w-5 h-5 rounded-full border-2 cursor-pointer transition-transform ${
                  selectedDrawing.color.toLowerCase() === color.toLowerCase() ? 'border-[var(--text-primary)] scale-110' : 'border-transparent hover:scale-110'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
          <div className="px-3 py-1.5 flex items-center gap-1.5">
            {STYLE_LINE_WIDTHS.map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => onUpdateSelectedStyle({ lineWidth: w })}
                title={`${w}px`}
                className={`flex-1 h-6 flex items-center justify-center rounded cursor-pointer transition-colors ${
                  selectedDrawing.lineWidth === w ? 'bg-[var(--color-brand)]/20' : 'hover:bg-[var(--bg-panel)]'
                }`}
              >
                <span className="w-full rounded-full bg-[var(--text-secondary)]" style={{ height: w }} />
              </button>
            ))}
          </div>
          <div className="w-full h-px bg-[var(--border-subtle)] my-1.5" />
          <button
            type="button"
            onClick={() => { onToggleLock(); onCloseContextMenu(); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-left text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            {selectedDrawing.locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            {selectedDrawing.locked ? 'Unlock' : 'Lock'}
          </button>
          <button
            type="button"
            onClick={() => { onToggleHide(); onCloseContextMenu(); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-left text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            {selectedDrawing.hidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {selectedDrawing.hidden ? 'Show' : 'Hide'}
          </button>
          <button
            type="button"
            onClick={() => { onDuplicate(); onCloseContextMenu(); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-left text-[var(--text-secondary)] hover:bg-[var(--bg-panel)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => { onDelete(); onCloseContextMenu(); }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] font-bold text-left text-[var(--color-down)] hover:bg-[var(--color-down)]/10 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
};
