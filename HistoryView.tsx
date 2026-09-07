import React, { useState, useEffect, useMemo, useRef } from 'react';
import { HistorySummary, SignalHistoryRecord, PairId } from '../types';
import {
  TrendingUp,
  AlertTriangle,
  BarChart2,
  Filter,
  Layers,
  RefreshCw,
  FileText,
  Image as ImageIcon,
  PieChart,
  Info,
  Target,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { useTranslation } from '../i18n/LanguageContext';
import { GaugeRadial, type GaugeZone } from './viz';
import { useHorizontalChartScroll } from './charts/useHorizontalChartScroll';

interface HistoryViewProps {
  onSelectPair?: (pairId: PairId) => void;
  onNavigateToSignal?: () => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({ onSelectPair, onNavigateToSignal }) => {
  type PeriodOption = 'today' | 'week' | 'month' | 'all';

  const { t, language } = useTranslation();
  const locale = language === 'id' ? 'id-ID' : 'en-US';

  const [historyRecords, setHistoryRecords] = useState<SignalHistoryRecord[]>([]);
  const [rawSummary, setRawSummary] = useState<HistorySummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedPair, setSelectedPair] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<PeriodOption>('all');
  const [hoveredPoint, setHoveredPoint] = useState<{ x: number; y: number; date: string; pair: string; pnl: number; cum: number } | null>(null);
  const [showMetricTooltip, setShowMetricTooltip] = useState<boolean>(false);

  const fetchHistory = async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams();
      if (selectedPair !== 'all') queryParams.append('pairId', selectedPair);
      if (selectedCategory !== 'all') queryParams.append('category', selectedCategory);

      const res = await fetch(`/api/history?${queryParams.toString()}`);
      if (!res.ok) throw new Error(t('history.fetchError'));
      const data = await res.json();
      if (data.success) {
        setHistoryRecords(data.history || []);
        setRawSummary(data.summary || null);
      } else {
        throw new Error(data.error || 'Response error');
      }
    } catch (err: any) {
      setError(err?.message || t('history.genericError'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [selectedPair, selectedCategory]);

  // Client-side Period Filtering based on user device local time
  const periodFilteredRecords = useMemo(() => {
    if (selectedPeriod === 'all') return historyRecords;

    const now = new Date();

    return historyRecords.filter((r) => {
      const dateStr = r.closedAt || r.createdAt;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return false;

      if (selectedPeriod === 'today') {
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        );
      }

      if (selectedPeriod === 'week') {
        const diffMs = now.getTime() - d.getTime();
        return diffMs >= 0 && diffMs <= 7 * 24 * 60 * 60 * 1000;
      }

      if (selectedPeriod === 'month') {
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth()
        );
      }

      return true;
    });
  }, [historyRecords, selectedPeriod]);

  // Dynamically recalculated summary for filtered period.
  //
  // ROOT CAUSE (bug report: "Total Sinyal = 5" but "Rasio Kategori Aset" showed 0% for every
  // category): this block read `r.assetCategory`, a field that does not exist on
  // SignalHistoryRecord (see types.ts - the real field is `r.category`). That property access
  // silently evaluated to `undefined` (no TS error, since @types/react/@types/react-dom were
  // never installed in this project, so useMemo/useState effectively typed everything `any` and
  // no property-existence check ever ran on this file - now fixed by installing those types).
  // `cat` was always undefined, so `catBreakdown[cat]` never matched and every category count
  // stayed 0 while totalSignals (a plain array length, unaffected by this bug) kept counting
  // correctly - hence the mismatch in the screenshot. Fixed below to `r.category`.
  //
  // While rewriting this block, also aligned every win/non-loss definition to match
  // buildHistorySummaryResponse() in server.ts exactly (wins = pnlRMultiple>0 || pnlPips>0,
  // non-loss = outcomeCategory not Direct SL/Stop Loss Hit, both over non-Invalidated records
  // only) - previously this client-side recompute used a different, bucket-count-based formula
  // that happened to make winRate and nonLossRate always render the identical number (a second,
  // less visible symptom of the same "two independent, disagreeing implementations" problem),
  // and used the wrong denominator (all records including Invalidated) for category/pair win
  // rates. Now the "Semua" (server-supplied) view and every period-filtered view use one
  // canonical formula, so they can never silently disagree with each other again.
  const summary = useMemo<HistorySummary | null>(() => {
    if (!periodFilteredRecords) return rawSummary;

    const totalSignals = periodFilteredRecords.length;
    let fullTpCount = 0;
    let tp1SlCount = 0;
    let directSlCount = 0;
    let invalidatedCount = 0;
    let totalRMultiple = 0;
    let winsCount = 0;
    let nonLossCount = 0;
    let validEvaluatedCount = 0;

    const catBreakdown = {
      commodities: { count: 0, wins: 0, nonLoss: 0, valid: 0, rMultiple: 0 },
      crypto: { count: 0, wins: 0, nonLoss: 0, valid: 0, rMultiple: 0 },
      forex: { count: 0, wins: 0, nonLoss: 0, valid: 0, rMultiple: 0 },
    };

    const pairBreakdownMap: Record<string, { count: number; wins: number; nonLoss: number; valid: number; totalRMultiple: number }> = {};

    periodFilteredRecords.forEach((r) => {
      const rVal = r.pnlRMultiple || 0;
      totalRMultiple += rVal;

      // Outcome bucket - every record falls into exactly one of these 4 (the final `else` is a
      // catch-all), so fullTpCount + tp1SlCount + directSlCount + invalidatedCount always equals
      // totalSignals by construction. A split TP1-then-SL/TP2 signal produces 2 separate history
      // records upstream (recordCompletedSignalToHistory in server.ts) and both flow through
      // this same loop independently, so both are counted here - never just one, and never
      // folded into Direct SL.
      if (r.outcomeCategory === 'Full TP' || r.outcomeCategory === 'TP2 Hit' || r.outcomeCategory === 'TP2 Final Close') {
        fullTpCount++;
      } else if (
        r.outcomeCategory === 'TP1 then SL' ||
        r.outcomeCategory === 'TP1 Partial Close' ||
        r.outcomeCategory === 'TP1 Partial + Breakeven' ||
        r.outcomeCategory === 'TP1 Partial + Stop Loss'
      ) {
        tp1SlCount++;
      } else if (r.outcomeCategory === 'Direct SL' || r.outcomeCategory === 'Stop Loss Hit' || r.outcomeCategory === 'Remaining Position Closed') {
        directSlCount++;
      } else {
        invalidatedCount++;
      }

      const isInvalidated = r.outcomeCategory === 'Invalidated';
      const isWin = (r.pnlRMultiple || 0) > 0 || (r.pnlPips || 0) > 0;
      const isDirectLoss = r.outcomeCategory === 'Direct SL' || r.outcomeCategory === 'Stop Loss Hit';

      if (!isInvalidated) {
        validEvaluatedCount++;
        if (isWin) winsCount++;
        if (!isDirectLoss) nonLossCount++;
      }

      const cat = r.category;
      if (cat && catBreakdown[cat]) {
        catBreakdown[cat].count++;
        catBreakdown[cat].rMultiple += rVal;
        if (!isInvalidated) {
          catBreakdown[cat].valid++;
          if (isWin) catBreakdown[cat].wins++;
          if (!isDirectLoss) catBreakdown[cat].nonLoss++;
        }
      }

      if (r.pairId) {
        if (!pairBreakdownMap[r.pairId]) {
          pairBreakdownMap[r.pairId] = { count: 0, wins: 0, nonLoss: 0, valid: 0, totalRMultiple: 0 };
        }
        const pb = pairBreakdownMap[r.pairId];
        pb.count++;
        pb.totalRMultiple += rVal;
        if (!isInvalidated) {
          pb.valid++;
          if (isWin) pb.wins++;
          if (!isDirectLoss) pb.nonLoss++;
        }
      }
    });

    const winRate = validEvaluatedCount > 0 ? Number(((winsCount / validEvaluatedCount) * 100).toFixed(1)) : 0;
    const nonLossRate = validEvaluatedCount > 0 ? Number(((nonLossCount / validEvaluatedCount) * 100).toFixed(1)) : 0;
    // Mirrors server.ts avgRiskReward exactly (avg realized R-multiple per record). No demo
    // fallback - genuinely no data yet renders 0, not a made-up example number.
    const avgRiskReward = totalSignals > 0 ? Number((totalRMultiple / totalSignals).toFixed(2)) : 0;

    const buildCatBreakdown = (cat: { count: number; wins: number; nonLoss: number; valid: number; rMultiple: number }) => ({
      count: cat.count,
      winRate: cat.valid > 0 ? Number(((cat.wins / cat.valid) * 100).toFixed(1)) : 0,
      nonLossRate: cat.valid > 0 ? Number(((cat.nonLoss / cat.valid) * 100).toFixed(1)) : 0,
      rMultiple: Number(cat.rMultiple.toFixed(2)),
    });

    const pairBreakdown: Record<PairId, { count: number; winRate: number; nonLossRate: number; totalRMultiple: number; avgRMultiple: number }> = {} as any;
    Object.keys(pairBreakdownMap).forEach((pid) => {
      const p = pairBreakdownMap[pid];
      pairBreakdown[pid as PairId] = {
        count: p.count,
        winRate: p.valid > 0 ? Number(((p.wins / p.valid) * 100).toFixed(1)) : 0,
        nonLossRate: p.valid > 0 ? Number(((p.nonLoss / p.valid) * 100).toFixed(1)) : 0,
        totalRMultiple: Number(p.totalRMultiple.toFixed(2)),
        avgRMultiple: p.count > 0 ? Number((p.totalRMultiple / p.count).toFixed(2)) : 0,
      };
    });

    return {
      totalSignals,
      winRate,
      nonLossRate,
      fullTpCount,
      tp1SlCount,
      directSlCount,
      invalidatedCount,
      avgRiskReward,
      totalRMultiple: Number(totalRMultiple.toFixed(2)),
      categoryBreakdown: {
        commodities: buildCatBreakdown(catBreakdown.commodities),
        crypto: buildCatBreakdown(catBreakdown.crypto),
        forex: buildCatBreakdown(catBreakdown.forex),
      },
      pairBreakdown,
    };
  }, [periodFilteredRecords, rawSummary]);

  // Derived Financial Metrics (Gross Profit, Gross Loss, Profit Factor)
  const { grossProfitR, grossLossR, profitFactor, sortedChronologicalRecords, cumulativePoints } = useMemo(() => {
    let gp = 0;
    let gl = 0;

    periodFilteredRecords.forEach((r) => {
      const val = r.pnlRMultiple || 0;
      if (val > 0) gp += val;
      if (val < 0) gl += Math.abs(val);
    });

    const pf = gl > 0 ? (gp / gl).toFixed(2) : gp > 0 ? '∞' : '0.00';

    // Chronological sorting for cumulative equity curve (oldest to newest)
    const sorted = [...periodFilteredRecords].sort((a, b) => new Date(a.closedAt || a.createdAt).getTime() - new Date(b.closedAt || b.createdAt).getTime());

    let currentCum = 0;
    const points = [{ x: 0, y: 0, date: 'Baseline', pair: 'Initial', pnl: 0, cum: 0 }];

    sorted.forEach((r, idx) => {
      currentCum += r.pnlRMultiple || 0;
      points.push({
        x: idx + 1,
        y: currentCum,
        date: r.closedAt || r.createdAt,
        pair: r.pairName,
        pnl: r.pnlRMultiple || 0,
        cum: Number(currentCum.toFixed(2)),
      });
    });

    return {
      grossProfitR: Number(gp.toFixed(2)),
      grossLossR: Number(gl.toFixed(2)),
      profitFactor: pf,
      sortedChronologicalRecords: sorted,
      cumulativePoints: points,
    };
  }, [periodFilteredRecords]);

  // Record yang ditampilkan di tabel scroll (sembunyikan Invalidated karena sinyal batal sebelum entry)
  const tableRecords = useMemo(() => {
    return periodFilteredRecords.filter((record) => record.outcomeCategory !== 'Invalidated');
  }, [periodFilteredRecords]);

  // Weekly Performance Breakdown - deliberately built from historyRecords (the full pair/category-
  // filtered dataset), NOT periodFilteredRecords, so the Today/This Week/This Month quick-filter
  // buttons don't collapse this trend chart down to a single near-empty bar. Groups every closed
  // record into its Monday-start week and nets the R-multiple + win rate per week, same win/non-
  // loss formula as the summary above (wins = pnlRMultiple>0 || pnlPips>0, over non-Invalidated
  // records only). Last 8 weeks with data are shown, oldest to newest.
  const weeklyBreakdown = useMemo(() => {
    const buckets = new Map<string, { weekStart: Date; wins: number; valid: number; rMultiple: number; count: number }>();

    historyRecords.forEach((r) => {
      const dateStr = r.closedAt || r.createdAt;
      if (!dateStr) return;
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return;

      const day = d.getDay(); // 0=Sun..6=Sat
      const diffToMonday = day === 0 ? -6 : 1 - day;
      const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diffToMonday);
      const key = monday.toISOString().slice(0, 10);

      if (!buckets.has(key)) buckets.set(key, { weekStart: monday, wins: 0, valid: 0, rMultiple: 0, count: 0 });
      const b = buckets.get(key)!;

      const isInvalidated = r.outcomeCategory === 'Invalidated';
      const isWin = (r.pnlRMultiple || 0) > 0 || (r.pnlPips || 0) > 0;
      b.count++;
      b.rMultiple += r.pnlRMultiple || 0;
      if (!isInvalidated) {
        b.valid++;
        if (isWin) b.wins++;
      }
    });

    const sorted = Array.from(buckets.values()).sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime());

    return sorted.slice(-8).map((b) => ({
      label: b.weekStart.toLocaleDateString(locale, { month: 'short', day: 'numeric' }),
      winRate: b.valid > 0 ? Math.round((b.wins / b.valid) * 100) : 0,
      rMultiple: Number(b.rMultiple.toFixed(2)),
      count: b.count,
    }));
  }, [historyRecords, locale]);

  // Donut Arc Generator Math
  const getDonutArcs = (data: { label: string; value: number; color: string }[], radius = 42, cx = 50, cy = 50, innerRadius = 26) => {
    const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
    let accumulatedAngle = -Math.PI / 2;

    return data.map((item) => {
      const angle = (item.value / total) * Math.PI * 2;
      const startAngle = accumulatedAngle;
      const endAngle = accumulatedAngle + angle;
      accumulatedAngle = endAngle;

      if (item.value === 0) {
        return { ...item, percentage: '0.0', pathData: '' };
      }

      const x1 = cx + radius * Math.cos(startAngle);
      const y1 = cy + radius * Math.sin(startAngle);
      const x2 = cx + radius * Math.cos(endAngle);
      const y2 = cy + radius * Math.sin(endAngle);

      const x3 = cx + innerRadius * Math.cos(endAngle);
      const y3 = cy + innerRadius * Math.sin(endAngle);
      const x4 = cx + innerRadius * Math.cos(startAngle);
      const y4 = cy + innerRadius * Math.sin(startAngle);

      const largeArc = angle > Math.PI ? 1 : 0;

      const pathData = item.value === total
        ? `M ${cx - radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx + radius} ${cy} A ${radius} ${radius} 0 1 0 ${cx - radius} ${cy} Z M ${cx - innerRadius} ${cy} A ${innerRadius} ${innerRadius} 0 1 1 ${cx + innerRadius} ${cy} A ${innerRadius} ${innerRadius} 0 1 1 ${cx - innerRadius} ${cy} Z`
        : `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${x4} ${y4} Z`;

      return {
        ...item,
        percentage: ((item.value / total) * 100).toFixed(1),
        pathData,
      };
    });
  };

  // Ring-segment geometry for the on-screen donuts (premium "activity ring" look: rounded,
  // gapped stroke segments instead of flat pie wedges). Purely a rendering-layer transform over
  // the exact same categoryDonutData/winLossDonutData values already computed by getDonutArcs
  // above - .value/.color/.percentage/.label are untouched and still feed the PNG export's own
  // canvas-drawn donuts (drawDonut) unchanged, only the on-screen <svg> markup changes.
  const RING_RADIUS = 40;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
  const getRingSegments = (data: { label: string; value: number; color: string; percentage: string }[]) => {
    const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
    const nonZeroCount = data.filter((d) => d.value > 0).length;
    const gapDeg = nonZeroCount > 1 ? 3 : 0;
    let cumulativeDeg = -90; // start at 12 o'clock, matches the old -rotate-90 SVG transform

    return data.map((d) => {
      if (d.value <= 0) return { ...d, dashArray: `0 ${RING_CIRCUMFERENCE}`, rotation: 0 };
      const fullDeg = (d.value / total) * 360;
      const segDeg = Math.max(0, fullDeg - gapDeg);
      const segLen = (segDeg / 360) * RING_CIRCUMFERENCE;
      const rotation = cumulativeDeg;
      cumulativeDeg += fullDeg;
      return { ...d, dashArray: `${segLen} ${RING_CIRCUMFERENCE - segLen}`, rotation };
    });
  };

  // Donut Arcs Data
  const categoryDonutData = useMemo(() => {
    if (!summary) return [];
    return getDonutArcs([
      { label: t('market.commodities'), value: summary.categoryBreakdown?.commodities?.count || 0, color: '#F5B942' },
      { label: t('market.cryptoFutures'), value: summary.categoryBreakdown?.crypto?.count || 0, color: '#3B82F6' },
      { label: t('history.forexSpot'), value: summary.categoryBreakdown?.forex?.count || 0, color: '#2ECC71' },
    ]);
  }, [summary, t]);

  const winLossDonutData = useMemo(() => {
    if (!summary) return [];
    return getDonutArcs([
      { label: t('history.legendFullTp'), value: summary.fullTpCount || 0, color: '#2ECC71' },
      { label: t('history.legendTp1Sl'), value: summary.tp1SlCount || 0, color: '#3B82F6' },
      { label: t('history.legendDirectSl'), value: summary.directSlCount || 0, color: '#FF4D4F' },
      { label: t('history.legendInvalidated'), value: summary.invalidatedCount || 0, color: '#6F6F6F' },
    ]);
  }, [summary, t]);

  // High Resolution Canvas PNG Generator
  const handleExportPNG = () => {
    const canvas = document.createElement('canvas');
    const width = 1200;
    const height = 1350;
    canvas.width = width * 2; // 2x resolution
    canvas.height = height * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.scale(2, 2);

    // Background
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, width, height);

    // Watermark
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    ctx.font = '900 120px monospace';
    ctx.fillText('HEVORA', 60, 200);
    ctx.fillText('HEVORA', width - 500, height - 100);

    // Outer Border
    ctx.strokeStyle = '#202020';
    ctx.lineWidth = 1;
    ctx.strokeRect(20, 20, width - 40, height - 40);

    // Header Box
    ctx.fillStyle = '#0E0E0E';
    ctx.fillRect(40, 40, width - 80, 90);
    ctx.strokeStyle = '#252525';
    ctx.strokeRect(40, 40, width - 80, 90);

    // Brand Title
    ctx.fillStyle = '#2ECC71';
    ctx.font = 'bold 22px monospace';
    ctx.fillText('HEVORA SIGNAL TERMINAL', 60, 75);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = '14px sans-serif';
    ctx.fillText(`${t('history.headerTitle').toUpperCase()} PERFORMANCE REPORT`, 60, 102);

    ctx.fillStyle = '#9D9D9D';
    ctx.font = '12px monospace';
    ctx.fillText(`${t('history.pngGenerated')} ${new Date().toLocaleString(locale)} | ${t('history.pngOfficialAudit')}`, width - 480, 88);

    // 4 KPI Cards
    const cardW = (width - 80 - 45) / 4;
    const cardY = 150;
    const cardH = 110;

    const kpiData = [
      { title: t('history.pngWinRateSystem'), val: `${summary?.winRate || 0}%`, sub: `${(summary?.fullTpCount || 0) + (summary?.tp1SlCount || 0)} ${t('history.pngWin')} / ${summary?.directSlCount || 0} ${t('history.pngLoss')}`, color: '#2ECC71' },
      { title: t('history.totalNetPnl'), val: `${(summary?.totalRMultiple || 0) >= 0 ? '+' : ''}${summary?.totalRMultiple || 0} R`, sub: `${t('history.pngProfit')} +${grossProfitR}R | ${t('history.pngLossLabel')} -${grossLossR}R`, color: (summary?.totalRMultiple || 0) >= 0 ? '#2ECC71' : '#FF4D4F' },
      { title: t('history.profitFactor'), val: profitFactor, sub: t('history.profitFactorSub'), color: '#3B82F6' },
      { title: t('history.pngTotalSignals'), val: `${summary?.totalSignals || 0}`, sub: `${summary?.invalidatedCount || 0} ${t('history.invalidatedDiscarded')}`, color: '#3B82F6' },
    ];

    kpiData.forEach((kpi, i) => {
      const cx = 40 + i * (cardW + 15);
      ctx.fillStyle = '#0E0E0E';
      ctx.fillRect(cx, cardY, cardW, cardH);
      ctx.strokeStyle = '#202020';
      ctx.strokeRect(cx, cardY, cardW, cardH);

      ctx.fillStyle = '#9D9D9D';
      ctx.font = '10px monospace';
      ctx.fillText(kpi.title, cx + 15, cardY + 28);

      ctx.fillStyle = kpi.color;
      ctx.font = 'bold 24px monospace';
      ctx.fillText(kpi.val, cx + 15, cardY + 62);

      ctx.fillStyle = '#6F6F6F';
      ctx.font = '10px sans-serif';
      ctx.fillText(kpi.sub, cx + 15, cardY + 90);
    });

    // Equity Curve Box
    const chartY = 280;
    const chartH = 240;
    ctx.fillStyle = '#0E0E0E';
    ctx.fillRect(40, chartY, width - 80, chartH);
    ctx.strokeStyle = '#202020';
    ctx.strokeRect(40, chartY, width - 80, chartH);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`${t('history.equityCurveTitle')} (R-MULTIPLE)`, 60, chartY + 30);

    // Draw Line Chart on Canvas with Area Fill
    if (cumulativePoints.length > 1) {
      const chartInnerX = 80;
      const chartInnerY = chartY + 50;
      const chartInnerW = width - 160;
      const chartInnerH = chartH - 70;

      const minY = Math.min(0, ...cumulativePoints.map(p => p.cum));
      const maxY = Math.max(0, ...cumulativePoints.map(p => p.cum));
      const rangeY = (maxY - minY) || 1;

      // Zero line Y
      const zeroY = chartInnerY + chartInnerH - ((0 - minY) / rangeY) * chartInnerH;

      ctx.save();

      // Horizontal background gridlines (Bloomberg Terminal style)
      [0.2, 0.4, 0.6, 0.8].forEach((ratio) => {
        const gy = chartInnerY + chartInnerH * ratio;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(chartInnerX, gy);
        ctx.lineTo(chartInnerX + chartInnerW, gy);
        ctx.stroke();
        ctx.setLineDash([]);
      });

      // Zero reference dashed line
      ctx.strokeStyle = '#333333';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(chartInnerX, zeroY);
      ctx.lineTo(chartInnerX + chartInnerW, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Green Fill Area above zero line
      ctx.save();
      ctx.beginPath();
      ctx.rect(chartInnerX, chartInnerY - 5, chartInnerW, zeroY - chartInnerY + 5);
      ctx.clip();

      const greenGrad = ctx.createLinearGradient(0, chartInnerY, 0, zeroY);
      greenGrad.addColorStop(0, 'rgba(46, 204, 113, 0.35)');
      greenGrad.addColorStop(1, 'rgba(46, 204, 113, 0.02)');
      ctx.fillStyle = greenGrad;

      ctx.beginPath();
      cumulativePoints.forEach((p, idx) => {
        const px = chartInnerX + (idx / (cumulativePoints.length - 1)) * chartInnerW;
        const py = chartInnerY + chartInnerH - ((p.cum - minY) / rangeY) * chartInnerH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineTo(chartInnerX + chartInnerW, zeroY);
      ctx.lineTo(chartInnerX, zeroY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // Red Fill Area below zero line
      ctx.save();
      ctx.beginPath();
      ctx.rect(chartInnerX, zeroY, chartInnerW, chartInnerY + chartInnerH - zeroY + 5);
      ctx.clip();

      const redGrad = ctx.createLinearGradient(0, zeroY, 0, chartInnerY + chartInnerH);
      redGrad.addColorStop(0, 'rgba(255, 77, 79, 0.02)');
      redGrad.addColorStop(1, 'rgba(255, 77, 79, 0.35)');
      ctx.fillStyle = redGrad;

      ctx.beginPath();
      cumulativePoints.forEach((p, idx) => {
        const px = chartInnerX + (idx / (cumulativePoints.length - 1)) * chartInnerW;
        const py = chartInnerY + chartInnerH - ((p.cum - minY) / rangeY) * chartInnerH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.lineTo(chartInnerX + chartInnerW, zeroY);
      ctx.lineTo(chartInnerX, zeroY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // White Equity Line
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      cumulativePoints.forEach((p, idx) => {
        const px = chartInnerX + (idx / (cumulativePoints.length - 1)) * chartInnerW;
        const py = chartInnerY + chartInnerH - ((p.cum - minY) / rangeY) * chartInnerH;
        if (idx === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();

      // Draw Peak & Trough Markers on Canvas
      let peak = cumulativePoints[0];
      let trough = cumulativePoints[0];
      cumulativePoints.forEach(p => {
        if (p.cum > peak.cum) peak = p;
        if (p.cum < trough.cum) trough = p;
      });

      if (peak && (peak.cum !== 0 || peak.pnl !== 0)) {
        const pkIdx = cumulativePoints.findIndex(p => p.x === peak.x);
        const px = chartInnerX + (pkIdx / (cumulativePoints.length - 1)) * chartInnerW;
        const py = chartInnerY + chartInnerH - ((peak.cum - minY) / rangeY) * chartInnerH;

        ctx.fillStyle = '#2ECC71';
        ctx.beginPath();
        ctx.arc(px, py, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#062F18';
        ctx.fillRect(px - 38, py - 26, 76, 20);
        ctx.strokeStyle = '#2ECC71';
        ctx.lineWidth = 1;
        ctx.strokeRect(px - 38, py - 26, 76, 20);

        ctx.fillStyle = '#2ECC71';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${t('history.pngPeak')} ${peak.cum >= 0 ? '+' : ''}${peak.cum}R`, px, py - 16);
      }

      if (trough && (trough.cum !== 0 || trough.pnl !== 0) && trough.x !== peak.x) {
        const trIdx = cumulativePoints.findIndex(p => p.x === trough.x);
        const tx = chartInnerX + (trIdx / (cumulativePoints.length - 1)) * chartInnerW;
        const ty = chartInnerY + chartInnerH - ((trough.cum - minY) / rangeY) * chartInnerH;

        ctx.fillStyle = '#F87171';
        ctx.beginPath();
        ctx.arc(tx, ty, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#3F0F12';
        ctx.fillRect(tx - 38, ty + 8, 76, 20);
        ctx.strokeStyle = '#F87171';
        ctx.lineWidth = 1;
        ctx.strokeRect(tx - 38, ty + 8, 76, 20);

        ctx.fillStyle = '#F87171';
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${t('history.pngMin')} ${trough.cum}R`, tx, ty + 18);
      }

      // Y-Axis Labels
      ctx.font = '10px monospace';
      ctx.textAlign = 'right';

      // Max Y Label
      ctx.fillStyle = '#2ECC71';
      ctx.fillText(`${maxY >= 0 ? '+' : ''}${maxY.toFixed(1)}R`, chartInnerX - 8, chartInnerY + 8);

      // Zero Label
      ctx.fillStyle = '#6F6F6F';
      ctx.fillText('0.0R', chartInnerX - 8, zeroY + 3);

      // Min Y Label
      ctx.fillStyle = '#FF4D4F';
      ctx.fillText(`${minY.toFixed(1)}R`, chartInnerX - 8, chartInnerY + chartInnerH - 2);

      ctx.restore();
    }

    // 2 Donut Charts Section (Canvas 2D Helper)
    const donutY = 540;
    const donutH = 220;
    const halfW = (width - 80 - 20) / 2;

    const drawDonut = (
      boxX: number,
      boxY: number,
      boxW: number,
      boxH: number,
      title: string,
      data: { label: string; value: number; color: string; percentage: string }[],
      centerVal: string,
      centerSub: string,
      centerColor: string = '#FFFFFF'
    ) => {
      ctx.save();
      // Card Box
      ctx.fillStyle = '#0E0E0E';
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeStyle = '#202020';
      ctx.lineWidth = 1;
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      // Title
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(title, boxX + 20, boxY + 18);

      const total = data.reduce((sum, d) => sum + d.value, 0) || 1;
      const donutCx = boxX + 105;
      const donutCy = boxY + 125;
      const outerR = 60;
      const innerR = 36;

      let currentAngle = -Math.PI / 2;

      // Draw Arcs
      data.forEach((item) => {
        if (item.value <= 0) return;
        const sliceAngle = (item.value / total) * Math.PI * 2;
        const endAngle = currentAngle + sliceAngle;

        ctx.beginPath();
        ctx.arc(donutCx, donutCy, outerR, currentAngle, endAngle, false);
        ctx.arc(donutCx, donutCy, innerR, endAngle, currentAngle, true);
        ctx.closePath();
        ctx.fillStyle = item.color;
        ctx.fill();

        currentAngle = endAngle;
      });

      // Center Text
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = centerColor;
      ctx.font = 'bold 22px monospace';
      ctx.fillText(centerVal, donutCx, donutCy - 6);

      ctx.fillStyle = '#9D9D9D';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(centerSub, donutCx, donutCy + 14);

      // Legend List
      const legendX = boxX + 195;
      let legendY = boxY + 60;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';

      data.forEach((item) => {
        // Dot
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(legendX, legendY, 5, 0, Math.PI * 2);
        ctx.fill();

        // Label
        ctx.fillStyle = '#9D9D9D';
        ctx.font = '11px sans-serif';
        ctx.fillText(item.label, legendX + 14, legendY);

        // Value & Percentage
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${item.value} (${item.percentage}%)`, boxX + boxW - 20, legendY);
        ctx.textAlign = 'left';

        legendY += 32;
      });

      ctx.restore();
    };

    // Asset Category Donut
    drawDonut(
      40,
      donutY,
      halfW,
      donutH,
      `${t('history.categoryRatio')} ASET`,
      categoryDonutData,
      `${summary?.totalSignals || 0}`,
      t('history.signals'),
      '#FFFFFF'
    );

    // Win/Loss Ratio Donut
    drawDonut(
      40 + halfW + 20,
      donutY,
      halfW,
      donutH,
      `${t('history.outcomeRatio')} (WIN/LOSS)`,
      winLossDonutData,
      `${summary?.winRate || 0}%`,
      t('history.winRate'),
      '#2ECC71'
    );

    // Recent Signals Table
    const tableY = 740;
    ctx.fillStyle = '#0E0E0E';
    ctx.fillRect(40, tableY, width - 80, 520);
    ctx.strokeStyle = '#202020';
    ctx.strokeRect(40, tableY, width - 80, 520);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${t('history.recentHistoryTitle')} (TOP 10)`, 60, tableY + 35);

    // Table Header
    ctx.fillStyle = '#141414';
    ctx.fillRect(60, tableY + 50, width - 120, 32);

    ctx.fillStyle = '#9D9D9D';
    ctx.font = 'bold 11px monospace';
    ctx.fillText(t('history.colClosedAt'), 75, tableY + 70);
    ctx.fillText(t('history.colAssetPair'), 220, tableY + 70);
    ctx.fillText(t('history.colTypeStrategy'), 380, tableY + 70);
    ctx.fillText(t('history.colEntryAvg'), 620, tableY + 70);
    ctx.fillText(t('history.colOutcome'), 780, tableY + 70);
    ctx.fillText(t('history.colPnl'), 980, tableY + 70);

    // Rows
    const top10 = tableRecords.slice(0, 10);
    top10.forEach((rec, idx) => {
      const ry = tableY + 95 + idx * 40;
      ctx.fillStyle = idx % 2 === 0 ? '#080808' : '#0E0E0E';
      ctx.fillRect(60, ry - 12, width - 120, 38);

      ctx.fillStyle = '#9D9D9D';
      ctx.font = '11px monospace';
      ctx.fillText(new Date(rec.closedAt).toLocaleString(locale, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }), 75, ry + 12);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(rec.pairName, 220, ry + 12);

      ctx.fillStyle = rec.type === 'BUY' ? '#2ECC71' : '#F87171';
      ctx.font = 'bold 11px monospace';
      ctx.fillText(`[${rec.type}]`, 380, ry + 12);

      ctx.fillStyle = '#9D9D9D';
      ctx.font = '11px sans-serif';
      ctx.fillText(rec.strategyMethod.slice(0, 22), 430, ry + 12);

      ctx.fillStyle = '#FFFFFF';
      ctx.font = '11px monospace';
      ctx.fillText(`${rec.entryAvg}`, 620, ry + 12);

      ctx.fillStyle = rec.outcomeCategory === 'Full TP' ? '#2ECC71' : rec.outcomeCategory === 'TP1 then SL' ? '#3B82F6' : rec.outcomeCategory === 'Direct SL' ? '#F87171' : '#9D9D9D';
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(rec.outcomeCategory, 780, ry + 12);

      const rVal = rec.pnlRMultiple || 0;
      ctx.fillStyle = rVal > 0 ? '#2ECC71' : rVal < 0 ? '#FF4D4F' : '#9D9D9D';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`${rVal > 0 ? '+' : ''}${rVal.toFixed(1)}R`, 980, ry + 12);
    });

    // Disclaimer Footer
    ctx.fillStyle = '#6F6F6F';
    ctx.font = '11px sans-serif';
    ctx.fillText(t('history.pngFooterDisclaimer'), 40, height - 35);

    // Download Link
    const link = document.createElement('a');
    link.download = `HEVORA_Performance_Report_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // SVG Chart Geometry. The equity curve is an OVERVIEW chart - a reader must see the whole PnL
  // journey the instant the page opens, with zero interaction required (bug fix, round 2: with a
  // few hundred closed signals, the old always-scrollable-past-threshold layout rendered the chart
  // ~10,000px wide and silently opened on a tiny clipped fragment at the far left). Default mode
  // now always fits the full curve into the available width (svgChartWidth = baseChartWidth, a
  // fixed logical coordinate space the <svg> stretches to 100% of its container via
  // preserveAspectRatio="none" - same technique the shared LineChart component already uses
  // everywhere else in this app). MIN_EQUITY_POINT_GAP/naturalChartWidth only matter once the
  // reader explicitly opts into "detail" mode (equityDetailMode, toggled below the chart) to scrub
  // a dense history at its natural per-trade spacing via the existing horizontal-scroll wrapper -
  // never the default view.
  const [equityDetailMode, setEquityDetailMode] = useState<boolean>(false);
  const MIN_EQUITY_POINT_GAP = 22;
  const baseChartWidth = 600;
  const svgChartHeight = 250;
  const paddingX = 40;
  const paddingY = 30;
  const naturalChartWidth = paddingX * 2 + Math.max(0, cumulativePoints.length - 1) * MIN_EQUITY_POINT_GAP;
  const equityHasDetail = naturalChartWidth > baseChartWidth;
  const equityChartScrollable = equityDetailMode && equityHasDetail;
  const svgChartWidth = equityChartScrollable ? naturalChartWidth : baseChartWidth;
  const equitySvgRef = useRef<SVGSVGElement>(null);
  const { containerRef: equityScrollRef, isDragging: isEquityDragging, containerHandlers: equityScrollHandlers } =
    useHorizontalChartScroll<HTMLDivElement>();

  const chartPoints = useMemo(() => {
    if (cumulativePoints.length === 0) return [];
    const minY = Math.min(0, ...cumulativePoints.map(p => p.cum));
    const maxY = Math.max(0, ...cumulativePoints.map(p => p.cum));
    const rangeY = (maxY - minY) || 1;

    const innerW = svgChartWidth - paddingX * 2;
    const innerH = svgChartHeight - paddingY * 2;

    return cumulativePoints.map((p, i) => {
      const cx = paddingX + (i / (cumulativePoints.length - 1 || 1)) * innerW;
      const cy = paddingY + innerH - ((p.cum - minY) / rangeY) * innerH;
      return {
        ...p,
        cx,
        cy,
        minY,
        maxY,
        rangeY,
        innerH,
        zeroY: paddingY + innerH - ((0 - minY) / rangeY) * innerH
      };
    });
  }, [cumulativePoints, svgChartWidth]);

  const { peakPoint, troughPoint } = useMemo(() => {
    if (chartPoints.length <= 1) return { peakPoint: null, troughPoint: null };
    let peak = chartPoints[0];
    let trough = chartPoints[0];
    chartPoints.forEach((p) => {
      if (p.cum > peak.cum) peak = p;
      if (p.cum < trough.cum) trough = p;
    });
    return {
      peakPoint: peak.cum !== 0 || peak.pnl !== 0 ? peak : null,
      troughPoint: (trough.cum !== 0 || trough.pnl !== 0) && (trough.cx !== peak.cx || trough.cy !== peak.cy) ? trough : null,
    };
  }, [chartPoints]);

  // Smooth (Catmull-Rom -> cubic Bezier) curve instead of a straight-segment polyline - a hard
  // angle at every one of a few hundred trades reads as noisy/cheap; a gently-curved line through
  // the exact same points (no data smoothing, this is a pixel-path transform only) is the
  // institutional-terminal look the redesign brief asks for.
  const smoothPathD = (pts: { cx: number; cy: number }[]) => {
    if (pts.length === 0) return '';
    if (pts.length === 1) return `M ${pts[0].cx.toFixed(1)} ${pts[0].cy.toFixed(1)}`;
    let d = `M ${pts[0].cx.toFixed(1)} ${pts[0].cy.toFixed(1)} `;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i === 0 ? i : i - 1];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
      const cp1x = p1.cx + (p2.cx - p0.cx) / 6;
      const cp1y = p1.cy + (p2.cy - p0.cy) / 6;
      const cp2x = p2.cx - (p3.cx - p1.cx) / 6;
      const cp2y = p2.cy - (p3.cy - p1.cy) / 6;
      d += `C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.cx.toFixed(1)} ${p2.cy.toFixed(1)} `;
    }
    return d.trim();
  };

  const linePathD = useMemo(() => smoothPathD(chartPoints), [chartPoints]);

  const areaClosedD = useMemo(() => {
    if (chartPoints.length === 0) return '';
    const zeroY = chartPoints[0].zeroY;
    const firstX = chartPoints[0].cx;
    const lastX = chartPoints[chartPoints.length - 1].cx;
    return `${linePathD} L ${lastX} ${zeroY} L ${firstX} ${zeroY} Z`;
  }, [chartPoints, linePathD]);

  // Nearest-point lookup for a continuous hover crosshair (replaces one <circle> hit-target per
  // data point, which scattered a few hundred dots along the line - noisy and, on touch, fiddly to
  // land a tap on. Points are evenly spaced by index, so the nearest index is a direct calculation
  // instead of a search, same technique the shared LineChart component uses.
  const nearestChartPointAt = (clientX: number) => {
    const svg = equitySvgRef.current;
    if (!svg || chartPoints.length === 0) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return null;
    const innerW = svgChartWidth - paddingX * 2;
    const step = innerW / (chartPoints.length - 1 || 1);
    const xInViewBox = ((clientX - rect.left) / rect.width) * svgChartWidth;
    const idx = Math.min(chartPoints.length - 1, Math.max(0, Math.round((xInViewBox - paddingX) / step)));
    return chartPoints[idx];
  };

  const minYVal = chartPoints.length > 0 ? chartPoints[0].minY : 0;
  const maxYVal = chartPoints.length > 0 ? chartPoints[0].maxY : 0;
  const zeroYPos = chartPoints.length > 0 ? chartPoints[0].zeroY : paddingY + (svgChartHeight - paddingY * 2) / 2;

  return (
    <div id="history-report-container" className="max-w-7xl mx-auto space-y-6 pb-16 font-sans">
      {/* 1. Header Banner - removed (round 3): the box/card, clock icon, title, "REAL-TIME AUDIT"
          badge and description paragraph are all gone. Only the 3 action buttons survive, moved
          into a small top-right toolbar with no title/badge/description around them - unchanged
          onClick handlers, logic (fetchHistory/window.print/handleExportPNG), tooltips and icons. */}
      <div className="no-print flex flex-wrap items-center justify-end gap-2.5">
        <button
          onClick={fetchHistory}
          disabled={loading}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--border-subtle)] text-[var(--text-primary)] text-xs font-mono font-medium border border-[var(--border-subtle)] transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
          title={t('history.refreshTooltip')}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#2ECC71]' : ''}`} />
          <span>{t('history.refresh')}</span>
        </button>

        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--border-subtle)] text-[var(--text-primary)] text-xs font-mono font-medium border border-[var(--border-subtle)] transition-all active:scale-95 cursor-pointer"
          title={t('history.downloadPdfTooltip')}
        >
          <FileText className="w-3.5 h-3.5 text-[#3B82F6]" />
          <span>{t('history.downloadPdf')}</span>
        </button>

        <button
          onClick={handleExportPNG}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#2ECC71] hover:bg-[#27ae60] text-zinc-950 text-xs font-mono font-bold transition-all active:scale-95 shadow-lg shadow-[#2ECC71]/25 cursor-pointer"
          title={t('history.downloadImageTooltip')}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>{t('history.downloadImage')}</span>
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="p-6 rounded-[14px] bg-[#FF4D4F]/10 border border-[#FF4D4F]/30 text-center text-[#FF4D4F] space-y-3">
          <AlertTriangle className="w-8 h-8 mx-auto" />
          <p className="text-sm font-semibold">{error}</p>
          <button
            onClick={fetchHistory}
            className="px-4 py-2 bg-[#FF4D4F] text-white font-mono text-xs font-bold rounded-xl hover:bg-[#e03e40] transition-colors"
          >
            {t('history.retry')}
          </button>
        </div>
      )}

      {/* 2. Grid 4 KPI Cards */}
      {/* Gated on rawSummary (the raw server response, null until the first successful fetch) -
          not the derived `summary` memo, which always recomputes a real (all-zero) object from
          periodFilteredRecords even before any fetch resolves, since that array starts at [] (an
          empty array is truthy) rather than null. Checking `summary` here would make the skeleton
          branch below unreachable. */}
      {rawSummary ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* KPI 1: Win Rate & Non-Loss Rate */}
          <div className="hev-card-v2 !p-6 border border-[var(--border-subtle)] rounded-[16px] relative overflow-hidden">
            <div className="absolute right-3 bottom-0 text-[46px] font-black tracking-tighter opacity-[0.02] pointer-events-none select-none text-white font-mono">
              HEVORA
            </div>
            <div className="absolute -right-10 -top-10 w-32 h-32 rounded-full bg-[#2ECC71]/10 blur-[50px] pointer-events-none" />
            <div className="flex items-center justify-between text-[var(--text-muted)] text-[10px] font-mono font-bold uppercase tracking-[0.12em] mb-3 relative z-10">
              <div className="flex items-center gap-1.5">
                <span>{t('history.winRateNonLoss')}</span>
                {/* group-hover alone doesn't work on touch devices (no hover state) - tapping now
                    toggles the tooltip too, so this is reachable on mobile, not just desktop. */}
                <div className="group relative">
                  <button
                    type="button"
                    onClick={() => setShowMetricTooltip((v) => !v)}
                    className="cursor-pointer flex items-center"
                    aria-label={t('history.metricTooltipTitle')}
                  >
                    <Info className="w-3.5 h-3.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors" />
                  </button>
                  <div
                    className={`absolute left-0 bottom-full mb-2 w-64 p-2.5 rounded-xl bg-gray-900/95 text-xs text-gray-200 border border-gray-700 shadow-xl z-50 leading-relaxed normal-case ${
                      showMetricTooltip ? 'block' : 'hidden group-hover:block'
                    }`}
                  >
                    <p className="font-bold text-[#2ECC71] mb-1">{t('history.metricTooltipTitle')}</p>
                    <p>{t('history.metricTooltipWinRate').replace('{winRate}', String(summary.winRate))}</p>
                    <p className="mt-1">{t('history.metricTooltipNonLoss').replace('{nonLossRate}', String(summary.nonLossRate ?? summary.winRate))}</p>
                  </div>
                </div>
              </div>
              <TrendingUp className="w-4 h-4 text-[#2ECC71]" />
            </div>
            <div className="relative z-10">
              <span className="hev-hero-number block text-[#2ECC71]">{summary.winRate}%</span>
              <div className="flex items-center justify-between gap-2 mt-1.5">
                <span className="text-[11px] text-[var(--text-muted)] font-mono">
                  {summary.fullTpCount + summary.tp1SlCount}W&nbsp;/&nbsp;{summary.directSlCount}L
                </span>
                <span className="text-[11px] font-bold font-mono text-[#3B82F6]">
                  {t('history.nonLossRate')} {summary.nonLossRate ?? summary.winRate}%
                </span>
              </div>
            </div>
            <div className="mt-4 w-full bg-[var(--bg-surface)] rounded-full h-1.5 overflow-hidden border border-[var(--border-subtle)] relative">
              <div
                className="hev-bar-grow h-1.5 rounded-full"
                style={{
                  width: `${Math.min(100, Math.max(0, summary.winRate))}%`,
                  background: 'linear-gradient(90deg, color-mix(in srgb, #2ECC71 55%, transparent), #2ECC71)',
                  transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)',
                }}
              />
            </div>
          </div>

          {/* KPI 2: Total Net R-Multiple */}
          <div className="hev-card-v2 !p-6 border border-[var(--border-subtle)] rounded-[16px] relative overflow-hidden">
            <div className="absolute right-3 bottom-0 text-[46px] font-black tracking-tighter opacity-[0.02] pointer-events-none select-none text-white font-mono">
              HEVORA
            </div>
            <div
              className="absolute -right-10 -top-10 w-32 h-32 rounded-full blur-[50px] pointer-events-none"
              style={{ background: summary.totalRMultiple >= 0 ? 'rgba(46,204,113,0.1)' : 'rgba(255,77,79,0.1)' }}
            />
            <div className="flex items-center justify-between text-[var(--text-muted)] text-[10px] font-mono font-bold uppercase tracking-[0.12em] mb-3 relative z-10">
              <span>{t('history.totalNetPnl')}</span>
              <BarChart2 className="w-4 h-4 text-[#2ECC71]" />
            </div>
            <span className={`hev-hero-number block relative z-10 ${summary.totalRMultiple >= 0 ? 'text-[#2ECC71]' : 'text-[#FF4D4F]'}`}>
              {summary.totalRMultiple >= 0 ? `+${summary.totalRMultiple}` : summary.totalRMultiple} R
            </span>
            <div className="mt-4 text-[11px] text-[var(--text-muted)] font-mono flex items-center justify-between border-t border-[var(--border-subtle)] pt-3">
              <span className="text-[#2ECC71]">{t('history.pngProfit')} +{grossProfitR}R</span>
              <span className="text-[#FF4D4F]">{t('history.pngLossLabel')} -{grossLossR}R</span>
            </div>
          </div>

          {/* KPI 3: Profit Factor */}
          <div className="hev-card-v2 !p-6 border border-[var(--border-subtle)] rounded-[16px] relative overflow-hidden">
            <div className="absolute right-3 bottom-0 text-[46px] font-black tracking-tighter opacity-[0.02] pointer-events-none select-none text-white font-mono">
              HEVORA
            </div>
            <div className="absolute -right-10 -top-10 w-32 h-32 rounded-full bg-[#3B82F6]/10 blur-[50px] pointer-events-none" />
            <div className="flex items-center justify-between text-[var(--text-muted)] text-[10px] font-mono font-bold uppercase tracking-[0.12em] mb-3 relative z-10">
              <span>{t('history.profitFactor')}</span>
              <PieChart className="w-4 h-4 text-[#3B82F6]" />
            </div>
            <span className="hev-hero-number block text-[#3B82F6] relative z-10">{profitFactor}</span>
            <p className="mt-4 text-[11px] text-[var(--text-muted)] font-mono border-t border-[var(--border-subtle)] pt-3">
              {t('history.profitFactorSub')}
            </p>
          </div>

          {/* KPI 4: Total Signals */}
          <div className="hev-card-v2 !p-6 border border-[var(--border-subtle)] rounded-[16px] relative overflow-hidden">
            <div className="absolute right-3 bottom-0 text-[46px] font-black tracking-tighter opacity-[0.02] pointer-events-none select-none text-white font-mono">
              HEVORA
            </div>
            <div className="absolute -right-10 -top-10 w-32 h-32 rounded-full bg-[#3B82F6]/10 blur-[50px] pointer-events-none" />
            <div className="flex items-center justify-between text-[var(--text-muted)] text-[10px] font-mono font-bold uppercase tracking-[0.12em] mb-3 relative z-10">
              <span>{t('history.totalSignalsCompleted')}</span>
              <Layers className="w-4 h-4 text-[#3B82F6]" />
            </div>
            <div className="flex items-baseline gap-2 relative z-10">
              <span className="hev-hero-number text-[var(--text-primary)]">{summary.totalSignals}</span>
              <span className="text-xs text-[var(--text-muted)] font-mono">{t('history.signals')}</span>
            </div>
            <p className="mt-4 text-[11px] text-[var(--text-muted)] font-mono border-t border-[var(--border-subtle)] pt-3">
              {summary.invalidatedCount} {t('history.invalidatedDiscarded')}
            </p>
          </div>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="hev-card-v2 !p-6 border border-[var(--border-subtle)] rounded-[16px] space-y-3">
              <div className="h-3 w-20 rounded bg-[var(--border-subtle)] animate-pulse" />
              <div className="h-9 w-28 rounded bg-[var(--border-subtle)] animate-pulse" />
              <div className="h-2.5 w-32 rounded bg-[var(--border-subtle)] animate-pulse" />
            </div>
          ))}
        </div>
      ) : null}

      {/* 3 & 4. Cumulative Equity Curve & Donut Charts Grid */}
      {rawSummary ? (
      <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 3. Equity Curve - dominant focal panel (8 of 12 columns) */}
        <div className="lg:col-span-8 hev-card-v2 !p-6 sm:!p-7 border border-[var(--border-subtle)] rounded-[16px] relative overflow-hidden flex flex-col justify-between">
          <div className="absolute -left-16 -bottom-16 w-56 h-56 rounded-full bg-[#2ECC71]/[0.06] blur-[70px] pointer-events-none" />
          <div className="flex items-center justify-between mb-5 relative z-10">
            <div>
              <h2 className="text-sm sm:text-base font-bold font-mono text-[var(--text-primary)] tracking-wide flex items-center gap-2">
                <BarChart2 className="w-4 h-4 text-[#2ECC71]" />
                {t('history.equityCurveTitle')}
              </h2>
              <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1 sm:line-clamp-none mt-0.5" title={t('history.equityCurveSubtitle')}>{t('history.equityCurveSubtitle')}</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Optional per-trade detail mode (bug fix, round 2): default view always fits the
                  full curve into the panel with zero interaction. Only when there's genuinely more
                  detail than the fit view can show does this toggle appear, switching to the
                  natural per-trade spacing inside the existing horizontal-scroll/drag wrapper.
                  no-print (not the whole header row) so the Net R badge below still prints/exports
                  to PDF exactly as before. */}
              {equityHasDetail && (
                <button
                  type="button"
                  onClick={() => { setEquityDetailMode((v) => !v); setHoveredPoint(null); }}
                  className="no-print inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--border-subtle)] text-[var(--text-secondary)] text-[10px] font-mono font-bold border border-[var(--border-subtle)] transition-all active:scale-95 cursor-pointer"
                  title={equityDetailMode
                    ? (language === 'id' ? 'Kembali ke tampilan penuh' : 'Back to full-fit view')
                    : (language === 'id' ? 'Mode detail per-trade (geser)' : 'Per-trade detail mode (scroll)')}
                >
                  {equityDetailMode ? <ZoomOut className="w-3.5 h-3.5" /> : <ZoomIn className="w-3.5 h-3.5" />}
                  <span className="hidden sm:inline">{equityDetailMode ? (language === 'id' ? 'Penuh' : 'Fit') : 'Detail'}</span>
                </button>
              )}
              <span className="text-xs font-mono font-bold text-[#2ECC71] bg-[#2ECC71]/10 px-3 py-1.5 rounded-lg border border-[#2ECC71]/20 shadow-[0_0_16px_-6px_rgba(46,204,113,0.6)]">
                {t('history.net')} {(summary?.totalRMultiple || 0) >= 0 ? `+${summary?.totalRMultiple || 0}` : summary?.totalRMultiple} R
              </span>
            </div>
          </div>

          {/* Native SVG Equity Curve. The scroll/pan wrapper is a separate inner element from
              this outer relative box (rather than making this box itself overflow-x-auto) so the
              hover tooltip below - pinned to this box's own top-right corner - stays put on
              screen while the chart content pans underneath it, instead of scrolling away with
              the content it's describing. */}
          <div className="relative w-full h-[320px] mt-2 z-10">
            <div
              ref={equityScrollRef}
              className={equityChartScrollable ? 'w-full h-full overflow-x-auto no-scrollbar' : 'w-full h-full'}
              {...(equityChartScrollable ? equityScrollHandlers : {})}
            >
            {chartPoints.length > 1 ? (
              <svg
                ref={equitySvgRef}
                viewBox={`0 0 ${svgChartWidth} ${svgChartHeight}`}
                width={equityChartScrollable ? svgChartWidth : '100%'}
                height={equityChartScrollable ? svgChartHeight : '100%'}
                preserveAspectRatio="none"
                className={equityChartScrollable ? 'h-full overflow-visible cursor-grab active:cursor-grabbing' : 'w-full h-full overflow-visible cursor-crosshair'}
                onPointerMove={(e) => {
                  if (isEquityDragging()) { setHoveredPoint(null); return; }
                  const p = nearestChartPointAt(e.clientX);
                  if (p) setHoveredPoint(p);
                }}
                onPointerLeave={() => setHoveredPoint(null)}
                onClick={(e) => {
                  const p = nearestChartPointAt(e.clientX);
                  if (!p) return;
                  setHoveredPoint((prev) => (prev?.x === p.x ? null : p));
                }}
              >
                <defs>
                  {/* Green Gradient above Zero - softened 3-stop fade (institutional-terminal
                      style: a thin precise line with a subtle gradation down to fully transparent,
                      not the flatter/neon 2-stop fill this used to be). */}
                  <linearGradient id="equityGreenGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-up)" stopOpacity="0.24" />
                    <stop offset="55%" stopColor="var(--color-up)" stopOpacity="0.07" />
                    <stop offset="100%" stopColor="var(--color-up)" stopOpacity="0" />
                  </linearGradient>

                  {/* Red Gradient below Zero */}
                  <linearGradient id="equityRedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-down)" stopOpacity="0" />
                    <stop offset="45%" stopColor="var(--color-down)" stopOpacity="0.07" />
                    <stop offset="100%" stopColor="var(--color-down)" stopOpacity="0.24" />
                  </linearGradient>

                  {/* Clip path above zero line */}
                  <clipPath id="aboveZeroClip">
                    <rect x={paddingX - 10} y={0} width={svgChartWidth - paddingX * 2 + 20} height={zeroYPos} />
                  </clipPath>

                  {/* Clip path below zero line */}
                  <clipPath id="belowZeroClip">
                    <rect x={paddingX - 10} y={zeroYPos} width={svgChartWidth - paddingX * 2 + 20} height={svgChartHeight - zeroYPos} />
                  </clipPath>
                </defs>

                {/* Background Grid Lines - thin dashed reference lines at low opacity (same
                    editorial-financial treatment as LineChart's own grid) so the handful of Y
                    levels read without competing with the curve itself. */}
                {[0.2, 0.4, 0.6, 0.8].map((ratio, idx) => {
                  const gy = paddingY + (svgChartHeight - paddingY * 2) * ratio;
                  return (
                    <line
                      key={idx}
                      x1={paddingX}
                      y1={gy}
                      x2={svgChartWidth - paddingX}
                      y2={gy}
                      stroke="var(--border-subtle)"
                      strokeWidth="1"
                      strokeDasharray="2 4"
                      vectorEffect="non-scaling-stroke"
                      opacity={0.35}
                    />
                  );
                })}

                {/* Zero Reference Line */}
                <line
                  x1={paddingX}
                  y1={zeroYPos}
                  x2={svgChartWidth - paddingX}
                  y2={zeroYPos}
                  stroke="var(--border-strong)"
                  strokeDasharray="4 4"
                  strokeWidth="1.5"
                />

                {/* Y-Axis Label Max */}
                <text
                  x={paddingX - 8}
                  y={paddingY + 4}
                  fill="var(--color-up)"
                  fontSize="10"
                  fontFamily="var(--font-mono, monospace)"
                  textAnchor="end"
                >
                  {maxYVal >= 0 ? '+' : ''}{maxYVal.toFixed(1)}R
                </text>

                {/* Y-Axis Label Zero */}
                <text
                  x={paddingX - 8}
                  y={zeroYPos + 3}
                  fill="var(--text-muted)"
                  fontSize="10"
                  fontFamily="var(--font-mono, monospace)"
                  textAnchor="end"
                >
                  0.0R
                </text>

                {/* Y-Axis Label Min */}
                <text
                  x={paddingX - 8}
                  y={svgChartHeight - paddingY + 2}
                  fill="var(--color-down)"
                  fontSize="10"
                  fontFamily="var(--font-mono, monospace)"
                  textAnchor="end"
                >
                  {minYVal.toFixed(1)}R
                </text>

                {/* Green Area Fill (Clipped Above Zero) */}
                <path d={areaClosedD} fill="url(#equityGreenGrad)" clipPath="url(#aboveZeroClip)" />

                {/* Red Area Fill (Clipped Below Zero) */}
                <path d={areaClosedD} fill="url(#equityRedGrad)" clipPath="url(#belowZeroClip)" />

                {/* Main White Curve Line - draws in progressively once on mount via the shared
                    .hev-draw-in class (Bagian F self-audit: "transition-all" on a path's `d`
                    attribute does not actually animate the shape between renders in any browser,
                    so this never drew in at all, it just appeared fully formed). Subsequent data
                    refreshes (a new closed trade) update `d` without replaying the draw-in, same
                    rule LineChart's own equivalent path already follows. */}
                <path
                  className="hev-draw-in"
                  d={linePathD}
                  fill="none"
                  stroke="var(--text-primary)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ ['--hev-draw-length' as string]: '3000' }}
                />

                {/* Peak Highlight Marker */}
                {peakPoint && (
                  <g className="transition-all duration-300">
                    <circle
                      cx={peakPoint.cx}
                      cy={peakPoint.cy}
                      r="5.5"
                      fill="var(--color-up)"
                      stroke="var(--text-primary)"
                      strokeWidth="2"
                    />
                    <g transform={`translate(${Math.min(svgChartWidth - paddingX - 65, Math.max(paddingX + 5, peakPoint.cx - 36))}, ${Math.max(6, peakPoint.cy - 24)})`}>
                      <rect
                        x="0"
                        y="0"
                        width="72"
                        height="18"
                        rx="4"
                        fill="var(--bg-panel)"
                        stroke="var(--color-up)"
                        strokeWidth="1"
                      />
                      <text
                        x="36"
                        y="12"
                        fill="var(--color-up)"
                        fontSize="9"
                        fontWeight="bold"
                        fontFamily="var(--font-mono, monospace)"
                        textAnchor="middle"
                      >
                        {t('history.pngPeak')} {peakPoint.cum >= 0 ? '+' : ''}{peakPoint.cum}R
                      </text>
                    </g>
                  </g>
                )}

                {/* Trough Highlight Marker */}
                {troughPoint && (
                  <g className="transition-all duration-300">
                    <circle
                      cx={troughPoint.cx}
                      cy={troughPoint.cy}
                      r="5.5"
                      fill="var(--color-down)"
                      stroke="var(--text-primary)"
                      strokeWidth="2"
                    />
                    <g transform={`translate(${Math.min(svgChartWidth - paddingX - 65, Math.max(paddingX + 5, troughPoint.cx - 36))}, ${Math.min(svgChartHeight - 20, troughPoint.cy + 8)})`}>
                      <rect
                        x="0"
                        y="0"
                        width="72"
                        height="18"
                        rx="4"
                        fill="var(--bg-panel)"
                        stroke="var(--color-down)"
                        strokeWidth="1"
                      />
                      <text
                        x="36"
                        y="12"
                        fill="var(--color-down)"
                        fontSize="9"
                        fontWeight="bold"
                        fontFamily="var(--font-mono, monospace)"
                        textAnchor="middle"
                      >
                        {t('history.pngMin')} {troughPoint.cum}R
                      </text>
                    </g>
                  </g>
                )}

                {/* Single crosshair dot at the hovered/tapped sample only - no more per-point
                    markers scattered along the whole curve (cheap/noisy). Position/colour comes
                    from the matching chartPoints entry (has cx/cy); hoveredPoint itself only
                    carries the plain value fields used by the tooltip below. Pointer move/click on
                    the whole <svg> (see handlers above) finds the nearest sample, so this works the
                    same on desktop hover and a mobile tap - no tiny hit target to land on. */}
                {hoveredPoint && (() => {
                  const hp = chartPoints.find((p) => p.x === hoveredPoint.x);
                  if (!hp) return null;
                  return (
                    <circle
                      cx={hp.cx}
                      cy={hp.cy}
                      r={5}
                      fill={hp.pnl >= 0 ? 'var(--color-up)' : 'var(--color-down)'}
                      stroke="var(--bg-panel)"
                      strokeWidth="1.5"
                    />
                  );
                })()}
              </svg>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-[var(--text-muted)] font-mono">
                {t('history.notEnoughDataChart')}
              </div>
            )}
            </div>

            {/* Hover Tooltip */}
            {hoveredPoint && (
              <div className="absolute top-2 right-2 p-2.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[11px] font-mono shadow-2xl z-20 space-y-1">
                <p className="text-[var(--text-secondary)] font-bold">{hoveredPoint.pair}</p>
                <p className="text-[var(--text-muted)]">{hoveredPoint.date !== 'Baseline' ? new Date(hoveredPoint.date).toLocaleString(locale) : t('history.pngStart')}</p>
                <div className="flex items-center gap-3 pt-1 border-t border-[var(--border-subtle)]">
                  <span className={hoveredPoint.pnl >= 0 ? 'text-[var(--color-up)]' : 'text-[var(--color-down)]'}>
                    {t('history.pngTrade')} {hoveredPoint.pnl >= 0 ? '+' : ''}{hoveredPoint.pnl}R
                  </span>
                  <span className="text-[var(--text-primary)] font-bold">
                    {t('history.pngCum')} {hoveredPoint.cum >= 0 ? '+' : ''}{hoveredPoint.cum}R
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono mt-3 border-t border-[var(--border-subtle)] pt-2 relative z-10">
            <span>{t('history.start')}</span>
            <span>{t('history.dataAuditRealtime')} ({historyRecords.length} {t('history.record')})</span>
          </div>
        </div>

        {/* 4. Two Donut Charts - stacked vertically in a slim right-hand column, each with its
            own tidy side-by-side ring + legend instead of two squeezed-together cards. */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Donut 1: Rasio Kategori Aset */}
          <div className="hev-card-v2 !p-5 border border-[var(--border-subtle)] rounded-[16px] relative overflow-hidden">
            <div className="mb-3">
              <h3 className="text-xs font-bold font-mono text-[var(--text-primary)] tracking-wide">{t('history.categoryRatio')}</h3>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{t('history.categoryRatioSub')}</p>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative w-24 h-24 shrink-0 transition-transform hover:scale-105 duration-300">
                <svg viewBox="0 0 100 100" className="w-full h-full">
                  <circle cx="50" cy="50" r={RING_RADIUS} fill="none" stroke="var(--border-subtle)" strokeWidth="12" />
                  {getRingSegments(categoryDonutData).map((seg, i) =>
                    seg.value > 0 ? (
                      <circle
                        key={i}
                        cx="50"
                        cy="50"
                        r={RING_RADIUS}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="12"
                        strokeLinecap="round"
                        strokeDasharray={seg.dashArray}
                        transform={`rotate(${seg.rotation} 50 50)`}
                        className="hev-ring-grow hover:opacity-80 transition-opacity duration-200"
                        style={{
                          filter: `drop-shadow(0 0 3px ${seg.color}80)`,
                          ['--hev-ring-circ' as string]: RING_CIRCUMFERENCE,
                          animationDelay: `${i * 90}ms`,
                        }}
                      />
                    ) : null
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-lg font-black font-mono text-[var(--text-primary)] tracking-tight">
                    {summary?.totalSignals || 0}
                  </span>
                  <span className="text-[8px] font-bold text-[var(--text-muted)] font-mono uppercase tracking-wider">{t('history.signals')}</span>
                </div>
              </div>

              <div className="flex-1 min-w-0 space-y-2 text-[11px] font-mono">
                {categoryDonutData.map((d, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shadow-sm shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="text-[var(--text-secondary)] font-medium truncate" title={d.label}>{d.label}</span>
                    </div>
                    <span className="text-[var(--text-primary)] font-bold shrink-0 whitespace-nowrap">{d.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Donut 2: Rasio Kemenangan */}
          <div className="hev-card-v2 !p-5 border border-[var(--border-subtle)] rounded-[16px] relative overflow-hidden">
            <div className="mb-3">
              <h3 className="text-xs font-bold font-mono text-[var(--text-primary)] tracking-wide">{t('history.outcomeRatio')}</h3>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{t('history.outcomeRatioSub')}</p>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative w-24 h-24 shrink-0 transition-transform hover:scale-105 duration-300">
                <svg viewBox="0 0 100 100" className="w-full h-full">
                  <circle cx="50" cy="50" r={RING_RADIUS} fill="none" stroke="var(--border-subtle)" strokeWidth="12" />
                  {getRingSegments(winLossDonutData).map((seg, i) =>
                    seg.value > 0 ? (
                      <circle
                        key={i}
                        cx="50"
                        cy="50"
                        r={RING_RADIUS}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="12"
                        strokeLinecap="round"
                        strokeDasharray={seg.dashArray}
                        transform={`rotate(${seg.rotation} 50 50)`}
                        className="hev-ring-grow hover:opacity-80 transition-opacity duration-200"
                        style={{
                          filter: `drop-shadow(0 0 3px ${seg.color}80)`,
                          ['--hev-ring-circ' as string]: RING_CIRCUMFERENCE,
                          animationDelay: `${i * 90}ms`,
                        }}
                      />
                    ) : null
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-lg font-black font-mono text-[#2ECC71] tracking-tight">
                    {summary?.winRate || 0}%
                  </span>
                  <span className="text-[8px] font-bold text-[var(--text-muted)] font-mono uppercase tracking-wider">{t('history.winRate')}</span>
                </div>
              </div>

              <div className="flex-1 min-w-0 space-y-2 text-[11px] font-mono">
                {winLossDonutData.map((d, i) => (
                  <div key={i} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full shadow-sm shrink-0" style={{ backgroundColor: d.color }} />
                      <span className="text-[var(--text-secondary)] font-medium truncate" title={d.label}>{d.label}</span>
                    </div>
                    <span className="text-[var(--text-primary)] font-bold shrink-0 whitespace-nowrap">{d.percentage}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 4b. Category Performance - one clean card. The Avg Risk:Reward gauge that used to sit in
          its own 5-column panel is folded in as a compact secondary stat row at the bottom: same
          avgRiskReward figure and the same 0/1/2R colour thresholds, just far less visual weight
          than a dedicated semicircle gauge next to it. No new data - only categoryBreakdown and
          avgRiskReward, both already computed in the summary above. */}
      <div className="hev-card-v2 !p-6 border border-[var(--border-subtle)] rounded-[16px] relative overflow-hidden">
        <div className="mb-5">
          <h2 className="text-sm font-bold font-mono text-[var(--text-primary)] tracking-wide flex items-center gap-2">
            <BarChart2 className="w-4 h-4 text-[#2ECC71]" />
            {t('history.categoryPerformanceTitle')}
          </h2>
          <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1 sm:line-clamp-none mt-0.5" title={t('history.categoryPerformanceSub')}>{t('history.categoryPerformanceSub')}</p>
        </div>

        <div className="space-y-5">
          {[
            { key: 'commodities', label: t('market.commodities'), color: '#F5B942' },
            { key: 'crypto', label: t('market.cryptoFutures'), color: '#3B82F6' },
            { key: 'forex', label: t('history.forexSpot'), color: '#2ECC71' },
          ].map((cat) => {
            const data = (summary?.categoryBreakdown as any)?.[cat.key] || { count: 0, winRate: 0, rMultiple: 0 };
            return (
              <div key={cat.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-mono">
                  <span className="font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: cat.color }} />
                    {cat.label}
                    <span className="text-[var(--text-muted)] font-medium">({data.count})</span>
                  </span>
                  <span className="font-bold tabular-nums" style={{ color: cat.color }}>
                    {data.winRate}% WR &bull; {data.rMultiple >= 0 ? '+' : ''}{data.rMultiple}R
                  </span>
                </div>
                <div className="w-full bg-[var(--bg-surface)] rounded-full h-3 overflow-hidden border border-[var(--border-subtle)]">
                  <div
                    className="hev-bar-grow h-3 rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(0, data.winRate))}%`,
                      background: `linear-gradient(90deg, color-mix(in srgb, ${cat.color} 30%, transparent), ${cat.color})`,
                      boxShadow: `0 0 10px -1px color-mix(in srgb, ${cat.color} 70%, transparent), inset 0 1px 0 rgba(255,255,255,0.16)`,
                      transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Avg Risk:Reward - the GaugeRadial semicircle is back (compact), merged into this card's
            stat row instead of the flat progress bar the previous pass reduced it to, and instead
            of the dedicated full-size 5-column panel from before that. Same 0/1/2R colour
            thresholds/avgRiskReward figure as always - the exact R value is still printed at full
            precision next to the gauge, same as when this component was originally adopted here. */}
        {(() => {
          const raw = summary?.avgRiskReward ?? 0;
          const clamped = Math.max(0, Math.min(3, raw));
          const gaugeValue = (clamped / 3) * 100;
          const rrColor = raw >= 2 ? '#2ECC71' : raw >= 1 ? '#3B82F6' : '#FF4D4F';
          const rrZones: GaugeZone[] = [
            { from: 0, to: 33.3, color: '#FF4D4F', label: t('history.rrZoneBelow1') },
            { from: 33.3, to: 66.7, color: '#3B82F6', label: t('history.rrZone1to2') },
            { from: 66.7, to: 100, color: '#2ECC71', label: t('history.rrZone2plus') },
          ];
          return (
            <div className="mt-5 pt-4 border-t border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Target className="w-3.5 h-3.5 text-[#3B82F6] shrink-0" />
                <div className="min-w-0">
                  <span className="block text-[10px] font-bold font-mono uppercase tracking-wider text-[var(--text-muted)]">{t('history.rrGaugeTitle')}</span>
                  <span className="block text-[10px] text-[var(--text-muted)] truncate" title={t('history.rrGaugeSub')}>{t('history.rrGaugeSub')}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="text-right">
                  <span className="block text-2xl font-black font-mono tabular-nums" style={{ color: rrColor }}>
                    {raw >= 0 ? '+' : ''}{raw}R
                  </span>
                  <span className="block text-[9px] text-[var(--text-muted)] font-mono">{t('history.rrGaugeCaption')}</span>
                </div>
                <div className="-my-5 scale-90 origin-right">
                  <GaugeRadial value={gaugeValue} zones={rrZones} ticks={[0, 33.3, 66.7, 100]} size={92} />
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* 4c. Weekly Trend - self-contained cards (was a combo bar chart), one per week from
          weeklyBreakdown (see its useMemo above), which groups the full pair/category-filtered
          historyRecords into Monday-start weeks. Deliberately independent of the Today/Week/Month
          quick-filter so this trend never collapses to 1 card. Same fields, new presentation. */}
      {weeklyBreakdown.length > 0 && (
        <div className="hev-card-v2 !p-6 border border-[var(--border-subtle)] rounded-[16px] relative overflow-hidden">
          <div className="mb-5">
            <h2 className="text-sm font-bold font-mono text-[var(--text-primary)] tracking-wide flex items-center gap-2">
              <BarChart2 className="w-4 h-4 text-[#F5B942]" />
              {t('history.weeklyTrendTitle')}
            </h2>
            <p className="text-[11px] text-[var(--text-secondary)] line-clamp-1 sm:line-clamp-none mt-0.5" title={t('history.weeklyTrendSub')}>{t('history.weeklyTrendSub')}</p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
            {weeklyBreakdown.map((w, i) => {
              const isPositive = w.rMultiple >= 0;
              const color = isPositive ? '#2ECC71' : '#FF4D4F';
              return (
                <div key={i} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5">
                  <span className="block text-[9px] font-mono font-bold uppercase tracking-wider text-[var(--text-muted)] truncate">
                    {w.label}
                  </span>
                  <span className="block text-xl font-black font-mono tabular-nums mt-1.5" style={{ color }}>
                    {isPositive ? '+' : ''}{w.rMultiple}R
                  </span>
                  <div className="w-full h-1.5 rounded-full bg-[var(--border-subtle)] overflow-hidden mt-2.5">
                    <div
                      className="hev-bar-grow h-1.5 rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(0, w.winRate))}%`,
                        background: `linear-gradient(90deg, color-mix(in srgb, ${color} 35%, transparent), ${color})`,
                        boxShadow: `0 0 6px -1px color-mix(in srgb, ${color} 80%, transparent)`,
                        transition: 'width 400ms cubic-bezier(0.16, 1, 0.3, 1)',
                      }}
                    />
                  </div>
                  <span className="block text-[10px] font-mono font-bold text-[var(--text-secondary)] mt-1.5">{w.winRate}% WR</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </>
      ) : loading ? (
        <div className="space-y-6">
          {/* Equity curve + donut skeleton row */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 h-72 hev-card-v2 !p-6 border border-[var(--border-subtle)] rounded-[16px] flex flex-col">
              <div className="h-4 w-40 rounded bg-[var(--border-subtle)] animate-pulse mb-4" />
              <div className="flex-1 w-full rounded-lg bg-[var(--border-subtle)] animate-pulse" />
            </div>
            <div className="lg:col-span-4 flex flex-col gap-4">
              {[0, 1].map((i) => (
                <div key={i} className="h-[132px] hev-card-v2 !p-5 border border-[var(--border-subtle)] rounded-[16px] flex items-center gap-4">
                  <div className="w-20 h-20 rounded-full bg-[var(--border-subtle)] animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-2.5 w-full rounded bg-[var(--border-subtle)] animate-pulse" />
                    <div className="h-2.5 w-3/4 rounded bg-[var(--border-subtle)] animate-pulse" />
                    <div className="h-2.5 w-1/2 rounded bg-[var(--border-subtle)] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Category performance skeleton */}
          <div className="h-64 hev-card-v2 !p-6 border border-[var(--border-subtle)] rounded-[16px] space-y-4">
            <div className="h-4 w-48 rounded bg-[var(--border-subtle)] animate-pulse" />
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-6 w-full rounded bg-[var(--border-subtle)] animate-pulse" />
            ))}
          </div>

          {/* Weekly trend skeleton */}
          <div className="h-40 hev-card-v2 !p-6 border border-[var(--border-subtle)] rounded-[16px]">
            <div className="h-4 w-56 rounded bg-[var(--border-subtle)] animate-pulse mb-5" />
            <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-3">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 rounded-xl bg-[var(--border-subtle)] animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* 5. Filter Bar Ringkas */}
      <div className="no-print flex flex-col sm:flex-row items-center justify-between gap-4 hev-card-v2 !p-5 border border-[var(--border-subtle)] rounded-[16px]">
        <div className="flex items-center gap-2 text-xs font-mono font-bold text-[var(--text-secondary)] uppercase tracking-wider">
          <Filter className="w-4 h-4 text-[#2ECC71]" />
          <span>{t('history.filterAuditLog')}</span>
        </div>

        <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
          {/* Period Filter Buttons */}
          <div className="flex items-center gap-1 bg-[var(--bg-surface)] p-1 rounded-xl border border-[var(--border-subtle)] text-xs font-mono font-medium">
            <button
              type="button"
              onClick={() => setSelectedPeriod('today')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer font-bold ${
                selectedPeriod === 'today'
                  ? 'bg-[#2ECC71] text-black shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t('history.today')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedPeriod('week')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer font-bold ${
                selectedPeriod === 'week'
                  ? 'bg-[#2ECC71] text-black shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t('history.thisWeek')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedPeriod('month')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer font-bold ${
                selectedPeriod === 'month'
                  ? 'bg-[#2ECC71] text-black shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t('history.thisMonth')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedPeriod('all')}
              className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer font-bold ${
                selectedPeriod === 'all'
                  ? 'bg-[#2ECC71] text-black shadow-md'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {t('history.all')}
            </button>
          </div>

          {/* Pair Select */}
          <select
            value={selectedPair}
            onChange={(e) => setSelectedPair(e.target.value)}
            className="px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs font-mono font-medium focus:outline-none focus:border-[#2ECC71] transition-colors cursor-pointer"
          >
            <option value="all">{t('history.allPairs')}</option>
            <option value="XAUUSD">XAUUSD (Gold Spot)</option>
            <option value="BTCUSDT">BTCUSDT (Bitcoin)</option>
            <option value="ETHUSDT">ETHUSDT (Ethereum)</option>
            <option value="SOLUSDT">SOLUSDT (Solana)</option>
            <option value="EURUSD">EURUSD (Euro Dollar)</option>
            <option value="GBPUSD">GBPUSD (Pound Dollar)</option>
            <option value="USDCHF">USDCHF (Swiss Franc)</option>
            <option value="USDCAD">USDCAD (Loonie Dollar)</option>
          </select>

          {/* Category Select */}
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3.5 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] text-xs font-mono font-medium focus:outline-none focus:border-[#2ECC71] transition-colors cursor-pointer"
          >
            <option value="all">{t('history.allCategories')}</option>
            <option value="commodities">{t('market.commodities')}</option>
            <option value="crypto">{t('market.cryptoFutures')}</option>
            <option value="forex">{t('history.forexSpot')}</option>
          </select>
        </div>
      </div>

      {/* Footer Disclaimer Note */}
      <div className="hev-card-v2 !p-5 border border-[var(--border-subtle)] rounded-[16px] text-center text-[11px] text-[var(--text-muted)] font-mono leading-relaxed">
        {t('history.footerDisclaimer')}
      </div>
    </div>
  );
};
