# HEVTERMINAL by HEVORA — Technical Whitepaper

*A short, honest description of how this terminal generates what it shows you. Not a marketing
document, not a legal document (see the Company / Legal Hub in-app for Terms of Service, Privacy
Policy and Regulatory Disclosure) — this is the "how it actually works" reference, written to be
read alongside the code it describes.*

## 1. What this is

HEVTERMINAL is a market-data and analysis terminal covering gold (XAU), forex majors, and crypto.
It streams live prices, runs an AI-assisted signal engine, tracks macro data (interest rates,
inflation, positioning, liquidity), and — the part this document mostly covers — computes a set of
**confluence engines** that turn raw data into a plain-language read of "why does this market look
the way it does right now."

It is a research and analysis tool. It does not hold funds, execute trades, or manage money.
Nothing it shows is investment advice.

## 2. The one rule everything else follows

**No fabricated data, ever.** This is the single non-negotiable principle behind every design
decision in this document. Concretely:

- If a free, legal data provider is not available for something, the terminal shows an explicit
  `UNAVAILABLE` state (source name + last-successful-timestamp, never a blank or a guessed number)
  instead of estimating or interpolating.
- Every data point on screen carries **Source + Timestamp + Status** (`LIVE` / `DELAYED` / `STALE`
  / `UNAVAILABLE`), computed from how old the underlying fetch actually is — never hand-set.
- A missing input to a composite score is *excluded* from that score's calculation, not defaulted
  to a neutral value. A missing input silently pulling a score toward "neutral" would look like a
  real reading; excluding it and lowering the score's confidence instead is the honest version.
- Only free, public, legal data sources are used — official statistics agencies (FRED, CFTC,
  TreasuryDirect, EIA), exchanges' own public market-data APIs (OKX, and others where reachable),
  and API-documented free tools (GDELT, alternative.me). No paid data licenses, no scraping a site
  whose terms of use prohibit it.

## 3. Where the data comes from

| Domain | Source(s) | Notes |
|---|---|---|
| Crypto/forex/XAU prices | Exchange public APIs (OKX, with several documented fallbacks), Yahoo Finance for FX/indices | Multi-provider fallback chain; a provider outage degrades to the next one, then to an honest stale/unavailable state — never a fabricated tick. |
| Macro indicators (CPI, NFP, rates, real yield, etc.) | FRED (Federal Reserve Economic Data) | Free official API, requires a free API key. `ECON_INDICATORS` in `server.ts` is the single registry mapping every indicator to its real FRED series ID. |
| Futures positioning | CFTC Commitments of Traders | Official, weekly, free. |
| Crypto derivatives (funding rate, open interest, long/short ratio) | OKX public API v5 | The only crypto derivatives provider that reliably answers from this app's production host — documented in code where the others (Binance, Bybit) return region-blocked responses. |
| Geopolitical / macro news | Central-bank and government RSS feeds, commercial market-news RSS feeds (headline + link only, never full article text), GDELT DOC 2.0 | All feed into one Live Intelligence pipeline — see §5. |
| Economic calendar | ForexFactory's public weekly calendar feed | Server-side cached; degrades to a "stale, last known good" state rather than inventing events when the live fetch fails. |
| Oil (WTI/Brent) inventory | EIA (U.S. Energy Information Administration) | Free official API, requires a free API key (separate from FRED's). Shows an explicit "not configured" state, never an empty series read as "no change," when the key is absent. |

Every one of these is named, in the UI, next to the number it produced — never anonymized as
"our data."

## 4. The confluence engines

For XAU, BTC and forex, a **confluence engine** (`src/lib/confluence/`) computes a "Market State"
read from several independent, named factors — real yield, dollar momentum, positioning, funding
rate, volatility, and others depending on the asset. Each factor is a pure function of a real,
displayed data point:

```
factor.score  ∈ [-1, +1]   (bearish .. bullish, asset-direction, not "risk-off/risk-on")
factor.weight ∈ [0, 1]     (how much this factor counts toward the composite)
factor.reasoning           (one sentence of trader-language explanation, not just the number)
```

A factor with no live input is **excluded** from the composite, not scored zero. Below three live
factors, the engine reports "Insufficient Evidence" rather than a false-confidence composite. The
composite score, its full factor breakdown, and each factor's own source/timestamp are all shown
together — the score is never presented without the reasoning that produced it.

Separately, a **Market Regime** composite (`src/lib/analytics.ts`'s `computeRegime`) reads a
different, smaller set of cross-asset drivers (dollar session move, VIX, real-yield change, BTC
24h, gold 24h) to produce a single risk-on/risk-off read (0–100). This is a macro-condition
read, not a per-asset directional call — the two can legitimately disagree (e.g. gold can be both
"bullish" on its own confluence panel and a contributor to a "risk-off" macro regime reading at the
same time; that is two different, correctly-labeled kinds of statement about the same price move,
not a contradiction).

## 5. AI's actual role

Generative AI (Gemini) is used in four bounded, auditable places — every one of them classifies,
summarizes, interprets, or answers from data this server already has, never generates a number
from nothing:

1. **Headline classification.** The Live Intelligence pipeline (`scripts/live-intel-watcher.ts`)
   feeds article *headlines only* (never body text — a copyright boundary, not just a style choice)
   from RSS/GDELT sources to Gemini, which judges relevance, market impact, tone, and — for
   geopolitically-relevant items — a 0–100 geopolitical-risk score. The AI never invents a
   headline; it only classifies real ones, and every published item links back to its original
   source.
2. **Written summaries.** For classified items, Gemini writes an original one-paragraph summary
   from the headline alone — never reproducing the source outlet's own text.
3. **Macro narrative (AI Market Brief).** Given a bundle of this server's own latest real economic
   readings (CPI, NFP, DXY, 10Y yield, etc. — `gatherMacroNarrativeInputs()` in `server.ts`),
   Gemini writes a short structured interpretation ("what happened," "why it matters," a
   per-asset bias table with one-sentence reasoning). It is handed the real numbers, not asked to
   predict the next release.
4. **Ask AI (question answering).** A free-text question is answered from that same kind of real
   data bundle, with the prompt explicitly instructing the model to say a data point is
   unavailable rather than guess it, and to never give trade execution advice. Each question is
   answered independently — conversation history shown to the reader is not resent to the model as
   context, keeping what any one answer can be grounded in to one bounded, real data snapshot.

The AI is not used to generate prices, indicator values, or trading signals from nothing. It
classifies, summarizes, interprets and answers from real inputs; it does not fabricate them.

## 6. Signal engine

The signal engine (per-pair BUY/SELL/NONE cards) runs a rule-based technical read (trend/volatility
regime, structure, confluence adjustments) against live price data. Stop-loss and take-profit
levels are computed, not AI-guessed. Every signal is logged to a permanent history store so its
real outcome (hit TP, hit SL, still running) is auditable later in the Performance hub — signals
are never quietly deleted or their historical record edited after the fact.

## 7. What this document is not

This is a description of the current implementation, not a guarantee of future behavior, not
investment advice, and not a substitute for the Terms of Service, Privacy Policy, or Regulatory
Disclosure published in-app (Company hub → the relevant tab). Where those documents and this one
overlap, the in-app legal pages are the governing text.

---

*This document describes the codebase as of the "Roadmap Lanjutan" development round. It is
maintained alongside the code it describes, in `docs/`, and is not a mandatory in-app page per the
roadmap's own instruction.*
