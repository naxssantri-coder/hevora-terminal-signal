import React, { useState, useEffect } from 'react';
import { Newspaper, FileText, Search, Filter, Calendar, Tag, ExternalLink, X, User, TrendingUp, TrendingDown, Minus, Info, ArrowRight } from 'lucide-react';
import { ResearchItem, LiveEvent, LiveEventAssetClass, LiveEventDirection } from '../types';
import { useTranslation } from '../i18n/LanguageContext';

/** Fix round §3 (Live Desk audit): a headline-only news pipeline (`type: 'market_news'`) is only
 *  HALF of what this feed used to require - the other, much larger half of what HEVORA's Live
 *  Intelligence pipeline actually publishes is full-transcript official-institution events
 *  (`speech`/`press_release`/`testimony`/...), which this feed used to filter out entirely. That
 *  made this tab go empty exactly when Live Desk's own newer official-source coverage (Fed/ECB/
 *  BOJ/...) was the only thing actually publishing - a real "News tab looks broken while Live Desk
 *  is full of real content" bug, not a display preference. Same broadened definition Live Desk's
 *  own News mini-panel now uses (see LiveDeskView.tsx's isNewsworthy) - duplicated here rather than
 *  imported since these are two independent page components with no existing shared import between
 *  them. */
function isNewsworthy(e: LiveEvent): boolean {
  return e.type === 'market_news' || e.impact === 'High' || e.impact === 'Medium';
}

type FeedTypeFilter = 'all' | 'news' | 'research';
type CategoryFilter = 'All' | 'Forex' | 'Crypto' | 'Commodities' | 'Macro';

/** The Intel feed mixes two genuinely different record shapes. Automated market news is a
 * LiveEvent of type 'market_news' published by scripts/live-intel-watcher.ts (headline in, AI
 * summary out - see that file's COPYRIGHT block); research is a hand-written ResearchItem from the
 * admin Research Desk. They render as different cards rather than being flattened into one shape. */
export type CombinedIntelItem =
  | { itemType: 'news'; data: LiveEvent }
  | { itemType: 'research'; data: ResearchItem };

/** Maps a news item's asset-class reads onto the existing category filter, so the one dropdown
 * keeps working for both card kinds. Picks the first class with a non-Neutral direction; a story
 * with no directional read at all is Macro. */
const ASSET_CLASS_TO_CATEGORY: Record<LiveEventAssetClass, CategoryFilter> = {
  commodities: 'Commodities',
  crypto: 'Crypto',
  forex: 'Forex',
};

function newsCategory(evt: LiveEvent): CategoryFilter {
  const directional = (evt.assetClassImpacts || []).find((i) => i.direction !== 'Neutral');
  return directional ? ASSET_CLASS_TO_CATEGORY[directional.assetClass] : 'Macro';
}

const DIRECTION_COLOR: Record<LiveEventDirection, string> = {
  Bullish: '#2ECC71',
  Bearish: '#FF4D4F',
  Neutral: '#a1a1aa',
};

const DirectionArrow: React.FC<{ direction: LiveEventDirection; className?: string }> = ({ direction, className }) => {
  if (direction === 'Bullish') return <TrendingUp className={className} />;
  if (direction === 'Bearish') return <TrendingDown className={className} />;
  return <Minus className={className} />;
};

// Impact badge colors for the auto-news cards - purely presentational, mirrors the existing
// sentiment badge treatment used across this page (red=high impact, amber=medium, gray=low). The
// direction-color palette and YouTube-embed helpers used to also live here for the old detail
// modal - both moved to LiveEventDetailPage.tsx along with the modal itself (see App.tsx's
// /intel/live/:id route).
const LIVE_IMPACT_COLOR: Record<string, string> = {
  High: '#FF4D4F',
  Medium: '#F5B942',
  Low: '#a1a1aa',
};

