# HEVORA Roadmap — Status Tunggal

Satu sumber kebenaran untuk status roadmap "HEVORA AI — Struktur Terminal & Roadmap Pengembangan".
Menggantikan kebutuhan audit ulang dokumen besar di setiap sesi baru — cek file ini dulu sebelum
menyentuh kode. Tiga kategori: **SELESAI** (bukti file/PR), **DI-SKIP PERMANEN** (alasan jujur,
jangan dicoba lagi tanpa perubahan kondisi mendasar), **BELUM DIKERJAKAN** (checklist aktif).

Aturan yang berlaku di semua kategori di bawah: tidak ada data fabrikasi/mock/placeholder angka —
kalau sumber tidak bisa diakses/diparsing/berbayar, statusnya jujur "Unavailable"/"Coming Soon" di
UI, bukan ditutupi.

## SELESAI

### Struktur & navigasi
- **7-tab structure** (Dashboard/Markets/Analysis/Macro/Intelligence/Calendar/Performance +
  Company) sesuai spesifikasi Bagian 1 — `src/modules/registry.ts`, `src/components/shell/TopNav.tsx`.
- **COT di tab Makro** (`/macro/cot`), redirect dari `/analysis/positioning` —
  `src/modules/registry.ts` (`LEGACY_ROUTE_REDIRECTS`).
- **Calendar terkonsolidasi** di `/calendar/economic` — `src/components/calendar/CalendarHub.tsx`.
- **Label Order Book BTC/ETH-USDT benar per-instrumen**, termasuk subtitle bersama yang sebelumnya
  masih bilang "BTC-USDT only" saat menampilkan ETH-USDT — PR #54, commit `d4b2507`,
  `src/components/market/BtcUsdtOrderBookView.tsx`, `src/i18n/{en,id}.ts`.
- **Sub-tab Indices**: live via Yahoo Finance, error jujur per-simbol, terintegrasi ke Markets hub
  lewat filter `?class=` (bukan tab kosong) — `src/components/market/IndicesView.tsx`.
- **About/Team/Terms of Service/Privacy Policy/Regulatory Disclosure**: satu modul `company-info`
  (`/company/about`), lima tab, badge "PLACEHOLDER — BUTUH INFO ASLI" untuk data yang genuinely
  tidak ada (nama tim, badan hukum) — `src/components/company/LegalHub.tsx`.
- **Whitepaper teknis**: `docs/HEVORA-WHITEPAPER.md`.

### Data & driver makro
- **Real Yield curve 5Y/10Y/30Y** (FRED DFII5/DFII10/DFII30) di Policy & Rates hub — tidak ada 1Y
  (Treasury tidak pernah menerbitkan TIPS 1 tahun, dinyatakan jujur di UI) —
  `src/components/macro/PolicyRatesHub.tsx`.
- **Real Yield ditonjolkan di Gold Intelligence Overview** (sebelumnya hanya ada di Policy & Rates
  hub) — panel highlight full-width, reuse `useFredSeries`/`DataQualityBadge`/`FredSetupNotice` —
  PR #54, commit `cce8583`, `src/components/macro/GoldIntelligenceHub.tsx`.
- **Kartu "Gold Bias Hari Ini"** (tally DXY + Real Yield + Geo Risk + CB buying flow, bukan skor
  tunggal yang dikarang — gold's own price sengaja TIDAK jadi input kelima, menghindari sirkularitas
  yang sama yang bikin driver gold di `computeRegime` dipotong bobotnya) + **chart Real Yield vs
  Gold (futures GC=F)**, reuse `DualAxisAreaChart` yang sudah ada — `src/components/macro/GoldIntelligenceHub.tsx`.
- **Obligasi pemerintah 10Y negara lain** (DE/GB/JP/AU/CA, seri OECD MEI) di Policy & Rates hub —
  `src/components/macro/PolicyRatesHub.tsx` (`FOREIGN_YIELDS`).
- **GDELT DOC 2.0 → pipeline Geopolitical Risk** (sumber tambahan, headline-only, masuk ke pipeline
  `market-news` yang sudah ada, bukan sistem paralel) — `scripts/live-intel-watcher.config.ts`,
  `scripts/live-intel-watcher.ts`.
- **Funding Rate + Open Interest + Long/Short Ratio crypto** (OKX, public, tanpa key) — endpoint
  `/api/crypto/derivatives`, `src/components/market/CryptoDerivativesView.tsx`, dipasang di Order
  Book & Liquidity hub.
