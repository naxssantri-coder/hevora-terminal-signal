# HEVORA Auto Trading - MT5 Expert Advisor

This folder contains a native MetaTrader 5 Expert Advisor (EA) that polls the HEVORA admin API and
executes (or simulates) trades based on HEVORA's signal engine. It is **not** part of the website
deployment - it is a file you download and run inside your own MT5 terminal.

No Python, no external installer, no compiler to install separately - MT5 ships with everything
needed (MetaEditor) built in.

## What this EA does NOT do

- It never reads, stores, asks for, or transmits your broker login, password, or investor password.
  It runs inside an MT5 terminal session you have **already logged into manually**, exactly like any
  other EA you might attach to a chart.
- It never talks to your broker's server directly for anything except normal trading operations
  (open/close) - all of that goes through MT5's own built-in trade functions (`CTrade`), the same
  ones any manually-coded EA uses.
- The only network calls it makes to somewhere other than your broker are to the HEVORA website's
  own API (feed/ack/report), authenticated with a **Bridge API Key** - a random token you generate
  from Admin > Auto Trading > Rotate Bridge API Key. That key has nothing to do with your broker
  account.

## Step-by-step setup (for a non-technical admin)

1. **Copy the file.** In MetaTrader 5: `File > Open Data Folder`, then open the `MQL5\Experts`
   folder inside it. Copy `HevoraAutoTrade.mq5` from this folder into that `Experts` folder.