interface IntelViewProps {
  /** Navigates to the full-page Live Intelligence event detail route (/intel/live/:id) - a card
   * click used to open a modal on top of this page; it now navigates away instead (see App.tsx). */
  onNavigateToLiveEvent: (id: string) => void;
}

export const IntelView: React.FC<IntelViewProps> = ({ onNavigateToLiveEvent }) => {
  const { t, language } = useTranslation();
  const [marketNews, setMarketNews] = useState<LiveEvent[]>([]);
  const [research, setResearch] = useState<ResearchItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [feedFilter, setFeedFilter] = useState<FeedTypeFilter>('all');
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<CombinedIntelItem | null>(null);

  const fetchIntel = async () => {
    try {
      const researchRes = await fetch('/api/research');
      if (researchRes.ok) {
        const researchData = await researchRes.json();
        setResearch(Array.isArray(researchData) ? researchData : []);
      }
    } catch (err) {
      console.error('Error fetching Intel feed:', err);
    } finally {
      setLoading(false);
    }
  };

  // Automated news renders as cards in the main feed - filtered client-side from the same
  // /api/live-events endpoint the (now removed) Live Intelligence strip used to also read
  // non-news events from. Broadened (fix round §3) beyond `type === 'market_news'` alone - see
  // isNewsworthy's own doc comment for why that narrower filter was a real bug, not a design
  // choice worth keeping. `marketNews` keeps its name to minimize the diff even though it now
  // also holds institutional speech/press-release events.
  const fetchLiveEvents = async () => {
    try {
      const res = await fetch('/api/live-events?limit=60');
      if (res.ok) {
        const data = await res.json();
        const all: LiveEvent[] = Array.isArray(data?.events) ? data.events : [];
        setMarketNews(all.filter(isNewsworthy));
      }
    } catch (err) {
      console.error('Error fetching Live Intelligence feed:', err);
    }
  };

  useEffect(() => {
    fetchIntel();
    fetchLiveEvents();
    // Live events can arrive at any time from the standalone watcher script - poll gently so a
    // freshly-published event shows up without a manual page refresh.
    const interval = setInterval(fetchLiveEvents, 60000);

    // 2026-08-31 audit (point 4): a backgrounded/minimized tab has this setInterval throttled by
    // the browser, so a reader coming back to the tab can see a news list stuck on whatever it
    // last had until the throttled 60s timer next fires. Refetch immediately on becoming visible
    // again to close that gap (does not change the 60s cadence for a foregrounded tab).
    const onVisible = () => {
      if (document.visibilityState === 'visible') fetchLiveEvents();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Format relative timestamp
  const formatRelativeTime = (isoString: string) => {
    const locale = language === 'id' ? 'id-ID' : 'en-US';
    if (!isoString) return t('intel.justNow');
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    if (isNaN(diffMs) || diffMs < 0) return t('intel.justNow');

    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return t('intel.justNow');
    if (diffMins < 60) return `${diffMins} ${t(diffMins > 1 ? 'intel.minsAgo' : 'intel.minAgo')}`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} ${t(diffHours > 1 ? 'intel.hoursAgo' : 'intel.hourAgo')}`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays} ${t(diffDays > 1 ? 'intel.daysAgo' : 'intel.dayAgo')}`;
    return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  };

  // Combine and sort feeds
  const combinedItems: CombinedIntelItem[] = [
    ...marketNews.map((item) => ({ itemType: 'news' as const, data: item })),
    ...research.map((item) => ({ itemType: 'research' as const, data: item })),
  ].sort((a, b) => {
    const timeA = new Date(a.data.createdAt || 0).getTime();
    const timeB = new Date(b.data.createdAt || 0).getTime();
    return timeB - timeA;
  });

  // Filter items
  const filteredItems = combinedItems.filter((entry) => {
    if (feedFilter === 'news' && entry.itemType !== 'news') return false;
    if (feedFilter === 'research' && entry.itemType !== 'research') return false;

    const entryCategory = entry.itemType === 'news' ? newsCategory(entry.data) : entry.data.category;
    if (categoryFilter !== 'All' && entryCategory !== categoryFilter) return false;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const titleMatch = entry.data.title.toLowerCase().includes(q);
      const summaryMatch = entry.data.summary.toLowerCase().includes(q);
      return titleMatch || summaryMatch;
    }

    return true;
  });

  return (
    <div className="space-y-6 animate-fadeIn font-sans pb-12">
      {/* Header Banner ("Institutional Intel Hub"), Follow Channel Strip ("Ikuti Update &
          Tutorial") and the HEV Live Market Intelligence strip ("Live Intelligence") that used to
          sit here were removed (UI/UX audit, Poin 8) - the page now opens directly on the feed
          filters below. onNavigateToLiveEvent stays a prop (LiveEventDetailPage's /intel/live/:id
          route is still reachable by direct link) even though nothing in this file calls it
          anymore. */}

      {/* News freshness note (2026-08-31 audit): the automated news pipeline
          (scripts/live-intel-watcher.ts) publishes on a ~15-minute scheduled cycle, not a
          continuous/real-time stream - stated explicitly here so a reader never assumes this feed
          updates second-by-second the way the price ticker does. */}
      <div className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)] font-mono px-1">
        <Info className="w-3 h-3 shrink-0" />
        <span>{t('intel.newsFreshnessNote')}</span>
      </div>

      {/* Control Bar: Filters & Search */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[var(--bg-panel)] p-3 rounded-xl border border-[var(--border-subtle)] font-mono text-xs">
        {/* Feed Type Filter Chips */}
        <div className="flex items-center gap-1.5 bg-[var(--bg-surface)] p-1 rounded-lg border border-[var(--border-subtle)]">
          <button
            onClick={() => setFeedFilter('all')}
            className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer ${
              feedFilter === 'all'
                ? 'bg-[var(--text-primary)] text-[var(--bg-base)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
            }`}
          >
            {t('intel.all')} ({combinedItems.length})
          </button>
          <button
            onClick={() => setFeedFilter('news')}
            className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              feedFilter === 'news'
                ? 'bg-[var(--text-primary)] text-[var(--bg-base)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
            }`}
          >
            <Newspaper className="w-3.5 h-3.5" />
            <span>{t('intel.autoNews')} ({marketNews.length})</span>
          </button>
          <button
            onClick={() => setFeedFilter('research')}
            className={`px-3 py-1.5 rounded-md font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              feedFilter === 'research'
                ? 'bg-[var(--text-primary)] text-[var(--bg-base)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{t('intel.research')} ({research.length})</span>
          </button>
        </div>

        {/* Category & Search Filter */}
        <div className="flex items-center gap-2">
          {/* Category Dropdown */}
          <div className="flex items-center gap-1 bg-[var(--bg-surface)] px-2.5 py-1.5 rounded-lg border border-[var(--border-subtle)]">
            <Filter className="w-3.5 h-3.5 text-[var(--text-muted)]" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
              className="bg-transparent text-[var(--text-secondary)] focus:outline-none font-mono text-xs cursor-pointer"
            >
              <option value="All" className="bg-[var(--bg-panel)] text-[var(--text-primary)]">{t('intel.allCategories')}</option>
              <option value="Forex" className="bg-[var(--bg-panel)] text-[var(--text-primary)]">{t('market.forex')}</option>
              <option value="Crypto" className="bg-[var(--bg-panel)] text-[var(--text-primary)]">Crypto</option>
              <option value="Commodities" className="bg-[var(--bg-panel)] text-[var(--text-primary)]">{t('market.commodities')}</option>
              <option value="Macro" className="bg-[var(--bg-panel)] text-[var(--text-primary)]">{t('intel.macro')}</option>
            </select>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 sm:w-48">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              type="text"
              placeholder={t('intel.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-subtle)] rounded-lg pl-8 pr-3 py-1.5 text-xs text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--border-strong)] font-mono"
            />
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3 font-mono">
          <div className="w-7 h-7 border-2 border-[var(--border-subtle)] border-t-[#2ECC71] rounded-full animate-spin" />
          <span className="text-xs text-[var(--text-muted)] tracking-widest uppercase">{t('intel.loading')}</span>
        </div>
      ) : filteredItems.length === 0 ? (
        // Two genuinely different empty states. "Nothing published yet" is a fact about the
        // system; "nothing matches your filters" is a fact about the user's query - showing the
        // second when the first is true reads as if the feature is broken.
        combinedItems.length === 0 ? (
          <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-12 text-center font-mono">
            <Newspaper className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-sm font-bold text-[var(--text-secondary)]">{t('intel.autoNewsEmptyTitle')}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1 max-w-md mx-auto leading-relaxed">{t('intel.autoNewsEmptyBody')}</p>
          </div>
        ) : (
          <div className="hev-card-v2 border border-[var(--border-subtle)] rounded-xl p-12 text-center font-mono">
            <FileText className="w-10 h-10 text-[var(--text-muted)] mx-auto mb-3" />
            <p className="text-sm font-bold text-[var(--text-secondary)]">{t('intel.noResultsTitle')}</p>
            <p className="text-xs text-[var(--text-muted)] mt-1">{t('intel.noResultsBody')}</p>
          </div>
        )
      ) : (
        /* Grid Cards */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4">
          {filteredItems.map((entry) => {
            // ---- Automated market news card. Deliberately a different card from the research one
            // below: a news item has no stored article body to open in a modal (only the headline
            // ever left the source - see the COPYRIGHT block in scripts/live-intel-watcher.ts), so
            // the whole item IS the card, and the only way "deeper" is out to the original source.
            if (entry.itemType === 'news' && entry.data.type !== 'market_news') {
              // ---- Institutional speech/press-release card (fix round §3) - full-transcript
              // official-source events (Fed/ECB/BOJ/... via live-intel-watcher.config.ts), not the
              // headline-only commercial pipeline above. These DO have a real detail page (segments/
              // causal chain/pair impacts - see LiveEventDetailPage.tsx), so unlike the market-news
              // card below, the whole card is clickable through to it - same pattern
              // BreakingNewsView.tsx already uses for this exact event shape.
              const evt = entry.data;
              return (
                <button
                  key={`news-${evt.id}`}
                  type="button"
                  onClick={() => onNavigateToLiveEvent(evt.id)}
                  className="group hev-card-v2 !p-0 border border-[var(--border-subtle)] hover:border-[var(--border-strong)] rounded-[14px] overflow-hidden transition-colors duration-200 flex flex-col text-left hover-lift"
                >
                  <div className="p-3 sm:p-4 space-y-2.5 flex-1 flex flex-col">
                    <div className="flex items-center justify-between gap-2 flex-wrap font-mono text-[10px]">
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-strong)] font-bold uppercase tracking-wider">
                        <span className="hev-logo-mark w-5 h-5 shrink-0" role="img" aria-label="HEVORA" />
                        {t('intel.liveIntelSource')}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-bold px-1.5 py-0.5 rounded text-[9px] uppercase"
                          style={{ color: DIRECTION_COLOR[evt.verdict], backgroundColor: `${DIRECTION_COLOR[evt.verdict]}1A` }}
                        >
                          {evt.verdict}
                        </span>
                        <span
                          className="font-bold px-1.5 py-0.5 rounded text-[9px] uppercase"
                          style={{ color: LIVE_IMPACT_COLOR[evt.impact] || '#a1a1aa', backgroundColor: `${LIVE_IMPACT_COLOR[evt.impact] || '#a1a1aa'}1A` }}
                        >
                          {evt.impact}
                        </span>
                      </div>
                    </div>

                    <h2 className="text-xs sm:text-sm font-bold font-mono text-[var(--text-primary)] leading-snug line-clamp-3">{evt.title}</h2>
                    <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-3">{evt.summary}</p>

                    <div className="flex items-center justify-between gap-2 pt-2 mt-auto border-t border-[var(--border-subtle)] text-[10px] font-mono text-[var(--text-muted)]">
                      <div className="flex items-center gap-1 min-w-0">
                        <Calendar className="w-3 h-3 shrink-0" />
                        <span className="truncate">{formatRelativeTime(evt.createdAt)}</span>
                      </div>
                      <span className="truncate max-w-[110px]">{evt.source || t('intel.autoNewsSource')}</span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[var(--text-primary)]">
                      {t('intel.openEvent')} <ArrowRight className="w-3 h-3" />
                    </span>
                  </div>
                </button>
              );
            }

            if (entry.itemType === 'news') {
              const evt = entry.data;
              const impacts = evt.assetClassImpacts || [];
              return (
                <div
                  key={`news-${evt.id}`}
                  className="group hev-card-v2 !p-0 border border-[var(--border-subtle)] rounded-[14px] overflow-hidden transition-colors duration-200 flex flex-col hover-lift"
                >
                  <div className="p-3 sm:p-4 space-y-2.5 flex-1 flex flex-col">
                    {/* Badge row: brand mark + auto-news label, then verdict/impact */}
                    <div className="flex items-center justify-between gap-2 flex-wrap font-mono text-[10px]">
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-strong)] font-bold uppercase tracking-wider">
                        <span className="hev-logo-mark w-5 h-5 shrink-0" role="img" aria-label="HEVORA" />
                        {t('intel.autoNews')}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-bold px-1.5 py-0.5 rounded text-[9px] uppercase"
                          style={{ color: DIRECTION_COLOR[evt.verdict], backgroundColor: `${DIRECTION_COLOR[evt.verdict]}1A` }}
                        >
                          {evt.verdict}
                        </span>
                        <span
                          className="font-bold px-1.5 py-0.5 rounded text-[9px] uppercase"
                          style={{ color: LIVE_IMPACT_COLOR[evt.impact] || '#a1a1aa', backgroundColor: `${LIVE_IMPACT_COLOR[evt.impact] || '#a1a1aa'}1A` }}
                        >
                          {evt.impact}
                        </span>
                      </div>
                    </div>

                    {/* AI-written title (never the outlet's own headline verbatim) */}
                    <h2 className="text-xs sm:text-sm font-bold font-mono text-[var(--text-primary)] leading-snug line-clamp-3">
                      {evt.title}
                    </h2>

                    {/* AI-written summary */}
                    <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] leading-relaxed line-clamp-3">
                      {evt.summary}
                    </p>

                    {/* Per-asset-class impact row */}
                    {impacts.length > 0 && (
                      <div className="grid grid-cols-3 gap-1.5 pt-1">
                        {impacts.map((imp) => (
                          <div
                            key={imp.assetClass}
                            title={imp.reason || undefined}
                            className="rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] px-1.5 py-1.5 text-center"
                          >
                            <div className="text-[8px] font-mono uppercase tracking-wider text-[var(--text-muted)] truncate">
                              {t(`intel.assetClass.${imp.assetClass}`)}
                            </div>
                            <div
                              className="flex items-center justify-center gap-0.5 mt-0.5 font-bold text-[9px]"
                              style={{ color: DIRECTION_COLOR[imp.direction] }}
                            >
                              <DirectionArrow direction={imp.direction} className="w-2.5 h-2.5" />
                              <span>{imp.direction}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Footer: time + source attribution and outbound link */}
                    <div className="flex items-center justify-between gap-2 pt-2 mt-auto border-t border-[var(--border-subtle)] text-[10px] font-mono text-[var(--text-muted)]">
                      <div className="flex items-center gap-1 min-w-0">
                        <Calendar className="w-3 h-3 shrink-0" />
                        <span className="truncate">{formatRelativeTime(evt.createdAt)}</span>
                      </div>
                      {evt.sourceUrl ? (
                        <a
                          href={evt.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-bold shrink-0 hover:underline"
                        >
                          <span className="truncate max-w-[110px]">{evt.source || t('intel.autoNewsSource')}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="truncate max-w-[110px]">{evt.source || t('intel.autoNewsSource')}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            }

            // ---- Research card (unchanged behaviour: opens the detail modal below)
            const item = entry.data;
            return (
              <div
                key={`research-${item.id}`}
                onClick={() => setSelectedItem(entry)}
                className="group hev-card-v2 !p-0 border border-[var(--border-subtle)] rounded-[14px] overflow-hidden transition-colors duration-200 cursor-pointer flex flex-row sm:flex-col justify-between hover-lift"
              >
                <div className="flex flex-row sm:flex-col min-w-0 flex-1">
                  {item.imageUrl ? (
                    <div className="aspect-[4/5] w-24 sm:w-full shrink-0 overflow-hidden bg-[var(--bg-surface)] relative">
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-panel)] via-transparent to-transparent opacity-80" />
                    </div>
                  ) : (
                    <div className="w-24 sm:w-full aspect-[4/5] sm:aspect-auto sm:h-28 shrink-0 bg-gradient-to-br from-[var(--bg-surface)] via-[var(--bg-panel)] to-[var(--bg-base)] p-2 sm:p-4 flex items-end justify-between border-r sm:border-r-0 sm:border-b border-[var(--border-subtle)] relative overflow-hidden">
                      <div className="absolute right-[-10px] top-[-10px] opacity-10 text-[var(--text-primary)] font-mono font-extrabold text-3xl sm:text-5xl select-none">
                        {item.category}
                      </div>
                      <span className="text-[8px] sm:text-[10px] font-mono tracking-widest text-[var(--text-muted)] uppercase">
                        HEVORA
                      </span>
                    </div>
                  )}

                  <div className="p-2.5 sm:p-4 space-y-1.5 sm:space-y-3 min-w-0 flex-1 flex flex-col justify-between">
                    <div className="space-y-1.5 sm:space-y-3">
                      <div className="flex items-center justify-between flex-wrap gap-1.5 font-mono text-[10px]">
                        <div className="flex items-center gap-1.5">
                          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-strong)] font-bold uppercase tracking-wider">
                            <FileText className="w-2.5 h-2.5" />
                            {t('intel.research')}
                          </span>
                          <span className="px-1.5 sm:px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-strong)] font-semibold text-[9px] sm:text-[10px]">
                            {item.category}
                          </span>
                        </div>
                      </div>

                      <h2 className="text-xs sm:text-sm font-bold font-mono text-[var(--text-primary)] group-hover:underline underline-offset-2 transition-colors line-clamp-2 leading-snug">
                        {item.title}
                      </h2>

                      <p className="text-[11px] sm:text-xs text-[var(--text-secondary)] line-clamp-1 sm:line-clamp-2 leading-relaxed">
                        {item.summary}
                      </p>
                    </div>

                    <div className="flex sm:hidden items-center justify-between text-[9px] font-mono text-[var(--text-muted)] pt-1 border-t border-[var(--border-subtle)]/40 mt-1">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5 text-[var(--text-muted)]" />
                        <span>{formatRelativeTime(item.createdAt)}</span>
                      </div>
                      <span className="truncate max-w-[90px]">{item.author || t('intel.hevoraResearch')}</span>
                    </div>
                  </div>
                </div>

                <div className="hidden sm:flex p-4 pt-0 mt-2 border-t border-[var(--border-subtle)] pt-3 items-center justify-between text-[10px] font-mono text-[var(--text-muted)]">
                  <div className="flex items-center gap-1">
                    <Calendar className="w-3 h-3 text-[var(--text-muted)]" />
                    <span>{formatRelativeTime(item.createdAt)}</span>
                  </div>
                  <div className="flex items-center gap-1 text-[var(--text-secondary)]">
                    <span className="flex items-center gap-1 text-[var(--text-secondary)] font-medium">
                      <User className="w-2.5 h-2.5" />
                      <span>{item.author || t('intel.hevoraResearch')}</span>
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Provenance note - shown whenever automated news is in the feed. Users should be able to
          tell at a glance that these summaries are AI-written rather than the outlet's own words. */}
      {marketNews.length > 0 && (
        <p className="text-[10px] text-[var(--text-muted)] font-mono leading-relaxed text-center px-2">
          {t('intel.autoNewsDisclaimer')}
        </p>
      )}

      {/* Research Detail Modal - research items only. Automated news cards never open this: the
          only article text this system holds for them is the AI's own summary, already shown in
          full on the card, and the original story lives at the source link. */}
      {selectedItem && selectedItem.itemType === 'research' && (
        <div className="fixed inset-0 z-50 bg-[var(--overlay-backdrop)] backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto animate-fadeIn">
          <div className="hev-card-v2 !p-0 border border-[var(--border-strong)] rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto font-sans shadow-2xl relative">
            <div className="sticky top-0 bg-[var(--bg-panel)] backdrop-blur border-b border-[var(--border-subtle)] px-6 py-4 flex items-center justify-between z-20">
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className="px-2.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-strong)] font-bold uppercase tracking-wider">
                  {t('intel.institutionalResearch')}
                </span>
                <span className="text-[var(--text-muted)]">•</span>
                <span className="text-[var(--text-secondary)] font-semibold">{selectedItem.data.category}</span>
              </div>

              <button
                onClick={() => setSelectedItem(null)}
                className="p-1.5 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--card-hover-bg)] transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {selectedItem.data.imageUrl && (
                <div className="rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[var(--bg-surface)] aspect-[4/5] w-full max-h-[500px]">
                  <img
                    src={selectedItem.data.imageUrl}
                    alt={selectedItem.data.title}
                    className="w-full h-full object-cover"
                  />
                </div>
              )}

              <div>
                <h1 className="text-xl md:text-2xl font-bold font-mono text-[var(--text-primary)] leading-tight">
                  {selectedItem.data.title}
                </h1>

                <div className="flex flex-wrap items-center gap-4 mt-3 text-xs font-mono text-[var(--text-muted)] border-b border-[var(--border-subtle)] pb-4">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <span>{new Date(selectedItem.data.createdAt).toLocaleString(language === 'id' ? 'id-ID' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    {t('intel.author')} <span className="text-[var(--text-primary)] font-bold">{selectedItem.data.author || t('intel.hevoraResearchDesk')}</span>
                  </div>
                </div>
              </div>

              <div className="bg-[var(--bg-surface)] border-l-2 border-[var(--text-primary)] p-4 rounded-r-lg text-sm text-[var(--text-secondary)] leading-relaxed">
                <span className="font-mono font-bold text-[var(--text-primary)] text-xs block mb-1">
                  {t('intel.executiveSummary')}
                </span>
                {selectedItem.data.summary}
              </div>

              <div className="text-sm text-[var(--text-secondary)] leading-relaxed space-y-4 pt-2">
                {selectedItem.data.content ? (
                  selectedItem.data.content.split('\n\n').map((paragraph, idx) => (
                    <p key={idx} className="whitespace-pre-line">
                      {paragraph}
                    </p>
                  ))
                ) : (
                  <p className="text-[var(--text-muted)] italic">
                    {t('intel.defaultContent')}
                  </p>
                )}
              </div>

              {selectedItem.data.tags && selectedItem.data.tags.length > 0 && (
                <div className="flex items-center gap-2 pt-2 flex-wrap font-mono text-xs">
                  <Tag className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  {selectedItem.data.tags.map((tag, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-secondary)]">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-[var(--bg-base)] border-t border-[var(--border-subtle)] px-6 py-3.5 flex justify-end font-mono">
              <button
                onClick={() => setSelectedItem(null)}
                className="px-4 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--card-hover-bg)] text-[var(--text-primary)] text-xs font-bold transition-all cursor-pointer border border-[var(--border-subtle)]"
              >
                {t('intel.close')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