- **Currency Strength +JPY/AUD/NZD** (dari 4 ke 7 pair) —
  `src/components/analysis/CurrencyStrengthView.tsx`, `src/components/analysis/InsightSummaryView.tsx`.
- **Komoditas** (Silver/Palladium/Oil/Copper + agrikultur) sudah lengkap di `COMMODITY_SPECS` —
  `server.ts`. Diverifikasi ulang (Batch C): Silver (SI=F), Palladium (PA=F), Copper (HG=F) semua
  punya `group: 'metals'`, tanpa `defersTo` — sudah dapat harga penuh + confluence read lengkap
  yang sama seperti WTI, bukan cuma baris tabel. Tidak diubah.
- **Inflasi multi-negara** (CPI YoY Jerman/Inggris/Jepang/Kanada, OECD MEI `CPALTT01{negara}M659N`
  — keluarga seri yang sama dengan obligasi asing DE10Y/GB10Y/JP10Y/CA10Y, pattern-matched bukan
  live-verified karena sandbox tanpa akses jaringan; mnemonic salah akan gagal jujur ke status
  kosong, bukan angka palsu) — `server.ts` (`ECON_INDICATORS`), `src/types.ts`
  (`EconIndicatorId`), `src/components/macro/EconomyLiquidityHub.tsx` (tabel Inflation & Growth).
  Australia sengaja tidak diikutkan (rilis CPI OECD-nya kuartalan, bukan bulanan, jadi konvensi
  M659N tidak berlaku dan menebak mnemonic kuartalannya terlalu banyak tebakan untuk satu commit).
- **Oil Intelligence** (WTI/Brent + EIA weekly crude inventory) — backend (`/api/energy/crude-stocks`,
  confluence factor) sudah ada sebelumnya; ditambahkan strip glance-able khusus di atas tabel
  Commodities (sebelumnya WTI/Brent cuma baris tabel + inventory hanya muncul kalau WTI dipilih) —
  `src/components/commodities/CommodityBoard.tsx`. `EIA_API_KEY` didokumentasikan di `.env.example`
  (free registration, sama seperti FRED) — kalau belum diset, panel menampilkan status jujur
  "belum terpasang", bukan angka kosong.
- **Risk-on/Risk-off Flow card** (Gold vs BTC vs USD/DXY, side by side, same feeds Market Regime
  already uses) — `src/components/analysis/RiskFlowView.tsx`, wired into Analysis hub row 3.
