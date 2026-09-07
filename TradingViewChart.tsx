import React, { useEffect, useRef, useState } from 'react';
import { Info, RefreshCw } from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import { UnavailableState } from './ui';

interface TradingViewChartProps {
  symbol: string;
  pairName: string;
}

// The external tv.js script previously had no failure path at all: only `script.onload` was
// wired, so a blocked/unreachable CDN (corporate firewall, ad-blocker, an outage) left the
// skeleton "CHART LOADING..." placeholder spinning forever with no way for a reader to tell the
// difference between "still loading" and "never going to load". This is exactly the "every module
// must render loading/error/unavailable, never get stuck" rule the rest of this app already
// follows (see ui/StateBlock.tsx) - the chart just never had it applied.
const SCRIPT_TIMEOUT_MS = 12_000;

export const TradingViewChart: React.FC<TradingViewChartProps> = ({ symbol, pairName }) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartTheme, setChartTheme] = useState<'light' | 'dark'>(() => {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  });
  // Tracks whether the embedded TradingView widget script has finished mounting, so the frame
  // can show a skeleton placeholder instead of a blank panel while the external script loads
  // (and briefly again on every symbol/theme swap, since the widget is fully re-created below).
  const [chartReady, setChartReady] = useState(false);
  // Set on a real script error, OR when neither onload nor onerror ever fires within
  // SCRIPT_TIMEOUT_MS (some ad-blockers/extensions silently no-op a blocked script instead of
  // firing its error event, which would otherwise look identical to "still loading"). retryToken
  // just needs to change to force the load effect to run again.
  const [chartError, setChartError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          const currentTheme = document.documentElement.getAttribute('data-theme');
          setChartTheme(currentTheme === 'light' ? 'light' : 'dark');
        }
      });
    });

    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.innerHTML = '';
    setChartReady(false);
    setChartError(false);

    let settled = false;
    const markError = () => {
      if (settled) return;
      settled = true;
      setChartError(true);
    };

    // Watchdog: covers the case a plain `script.onerror` misses - some ad-blockers/extensions
    // silently strip or no-op a blocked <script> instead of firing its error event, which would
    // otherwise be visually indistinguishable from "still loading".
    const watchdog = window.setTimeout(markError, SCRIPT_TIMEOUT_MS);

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/tv.js';
    script.async = true;
    script.onerror = markError;
    script.onload = () => {
      if (window.TradingView && containerRef.current) {
        settled = true;
        window.clearTimeout(watchdog);
        const widget = new window.TradingView.widget({
          autosize: true,
          symbol: symbol,
          interval: '5',
          timezone: 'Asia/Jakarta',
          theme: chartTheme,
          style: '1',
          locale: 'en',
          toolbar_bg: chartTheme === 'light' ? '#FFFFFF' : '#0E0E0E',
          enable_publishing: false,
          hide_side_toolbar: false,
          allow_symbol_change: true,
          details: false,
          hotlist: false,
          calendar: false,
          show_popup_button: false,
          container_id: containerRef.current.id,
        });
        // onChartReady exists on the embed widget's API - fall back to a short timeout for any
        // build where it's unavailable, so the skeleton never gets stuck on-screen forever.
        if (widget && typeof widget.onChartReady === 'function') {
          widget.onChartReady(() => setChartReady(true));
        } else {
          setTimeout(() => setChartReady(true), 1200);
        }
      } else {
        // The script loaded but didn't attach the TradingView global - treat it the same as a
        // load failure rather than leaving the skeleton up with nothing to show for it.
        markError();
      }
    };

    containerRef.current.appendChild(script);

    return () => {
      window.clearTimeout(watchdog);
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [symbol, chartTheme, retryToken]);

  const containerId = `tv_chart_${symbol.replace(/[^a-zA-Z0-9]/g, '_')}`;

  return (
    <div
      className={`w-full hev-card-v2 border border-[var(--border-subtle)] rounded-[14px] overflow-hidden transition-all duration-300 ${
        chartError ? 'hev-glow-down' : ''
      }`}
    >
      {/* Chart Top Title Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--bg-surface)] border-b border-[var(--border-subtle)] text-xs font-mono">
        <div className="flex items-center gap-2.5">
          <span className={`w-2 h-2 rounded-full ${chartError ? 'bg-[var(--color-down)]' : 'bg-[#2ECC71] animate-pulse'}`} />
          <span className="font-black text-sm text-[var(--text-primary)] tracking-wide">{pairName}</span>
          <span className="text-[var(--text-muted)]">|</span>
          <span className="text-[var(--text-secondary)] text-xs font-bold">{symbol}</span>
          {/* 2026-08-31 audit (price-source clarity): the header/ticker/watchlist elsewhere on this
              page show a DIFFERENT live feed than this chart - a plain title attribute (on the
              wrapping span, since lucide-react icons don't forward one) is enough to make that
              explicit on hover without adding a new popover component. */}
          <span title={t('market.chartSourceTooltip')} className="cursor-help shrink-0 inline-flex">
            <Info className="w-3.5 h-3.5 text-[var(--text-muted)]" />
          </span>
        </div>
        <div className="flex items-center gap-2.5 text-[var(--text-muted)] text-[11px]">
          {chartReady && !chartError ? (
            <span className="px-2.5 py-0.5 rounded bg-[#2ECC71]/10 border border-[#2ECC71]/20 text-[#2ECC71] font-extrabold tracking-wider">
              LIVE DATA
            </span>
          ) : chartError ? (
            <span className="px-2.5 py-0.5 rounded bg-[var(--color-down)]/10 border border-[var(--color-down)]/20 text-[var(--color-down)] font-extrabold tracking-wider">
              {t('market.chartUnavailableBadge')}
            </span>
          ) : null}
        </div>
      </div>

      {/* TradingView Canvas Frame - Responsive Height Rules */}
      <div className="h-[340px] sm:h-[360px] md:h-[420px] lg:h-[54vh] xl:h-[60vh] w-full relative bg-[var(--bg-base)]">
        {chartError ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            {/* A blocked/errored chart used to leave this whole 60vh frame as a flat black
                rectangle with a tiny compact empty-state floating in the middle - the "kotak
                hitam gede" gap. The empty-state itself (.hev-empty-state) stays untouched; this
                is purely a dead-canvas dressing behind it, the same axis-grid + inert-glow
                treatment a real terminal uses for a disconnected feed instead of a plain void. */}
            <div
              className="absolute inset-0 opacity-[0.05]"
              style={{
                backgroundImage:
                  'linear-gradient(var(--text-muted) 1px, transparent 1px), linear-gradient(90deg, var(--text-muted) 1px, transparent 1px)',
                backgroundSize: '44px 44px',
              }}
            />
            <div
              className="absolute inset-0"
              style={{
                background:
                  'radial-gradient(circle at 50% 42%, color-mix(in srgb, var(--color-down) 7%, transparent), transparent 55%)',
              }}
            />
            <div className="w-full max-w-md relative z-10">
              <UnavailableState
                source="TradingView (s3.tradingview.com)"
                detail={t('market.chartUnavailableDetail')}
                action={
                  <button
                    type="button"
                    onClick={() => setRetryToken((n) => n + 1)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-[var(--border-strong)] bg-[var(--bg-surface)] font-mono text-[10px] font-bold uppercase tracking-wider text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {t('market.chartRetry')}
                  </button>
                }
              />
            </div>
          </div>
        ) : (
          !chartReady && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 pointer-events-none">
              <div className="w-full h-full absolute inset-0 flex flex-col justify-end gap-2 p-6 opacity-70">
                <div className="w-full h-2/5 rounded-lg bg-[var(--border-subtle)] animate-pulse" />
                <div className="flex gap-2 h-16">
                  <div className="flex-1 rounded bg-[var(--border-subtle)] animate-pulse" />
                  <div className="flex-1 rounded bg-[var(--border-subtle)] animate-pulse" style={{ animationDelay: '0.15s' }} />
                  <div className="flex-1 rounded bg-[var(--border-subtle)] animate-pulse" style={{ animationDelay: '0.3s' }} />
                </div>
              </div>
              <div className="relative z-10 flex items-center gap-2 text-[11px] font-mono text-[var(--text-muted)] uppercase tracking-widest bg-[var(--bg-base)]/80 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-[#2ECC71] animate-pulse" />
                {pairName} {t('market.chartLoading')}
              </div>
            </div>
          )
        )}
        <div id={containerId} ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
};

declare global {
  interface Window {
    TradingView: {
      widget: new (config: any) => { onChartReady?: (cb: () => void) => void };
    };
  }
}