2. **Compile it.** Back in MT5, open the **Navigator** panel (`Ctrl+N` if it's hidden) and find
   `HevoraAutoTrade` under **Expert Advisors**. Right-click it and choose **Modify** - this opens
   MetaEditor automatically with the file loaded. Press **F7** (or click **Compile**) and wait for
   "0 errors" in the Toolbox at the bottom. Close MetaEditor.

3. **Allow WebRequest to the HEVORA domain.** In MT5: `Tools > Options > Expert Advisors` tab.
   Tick **"Allow WebRequest for listed URL"**, then click **Add** and enter your HEVORA site's URL
   (e.g. `https://your-hevora-domain.com` - no trailing slash). Click OK.

4. **Get your Bridge API Key.** In the HEVORA website, go to `Admin > Auto Trading`, click
   **Rotate Bridge API Key**, and copy the key shown (it is only ever shown once).

5. **Attach the EA to a chart.** Open any one chart (any pair - the EA polls all enabled pairs from
   a single instance, it does not need one instance per chart). Drag `HevoraAutoTrade` from the
   Navigator onto the chart. In the dialog that appears:
   - **Inputs tab**: set `HevoraApiBaseUrl` to your site's URL, `HevoraBridgeKey` to the key you
     copied, and leave `PollIntervalSeconds` at its default (5) unless you have a reason to change it.
   - **Common tab**: tick **"Allow Algo Trading"** (or **"Allow live trading"** on older builds).
   - Click **OK**.

6. **Make sure Algo Trading is ON globally.** Check the **"Algo Trading"** button in the MT5
   toolbar - it must be green/highlighted, not grey. If it's grey, click it once.

7. **Check the Experts/Journal tab.** You should see a log line like
   `HEVORA Auto Trade EA initialized. Polling https://... every 5s.` If instead you see an alert
   about WebRequest being blocked, go back to step 3 - the URL you typed must match exactly
   (including `https://`, no trailing slash).

## Testing before going live

The HEVORA dashboard's Auto Trading tab defaults to **Dry-run** mode, and this EA respects that
flag from the server on every poll - it will **not** send any real order while the site is set to
Dry-run. Instead, every action is written to the Experts/Journal log prefixed with `[DRY-RUN]`, e.g.:

```
HEVORA Auto Trade: [DRY-RUN] Simulasi OPEN BUY XAUUSDm vol=0.02 sl=4021.77 tp=4053.80 (tidak ada order sungguhan dikirim)
```

Leave it running in Dry-run for a while and confirm the log lines look sensible for your broker
symbol mapping and lot settings before switching the site's mode to **Live** from Admin >
Auto Trading (the dashboard shows a warning and asks for confirmation the first time you do this).
We also recommend testing Live mode on an MT5 **demo account** first, and confirming your broker
permits automated/EA trading, before pointing this EA at a real-money account.

## How it matches signals to positions

Every position this EA opens is tagged with the HEVORA `signalId` as its order **comment**, and
with a fixed magic number (`560700251`) unique to this EA. When a later event (TP1 hit, TP2 hit,
Stop Loss hit, or signal invalidated) arrives from the feed, the EA looks up the open position with
that same `signalId` in its comment (scoped to its own magic number, so it never touches manually
opened positions or other EAs' trades) and acts on it.

## TP1 / TP2 handling

Admin > Auto Trading has two independent checkboxes - **"Tutup penuh saat TP1 tersentuh"** and
**"Tutup penuh saat TP2 tersentuh"** (both on by default). There is no partial-close percentage -
each level either closes the position in full, or is skipped entirely (log-only, position left
alone) if its checkbox is off.

If both are enabled, TP1 always fires first on a given position (price reaches TP1 before it can
reach TP2), so the position is already closed by the time the TP2 event arrives. That is expected
and not an error: the EA looks for the position, doesn't find it, logs
`"Posisi ... sudah ditutup sebelumnya"`, and reports the TP2 event as a benign no-op success.

## Lot sizing

- **Fixed lot**: uses the lot value from Admin > Auto Trading directly. Always available regardless
  of account type - the safest choice if you want a guaranteed, predictable lot size.
- **Risk % Saldo**: computed live inside this EA at the moment of execution, using this account's
  own equity (`AccountInfoDouble(ACCOUNT_EQUITY)`) and this specific symbol's own tick value/tick
  size (`SymbolInfoDouble(..., SYMBOL_TRADE_TICK_VALUE/SYMBOL_TRADE_TICK_SIZE)`) - not calculated on
  the HEVORA server, which has no visibility into your broker's contract specs or your account
  balance. This works correctly on **any** account type - standard/Dollar or Cent - with no manual
  setting needed: MT5 always reports both equity and tick value in that same account's own deposit
  currency, so the risk% math already accounts for it automatically. The EA still logs which account
  type it detected (via `ACCOUNT_CURRENCY`) on every risk% calculation, purely so you can confirm in
  the Experts log that it recognized your account as expected.
- **Max Lot safety cap, either mode**: if the computed lot (fixed or risk%) exceeds the `Max Lot`
  you set for that pair, the order is **rejected outright** - not silently shrunk down - and logged/
  reported as a failure so you notice and adjust your settings instead of unknowingly trading a
  smaller (or differently-sized) position than intended.
- **Symbol mapping**: the "Broker Symbol" field for each pair (e.g. `XAUUSD` -> whatever your
  specific broker calls it) is never guessed or auto-suffixed by the system - it starts empty and
  must be typed in manually per pair, since broker symbol naming (suffixes like `m`, `.c`, `-ECN`,
  etc.) varies too much to assume safely.

## Troubleshooting

- **"WebRequest diblokir" alert**: the URL isn't in the allowed list yet, or doesn't match exactly
  (check for a stray trailing slash, `http` vs `https`, or a typo). Re-check step 3.
- **Feed HTTP status 401**: the Bridge API Key is wrong, empty, or was rotated on the website since
  you last copied it (rotating invalidates the previous key immediately). Copy it again from
  Admin > Auto Trading and update the EA's Inputs.
- **Nothing happens even though a signal fired**: confirm the pair is toggled on in Admin >
  Auto Trading's per-pair table, and that the global kill-switch is ON.
- **"Algo Trading tidak diizinkan" alert**: the MT5 toolbar's Algo Trading button is off, or this
  EA's own "Allow Algo Trading" checkbox (Common tab, when you attached it) is unticked. The EA
  keeps the event queued and retries automatically once trading is re-enabled - nothing is lost.
- All activity (including dry-run simulations) is visible in MT5's **Terminal > Experts** tab and
  the chart's **Experts** log - there is no separate log file to hunt for.