- **Interest Rate Differential vs Fed** per foreign central bank (ECB/BOE/BOJ/RBA/BOC), computed
  from the two series already loaded on the page (Fed target, each bank's own rate) —
  `src/components/macro/PolicyRatesHub.tsx` (Policy Factors grid).
- **Global Central Bank Stance** badge row (FED + 5 foreign banks, Hawkish/Dovish/Neutral from
  each bank's own last two prints, same read the Fed's own stance gauge already uses) —
  `src/components/macro/PolicyRatesHub.tsx` (Policy Factors panel).
- **Correlation regime-change alert** — flags a pair whose correlation flipped sign (crossing
  ±0.3 on both ends) since the Correlation panel was first opened this session, honestly scoped
  (no fabricated multi-day baseline; this build has no 1H/1D candle history to diff against) —
  `src/components/analysis/CorrelationView.tsx`.
- **Indeks utama** (SPX/NDX/DJI/Russell/VIX/DXY/Nikkei/DAX/FTSE/EuroStoxx) sudah lengkap di
  `INDEX_SYMBOLS` — `server.ts`.

### Konsistensi AI / Market Regime
- **Driver DXY di Market Regime** dulu baca window 15 menit sementara driver lain skala harian
  ("DXY netral padahal market koreksi") — diperbaiki dengan field `changeSessionPct` di
  `/api/macro/dxy`, dipakai `src/lib/useMarketRegime.ts`.
- **Driver gold di Market Regime** dulu men-skor tiap kenaikan harga gold sebagai risk-off padahal
  sudah confound dengan driver real-yield/dolar yang terpisah ("regime risk-off padahal XAU
  bullish") — bobot driver gold dipotong 0.15 → 0.08, dipindah ke dua driver yang lebih bersih.

### Keamanan
- **Security headers** (HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
  Permissions-Policy, CSP production-only) — `server.ts` middleware.
- **Rate limiting per-IP** untuk `/api/*` (240 req/menit, sliding window, `Retry-After` header) —
  diuji live via curl — `server.ts`.
- **CORS**: tidak ada wildcard `Access-Control-Allow-*`; allowlist eksplisit via `HEV_ALLOWED_ORIGINS`.
  Diverifikasi ulang secara eksplisit terpisah dari security headers (Batch D): tidak ada
  `Access-Control-Allow-Credentials`, origin di-reflect hanya kalau ada di allowlist (bukan
  reflect-semua-origin), header `Vary: Origin` sudah benar dipasang. Sudah cukup ketat, tidak
  diubah.

### AI, visualisasi, dan dokumentasi (Batch D)
- **AI Agent context-aware sederhana** — tab baru "Ask AI" di AI Studio hub: pertanyaan bebas
  dijawab dari `POST /api/ai/ask`, digroundkan ke bundel data makro/pasar nyata yang sama dengan
  yang sudah dipakai AI Market Brief (`gatherMacroNarrativeInputs()`), prompt melarang eksplisit
  mengarang angka di luar bundel itu. Rate limiter terpisah & lebih ketat dari limiter umum (6
  pertanyaan/menit per IP, karena panggilan LLM punya biaya nyata per-request) — diuji live via
  curl: 3 sukses lalu 429 dengan `Retry-After` yang benar. Riwayat percakapan hanya di sisi client
  untuk tampilan, tidak dikirim balik sebagai context (tiap pertanyaan dijawab independen, sesuai
  kualifier "sederhana" — bukan agent multi-turn penuh, yang sudah ditandai item roadmap terpisah
  di dokumen asli). — `server.ts` (`/api/ai/ask`), `src/components/intelligence/AskAiView.tsx`,
  `AiStudioHub.tsx`.
- **Heatmap visual (Batch D)** — ditinjau ulang: Currency Strength (bar chart diverging 1D) dan
  Market Regime (gauge + driver tiles) sudah pakai visualisasi yang tepat untuk bentuk data
  masing-masing (ranking 1 dimensi, bukan matriks); memaksakan heatmap ke situ akan menurunkan
  keterbacaan, bukan menaikkan. Correlation (satu-satunya data matriks NxN di app ini) sudah pakai
  `Heatmap` component. Tidak ada perubahan — tidak ditemukan "yang jelas kurang" sesuai kualifier
  item ini.
- **Whitepaper teknis diupdate** (`docs/HEVORA-WHITEPAPER.md`) — §5 sebelumnya bilang AI "dipakai
  di persis dua tempat" padahal sebenarnya sudah 4 sejak sebelum sesi ini (macro narrative/AI
  Market Brief tidak pernah disebutkan) + item baru sesi ini (Ask AI) — diperbaiki jadi 4 tempat
  lengkap. §3 tabel sumber data ditambah baris EIA (oil inventory) yang sebelumnya tidak
  eksplisit ada barisnya sendiri.
- **Data Health Center diperkuat** (admin-only, `/api/admin/data-health`) — dua temuan audit nyata
  diperbaiki: (1) label "FRED (37 macro indicators)" ternyata SUDAH DRIFT dari kenyataan
  (`ECON_INDICATORS` sebenarnya berisi 50 entri saat diaudit) — sekarang dihitung dinamis dari
  `Object.keys(ECON_INDICATORS).length`, tidak bisa drift lagi; (2) baris cross-check baru: VIX
  Yahoo (live index quote, dipakai board Indices) vs VIX FRED VIXCLS (daily close, dipakai semua
  komposit makro) — dilaporkan sebagai dua angka + selisih untuk dibaca admin, bukan klaim
  pass/fail (selisih memang wajar karena beda waktu baca). Provider lain di app ini nyaris tidak
  ada overlap data genuinely cross-provider untuk dibandingkan (disiplin "satu data satu sumber"
  yang sudah dipegang app ini sejak awal). — `server.ts` (`/api/admin/data-health`).

### Perbaikan kecil
- Order Book/Liquidity Map: penjelasan panjang "Zona swing & FVG adalah inferensi…" dipindah ke
  `InfoTooltip`.
- Kalender: banner jelas + timestamp fetch-sukses-terakhir saat feed tidak bisa diakses.
- **Reliabilitas feed Calendar** (diverifikasi ulang, tidak diubah): sudah honest degradation
  penuh — cache stale disajikan dengan flag `stale: true` daripada mengarang event baru, kosong
  jujur kalau belum pernah fetch sukses sama sekali, `lastFetchedAt` selalu ada di setiap bentuk
  respons. **Actual/Forecast/Previous** (diverifikasi ulang, tidak diubah): field yang tidak ada
  dari provider tampil sebagai "—", tidak pernah dikarang — `server.ts`
  (`fetchRealEconomicCalendar`), `TodayCalendarView.tsx` menampilkan ketiganya penuh.
- **Integrasi Calendar↔Regime↔AI**: kartu Insight AI (`InsightSummaryView.tsx`) sekarang juga
  membaca event kalender high-impact hari ini (data yang sama persis dengan yang sudah dipakai
  `TodayCalendarView`, bukan fetch kedua) — kalau ada rilis high-impact yang masih menunggu,
  disebutkan di ringkasan yang sama dengan skor Market Regime, menghubungkan ketiganya di satu
  kartu alih-alih tiga kartu terpisah tanpa hubungan.
- Bug bilingual: 3 key `confluence.disclaimer/viewDetail/hideDetail` di `en.ts` ternyata berisi
  teks Bahasa Indonesia — diperbaiki.

## DI-SKIP PERMANEN

Jangan dicoba lagi tanpa perubahan kondisi mendasar (API baru rilis, kebijakan lisensi berubah,
dsb).

- **FedWatch probability** — butuh harga settlement futures CME 30-Day Fed Funds; akses "gratis"
  CME tetap terikat lisensi yang melarang redistribusi terprogram; FRED tidak punya seri ini. Tidak
  ada sumber gratis+legal+sesuai-ToS.
- **Retail sentiment forex (Myfxbook/IG)** — dikecualikan eksplisit oleh roadmap sendiri sebagai
  pelanggaran ToS/scraping. OANDA position ratio butuh akun broker, bukan sentimen retail luas.
- **PBOC & Bank Indonesia** (suku bunga/obligasi) — tidak ada seri OECD MEI atau FRED lain untuk
  kedua negara ini (keduanya bukan anggota OECD dengan cakupan MEI). Badge jujur "Belum Terpasang"
  tetap ada di UI (`NOT_WIRED_BANKS`).
- **Binance/Bybit sebagai sumber utama derivatives crypto** — Binance mengembalikan HTTP 451,
  Bybit HTTP 403 dari hosting produksi (geo-block). OKX dipakai sebagai satu-satunya sumber yang
  terbukti bisa diakses.
- **ETF Holdings GLD/IAU flow** — halaman kepemilikan SPDR (GLD) adalah aplikasi React tanpa data
  di HTML mentahnya; dua jalur API yang dipanggilnya sendiri mengembalikan XLSX dan PDF, bukan
  JSON yang bisa diparsing (audit lengkap: `src/components/analysis/OtherFlowsView.tsx`). Tidak
  ditemukan sumber JSON gratis untuk IAU juga. Status jujur ini sekarang ditampilkan langsung di
  Gold Intelligence Overview (`GoldIntelligenceHub.tsx`) — bukan cuma didiamkan di komponen yang
  tidak dipakai.
- **Bookmap-style order book visualization** — item roadmap besar terpisah, prioritas rendah,
  sengaja tidak dikerjakan bareng item lain (butuh desain data & rendering sendiri).
- **Domain premium** — keputusan bisnis pemilik produk, bukan tugas kode.
- **Pair forex/crypto baru tanpa verifikasi `npm run verify:sources`** — codebase punya disiplin
  wajib: pair baru harus diverifikasi live (density feed + histori) sebelum masuk `pairs.ts`. Kalau
  sandbox tidak punya akses jaringan keluar untuk menjalankan verifikasi itu, pair TIDAK ditambah
  tanpa verifikasi — dicatat di sini, bukan ditambahkan dengan asumsi.
- **Gold physical premium per negara** (opsional di roadmap) — tidak ada sumber gratis yang
  dikenal/terverifikasi untuk premium fisik per negara (beda dengan DXY/FRED/OKX yang API publiknya
  terdokumentasi jelas), dan sandbox ini tidak punya akses jaringan keluar untuk meriset sumber
  baru. Karena ini eksplisit ditandai opsional di roadmap sendiri, di-skip daripada menebak sumber
  yang belum terverifikasi.

## BELUM DIKERJAKAN

### Batch A — pakai data yang sudah ada di kode

(semua item Batch A selesai — lihat SELESAI di atas)

### Batch B — butuh sumber data baru tapi gratis & jelas asalnya

(semua item Batch B selesai/di-skip dengan alasan — lihat SELESAI dan DI-SKIP PERMANEN di atas)

### Batch C — perluasan coverage

(semua item Batch C selesai/sudah ada/di-skip dengan alasan — lihat SELESAI dan DI-SKIP PERMANEN di atas)

### Batch D — lebih berat, dikerjakan paling akhir

(semua item Batch D selesai — lihat SELESAI di atas. Roadmap ini sekarang habis; item baru masuk
lewat request terpisah, bukan menambah ke daftar ini.)
