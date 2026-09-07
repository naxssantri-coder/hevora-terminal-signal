# Investigation: why crypto/forex issue new signals far more often than XAUUSD after a TP/SL

**Status: answered, code-grounded, no behavior change.** This closes the question that was left
hanging across prior sessions: *"kenapa crypto/forex jauh lebih sering keluar sinyal baru (~10
menit setelah TP/SL) dibanding XAUUSD — apakah gate-nya sengaja lebih longgar atau ada kesenjangan
yang gak disadari."*

**Short answer: it is intentional, not an unnoticed gap.** The whole Fase A–C/I signal-quality
overhaul (regime taxonomy, anti-countertrend gate, post-SL anti-flip, counter-evidence logging)
was explicitly scoped to XAUUSD only, per this project's own standing convention (see CLAUDE.md:
"Never change behavior for any other pair … unless the user explicitly asks for that pair"). Every
one of those XAUUSD-only additions is a **hard rejection gate** layered on top of the same generic
score-threshold mechanism every pair already had — crypto/forex never got any of them, by design,
not by oversight. That is fully sufficient on its own to explain the frequency gap; no single bug
is responsible.

## The mechanism, with code references

`createInstitutionalScalpingSignal` (server.ts) runs the same pipeline for every pair, but XAUUSD
picks up several extra hard gates — each one can independently `return null` (fully block signal
generation), regardless of confluence score:

| Gate | Scope | Effect | Reference |
|---|---|---|---|
| Candle-freshness gate | XAUUSD only | Blocks entirely if newest candle > 15 min stale | server.ts:4525-4540, `XAU_CANDLE_STALE_THRESHOLD_MS` (996) |
| Volatility Regime Gate | XAUUSD only | Blocks entirely when ATR percentile ≥ 95th of its own last-20-bar history | server.ts:3636-3656, `XAU_EXTREME_VOL_PERCENTILE` (1064) = 0.95 |
| Fase B anti-countertrend gate | XAUUSD only | Rejects CHOCH_REVERSAL/LIQUIDITY_SWEEP_REVERSAL candidates opposing `regime.trend` during `regime.extreme`, unless genuine CHoCH + rejection close + clean retest all agree | server.ts (Fase B, commit fdc20ca) |
| Fase C post-SL anti-flip **hard** gate | XAUUSD only | Blocks an opposite-direction candidate for `XAU_POST_SL_ANTI_FLIP_WINDOW_BARS` = 6 bars (30 min at the 5-min bar interval XAUUSD candles use), and specifically for the first `XAU_POST_SL_ANTI_FLIP_CONFIRMATION_BARS` = 2 bars (10 min) if regime hasn't changed since the SL | server.ts:4555-4575, constants at 2282/2286 |
| High-impact USD news pause | XAUUSD + forex (not crypto) | Blocks -5m to +15m around high-impact USD calendar events | server.ts:3658-3680 |

None of these exist for BTCUSDT/ETHUSDT/SOLUSDT or the forex pairs. The only mechanism they share
with XAUUSD is the **generic, soft** adaptive-threshold penalty (isRecentLoss / consecutiveLosses
raising the required confluence score by up to +8/+12 — server.ts:4645-4657) — a signal that
scores high enough still fires immediately after a loss for those pairs. XAUUSD's Fase C gate, by
contrast, is a flat timing block that no confluence score can override.

## The candidate-generation asymmetry (the bigger factor)

On top of the extra hard gates, XAUUSD's underlying candidate generator is structurally stricter.
Since the Fase-A/ICT rework, `type` (BUY/SELL) for XAUUSD can **only** be set by
`evaluateXauIctSetups()` — one of three genuine ICT/SMC patterns (TREND_CONTINUATION retesting a
specific unmitigated OB/FVG by index, LIQUIDITY_SWEEP_REVERSAL requiring a candle-close-confirmed
sweep + CHoCH + rejection candle + clean retest, or a range S&D bounce) — server.ts:3774-3785.

Every other pair still falls through to the original, more permissive generic chain
(server.ts:3786-3829), which includes a pure momentum branch with **no structural confirmation at
all**:

```
} else if (Math.abs(marketPrice.change24h) >= 0.35 && adx >= 20) {
  type = marketPrice.change24h >= 0 ? 'BUY' : 'SELL';
  ...
```

A 0.35%+ 24h move with ADX ≥ 20 is common for crypto/forex intraday noise and fires a directional
candidate on its own — XAUUSD has no equivalent path since the ICT rework replaced its old generic
chain outright (server.ts:4062-4069, comment explicit about this). The generic chain also still
gets an H1-trend informational nudge that XAUUSD skips (server.ts:3837-3860) because XAUUSD
already has a stronger real-HTF gate baked into `evaluateXauIctSetups`.

## Base threshold: not the driver, and points the other way

`baseThreshold` is 70 for XAUUSD vs 68 for everyone else (server.ts:4610) — a small 2-point
difference in XAUUSD's favor of being *stricter*, consistent with the rest of the picture. But the
*escalation cap* after losses is actually smaller for XAUUSD (+10 max) than for other pairs (+18
max, server.ts:4667) — so on the soft-threshold axis alone, non-XAU pairs can in principle be
required to score *higher* post-loss than XAUUSD. This confirms the frequency gap is not coming
from the soft-threshold mechanism at all; it comes entirely from the hard gates and the stricter
candidate generator described above, which the soft-threshold numbers don't capture.

## Conclusion

- **Not an unnoticed gap.** Every one of the extra XAUUSD gates has its own commit, its own
  real-data backtest/audit (Fase B, Fase C, the volatility-gate percentile calibration), and is
  explicitly scoped `pairId === 'XAUUSD'` per this project's standing convention. Crypto/forex
  were never touched by that work because the roadmap was scoped to XAUUSD only.
- **The 30-minute post-SL anti-flip window (Fase C) is the most direct explanation for the
  specific "~10 minute after TP/SL" pattern the user described being absent on XAUUSD** — crypto/
  forex have no equivalent hard block, only a soft score penalty a strong candidate clears
  immediately.
- **The stricter ICT-only candidate generator is the larger structural factor** — it requires a
  genuine structural pattern to exist at all, where the generic engine used by every other pair
  will fire on a plain momentum move.
- This is a direct, intended consequence of deliberately raising XAUUSD's signal quality bar
  (fewer, better signals) — not a bug to fix and not a risk/money trade-off decision, since nothing
  here is being changed. No action taken; this doc exists so this question stops being re-asked
  across sessions.

No code was modified for this investigation — verified via `npx tsc --noEmit` unaffected (no
diff to server.ts or any other source file).
