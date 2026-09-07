# HEVORA — Audit Repo (§0) & Peta Arsitektur Fase 1

Dokumen ini adalah hasil langkah §0 (audit sebelum menulis kode) dan menjadi acuan
untuk fase-fase berikutnya. Semua isi di bawah adalah kondisi repo **sebelum** Fase 1,
plus catatan apa yang berubah / tidak berubah di Fase 1.

---

## 1. Peta Routing & Halaman (SEBELUM Fase 1)

Tidak ada router library. Navigasi = state `activeTab` di `App.tsx` + dua route manual
berbasis `window.location.pathname` (`pushState` + `popstate`).

| Cara navigasi | Nilai | Komponen perender |
|---|---|---|
| state `activeTab` | `overview` | `OverviewView.tsx` |
| state `activeTab` | `market` | `MarketView.tsx` (punya filter kategori internal: all/forex/crypto/commodities) |
| state `activeTab` | `intel` | `IntelView.tsx` (News + Research + Live Intelligence) |
| state `activeTab` | `calendar` | `EconomicCalendarView.tsx` (merender `EconomicHistoryView.tsx` di dalamnya) |
| state `activeTab` | `history` | `HistoryView.tsx` (History & Performance) |
| URL path | `/admin*` | `AdminDashboard.tsx` |
| URL path | `/intel/live/:id` | `LiveEventDetailPage.tsx` |

Konsekuensi penting: **tab tidak punya URL sendiri** — tidak bisa di-share/di-bookmark,
back button tidak bekerja antar tab. Ini yang diperbaiki di Fase 1.

Gating auth (WAJIB dipertahankan): semua tab selain `overview` memaksa `AuthModal` untuk
user yang belum sign-in, dan intent klik disimpan di `pendingNavigation` lalu di-replay
setelah sign-in sukses.

## 2. Komponen (sebelum Fase 1)

| File | Baris | Peran |
|---|---|---|
| `HistoryView.tsx` | 1837 | History & performance, equity curve, export PDF |
| `EconomicHistoryView.tsx` | 1399 | Arsip data ekonomi + macro narrative |
| `AdminDashboard.tsx` | 895 | Admin (internal, di luar i18n) |
| `MarketView.tsx` | 695 | Detail pair + TradingView + signal + RiskConsentGate + BrokerModal |
| `IntelView.tsx` | 689 | News/Research/Live Intelligence feed |
| `LiveEventDetailPage.tsx` | 650 | Halaman penuh detail live event |
| `Navbar.tsx` | 640 | Ticker marquee + brand + nav desktop + bottom nav mobile + ⌘K search + bell + theme + bahasa + auth |
| `types.ts` | 643 | Semua tipe domain (PairId, Signal, MarketPrice, dst) |
| `OverviewView.tsx` | 492 | Landing tab |
| `EconomicCalendarView.tsx` | 410 | Kalender ekonomi |
| Lain-lain | — | `RiskConsentGate`, `BlurredValue`, `PairIcon`, `ImageUploadField`, `IntroAnimation`, `AuthModal`, `BrokerModal`, `DisclaimerModal`, `Footer`, `TradingViewChart` |

## 3. Endpoint `server.ts` (315 KB, single file Express)

Publik:
`/api/signals` (prices + signals + scanStatus, dipoll tiap 1 detik), `/api/prices`,
`/api/history`, `/api/history/archive`, `/api/history/summary`, `/api/traders-count`,
`/api/settings`, `/api/updates`, `/api/research`, `/api/calendar`,
`/api/live-events`, `/api/live-events/stats`, `/api/live-events/:id`,
`/api/economic-history`, `/api/economic-history/indicators`,
`/api/economic-history/macro-narrative`, `/api/economic-history/market-context`,
`/api/engine/settings`, `/api/user/risk-acknowledgment` (GET/POST),
`/api/signals/:pairId/reanalyze`.

Admin: `/api/admin/*` (verify, storage-health, reset-history, engine/settings, ai-insights,
research CRUD, updates CRUD, live-events CRUD + AI autofill + YouTube transcript, settings).

Static/SPA: production memakai `express.static('public')` + fallback
`app.get(/^(?!\/api).*/) → index.html`; dev memakai Vite middleware `appType: 'spa'`.
**Artinya URL-based routing sudah didukung server tanpa perubahan apa pun.**

## 4. Data/engine yang TIDAK disentuh (§8)

Signal engine, scan status, penyimpanan `data/signals_store.json`, Upstash Redis,
Clerk auth (`@clerk/clerk-react` + `@clerk/backend`), integrasi TradingView
(`TradingViewChart.tsx`), AI validator (`@google/genai` / `openai` di server),
provider harga yang sudah terpasang, perhitungan history & performance — semuanya
tetap seperti semula. Fase 1 hanya menambah layer UI/navigasi **di atas** semua itu.

## 5. Stack

React 19 + TypeScript + Vite 6 + Tailwind v4 (`@tailwindcss/vite`, token via `@theme` +
CSS variable di `src/index.css`, tema dark/light lewat atribut `data-theme`), Express 4,
lucide-react (ikon), i18n internal (`src/i18n`, flat dot-key, en/id, default id).
Tidak ada test runner; `npm run lint` = `tsc --noEmit`.

---

## 6. Yang dikerjakan Fase 1

1. **Router internal** (`src/lib/router.tsx`) — History API, tanpa dependency baru.
   Route lama `/admin` dan `/intel/live/:id` tetap bekerja persis seperti sebelumnya.
2. **Module Registry** (`src/modules/registry.ts`) — sumber tunggal navigasi (§7.5).
   Modul baru cukup didaftarkan; sidebar, bottom nav, "Lainnya", sub-nav, dan global
   search otomatis ikut.
3. **Shell responsif** — sidebar kiri persisten (desktop), bottom nav 5 slot + sheet
   "Lainnya" berkelompok (mobile), ticker tape persisten di paling atas keduanya.
4. **Design system dasar** (`src/components/ui/`) — Panel, Skeleton, StateBlock,
   DataQualityBadge, Num/format angka monospace, Badge.
5. **State data** — Loading / Empty / Error / Unavailable / Stale / Live (§7.4) sebagai
   komponen bersama, dipakai semua modul baru.
6. **Global search / command center** (⌘K) — mencari modul + aset, hasil dikelompokkan.
7. **Scaffold arsitektur** — asset universe (§7.1), provider abstraction + fallback chain
   (§7.3), alert types (§7.9).

Modul yang belum dibangun **tidak menampilkan data palsu**: registry menandainya
`status: 'planned'` dan shell merender state "Module not available yet" beserta fase
pengerjaannya.

## 7. Pemetaan modul → komponen lama (Fase 1)

| Route | Komponen | Catatan |
|---|---|---|
| `/` | `OverviewView` | tanpa perubahan logika |
| `/market/overview`, `/market/forex`, `/market/commodities`, `/market/crypto` | `MarketView` | prop opsional `initialCategory` untuk pre-filter |
| `/signals/history` | `HistoryView` | sama dengan tab `history` lama |
| `/intelligence/news` | `IntelView` | termasuk Live Intelligence |
| `/calendar/economic` | `EconomicCalendarView` | tanpa perubahan |
| `/macro/economic-history` | `EconomicHistoryView` | sekarang punya URL sendiri |
| `/performance/overview` | `HistoryView` | |
| sisanya | placeholder | ditandai fase 2–7 di registry |


---

## 8. Fase 2 (Ringkasan, Pasar, Sinyal, Watchlist)

Semua dikerjakan sebagai **migrasi** dari komponen lama, bukan tulis ulang.

### Yang dipindahkan / dipakai ulang
| Dari | Ke | Catatan |
|---|---|---|
| Ranking "Top Signals" di `OverviewView` | `src/lib/signals.ts` (`pickTopSignals`, `compareSignals`) | Overview sekarang mengimpor helper ini; Live Signals & Scalping Radar memakai urutan yang sama persis |
| Logika risk consent (fail-closed) di `MarketView` | `src/lib/useRiskConsent.ts` + `components/signals/SignalGate.tsx` | `MarketView` sekarang memakai hook yang sama — tidak ada lagi dua salinan aturan |
| Kartu sinyal per pair di `MarketView` | `components/signals/SignalCard.tsx` | Level tetap dari engine, tidak ada perhitungan ulang |
| Baris watchlist di `OverviewView` | `components/watchlist/WatchlistView.tsx` | Format baris sama, sumber datanya asset universe |

### Modul yang jadi aktif
- **`/` Ringkasan** — navigasi berbasis route (prop `onNavigateToTab` dihapus, `TabType` shim hilang total), tombol bintang watchlist per baris.
- **`/market/*` Pasar** — aset sekarang ada di URL (`?symbol=XAUUSD`), jadi link ke satu aset bisa di-share dan tombol back menelusuri aset seperti menelusuri modul.
- **`/market/indices` Indeks** — modul baru dengan endpoint baru `GET /api/indices` (Yahoo Finance: S&P 500, Nasdaq, Dow, Russell, VIX, DXY, Nikkei, DAX, FTSE, Euro Stoxx 50). Cache 60 detik, request bersamaan digabung, simbol yang gagal dikembalikan `value: null` + `error` — tidak pernah diisi angka karangan.
- **`/signals/live` Live Signals** — semua setup aktif dari `/api/signals`, filter kelas & arah.
- **`/signals/scalping-radar` Scalping Radar** — semua pair diurutkan dari yang paling dekat ke entry zone, termasuk pair yang belum punya setup beserta alasan engine (`scanStatus.lastScanReason`). Kolom "To entry" = harga live vs entry zone yang sudah dipublikasikan, bukan ambang baru.
- **`/watchlist` Watchlist** — `localStorage` (`hev_watchlist`), dibangun di atas asset universe sehingga kelas aset baru otomatis bisa di-watchlist tanpa mengubah UI.

### Catatan penting
- **Timeframe**: engine menetapkan `timeframe: 'M5 / M15'` untuk semua sinyal (server.ts), jadi Scalping Radar **tidak** dibuat sebagai "filter timeframe pendek" — itu akan jadi duplikat Live Signals dengan nama berbeda. Radar dibuat sebagai sisi lain dari feed yang sama: kedekatan ke entry + status pemindaian.
- **Watchlist tidak menampilkan level entry/SL/TP** — level tetap di balik risk-consent gate (Market & Signals), sama seperti standar yang sudah berlaku di Overview.
- **Yahoo Finance diblokir (HTTP 403) di sandbox pengembangan ini**, jadi `/api/indices` di sini mengembalikan state `unavailable` — dan itu memang yang dirender modulnya. Provider yang sama sudah dipakai server untuk harga forex/DXY di produksi.


---

## 9. Fase 3 (Analisis)

Tujuh modul aktif: Market Regime, Currency Strength, Correlation, Volatility, Positioning,
Sentiment, Liquidity & Flow.

### Sumber data per modul
| Modul | Sumber | Status verifikasi |
|---|---|---|
| Market Regime | DXY (`/api/macro/dxy`, state engine yang sudah ada) + VIX & DFII10 (FRED, endpoint lama) + harga BTC/XAU | Logika terverifikasi; DXY & FRED butuh cek di produksi |
| Currency Strength | `/api/signals` — perubahan 24 jam 4 pair FX | **Terverifikasi dengan data nyata** |
| Correlation | `/api/market/candles` (candle 5m milik engine, endpoint baru) | Matematika terverifikasi; butuh candle terisi |
| Volatility | candle engine + high/low 24 jam dari quote | **Sebagian terverifikasi** (rentang 24 jam nyata) |
| Positioning | `/api/positioning/cot` — CFTC Socrata (baru) | Belum terverifikasi (403 di sandbox) |
| Sentiment | `/api/sentiment/fear-greed` — alternative.me (baru) + komposisi arah signal book sendiri | F&G belum terverifikasi; signal book **terverifikasi** |
| Liquidity & Flow | `/api/flow/stablecoins` — DefiLlama (baru) | Belum terverifikasi (403 di sandbox) |

### Endpoint baru di `server.ts` (semua additive, read-only)
`GET /api/market/candles` · `GET /api/macro/dxy` · `GET /api/sentiment/fear-greed` ·
`GET /api/positioning/cot` · `GET /api/flow/stablecoins`

Dua yang pertama hanya **menerbitkan state yang sudah dipelihara engine** (candle store & tracker
DXY) supaya modul Analisis memakai angka yang sama persis dengan yang dipakai engine — bukan
salinan kedua dari sumber berbeda. Tiga sisanya memanggil provider luar lewat satu pembungkus
cache + single-flight bersama; kalau gagal, klien diberi tahu datanya tidak tersedia.

### Keputusan yang sengaja diambil
- **Tidak ada angka yang disetahunkan.** Engine menyimpan ~30 candle 5 menit (±2,5 jam). Volatility
  melaporkan σ per bar, ATR sepanjang jendela, dan rentang 24 jam apa adanya. Menskalakan 2,5 jam
  jadi angka tahunan akan mengubah pengukuran kecil yang nyata menjadi angka besar yang mengada-ada.
- **Market Regime menahan skornya** kalau driver yang melapor kurang dari 3, dan driver yang mati
  **dikeluarkan** dari rata-rata berbobot, bukan dianggap netral — kalau tidak, input yang hilang
  akan menarik skor ke 50 dan terbaca seperti "netral" yang asli.
- **Korelasi yang tidak bisa dihitung tampil sebagai strip, bukan 0** — "tidak terhitung" dan
  "tidak berkorelasi" adalah dua pernyataan berbeda.
- **COT dibaca defensif**: nama kolom Socrata dicari lewat beberapa alias; kalau skema dataset
  berubah, panel melaporkan unavailable, bukan menerbitkan kolom yang salah baca.
- **Fear & Greed diberi label khusus crypto**, tidak dipakai sebagai sentimen pasar menyeluruh.
- **Retail positioning (IG/Myfxbook) dan ETF flow (Farside/GLD/SLV) tidak dipasang** dan ditandai
  "provider belum terpasang" — bukan didekati dari pergerakan harga.

### Verifikasi
`src/lib/analytics.ts` diuji dengan 24 asersi (pearson, stdev, ATR, matriks korelasi, currency
strength, ambang & bobot regime) — semuanya lulus. Dua asersi awal yang gagal ternyata ekspektasi
tesnya yang salah, bukan kodenya: VIX 12 memang belum cukup ekstrem untuk skor risk-on penuh.


---

## 10. Fase 4 (Makro)

Delapan modul aktif: Overview, Central Banks, Interest Rates, Yield Curve, Treasury, DXY, COT,
Inflation & Growth. Economic Calendar dan Economic History sudah aktif sejak Fase 1.

### Pendekatan
Tidak ada klien FRED kedua. Semua modul membaca lewat `/api/economic-history` yang sudah terbukti
— sudah punya cache, sudah punya state `needsSetup`, dan tidak pernah mengarang titik data. Yang
ditambahkan hanya **6 seri baru** ke `ECON_INDICATORS`: DGS3MO, DGS2, DGS5, DGS30, EFFR, WALCL.
Semuanya dilaporkan FRED dalam satuan yang ditampilkan, jadi lewat cabang generik tanpa transform.

### Catatan teknis
- `EconomicHistoryView` dulu memakai `Record<EconIndicatorId, string>` untuk tiga peta label.
  Menambah seri baru langsung memecahkan tipe itu. Solusinya bukan melonggarkan jadi `Partial`
  (yang membuat `t()` menerima `undefined`), tapi **mempersempit** ke alias lokal `PageIndicatorId`
  berisi 13 indikator yang memang dirender halaman itu — peta tetap dicek exhaustive, dan seri
  backend baru tidak lagi memaksa halaman itu menumbuhkan label yang tidak akan dipakai.
- **FRED tanpa key ≠ provider mati.** `FredSetupNotice` membedakan keduanya: yang satu perlu
  diperbaiki, yang satu perlu ditunggu.
- **Kartu yang datanya kosong tetap di grid** dengan strip. Kartu yang dihilangkan akan membuat
  grid tidak lengkap terlihat lengkap.
- **Arah langkah Fed diturunkan dari selisih dua bacaan target terakhir**, bukan label manual.
- ECB/BOJ/BOE, selisih suku bunga antar negara, dan lelang treasurydirect **tidak dipasang** dan
  ditandai apa adanya.
- `/macro/cot` dan `/analysis/positioning` merender komponen yang sama dari endpoint yang sama.


---

## 11. Fase 5 (Intelligence)

Lima modul aktif: Research, Breaking News, AI Market Brief, Central Bank Events, AI Event Analysis.
News Feed sudah aktif sejak Fase 1.

### Sumber data (semuanya endpoint yang sudah ada — nol endpoint baru)
| Modul | Endpoint |
|---|---|
| Research | `/api/research` |
| Breaking News | `/api/live-events` difilter `impact === 'High'`, jendela 48 jam |
| AI Market Brief | `/api/economic-history/macro-narrative` + signal book + `/api/live-events` |
| Central Bank Events | `/api/calendar` (filter kata kunci bank sentral) + `/api/live-events` (pidato) |
| AI Event Analysis | `/api/live-events` — verdict AI + snapshot reaksi atPublish/+15m/+1h |

### Keputusan
- **AI Event Analysis tidak menampilkan prediksi pra-event.** Kolom forecast adalah konsensus yang
  diterbitkan penyedia kalender. Tebakan AI atas angka yang belum rilis adalah titik data karangan.
- **Kolom reaksi adalah harga terukur**, bukan hasil model. Jendela yang belum terlewati tampil
  sebagai strip — "belum terekam" dan "tidak bergerak" itu dua pernyataan berbeda.
- **AI Market Brief menolak menulis paragraf pengisi.** Kalau narasi belum ada atau output model
  gagal cek skema di server, halaman menampilkan unavailable.
- `MacroNarrativeStructured` dipindah dari lokal `EconomicHistoryView` ke `types.ts` — dua modul
  membaca endpoint yang sama, dua salinan interface pasti akan menyimpang.

### Verifikasi
Ketiga sumber (`live-events`, `research`, `macro-narrative`) **kosong di sandbox** (fresh clone,
tanpa watcher & tanpa key). Jalur render diverifikasi dengan menyuntik payload di layer network
Playwright — tidak menulis apa pun ke repo maupun server. Aritmetika kolom reaksi dicek manual:
XAU 4030→4021 = −0,22%, 4030→4012 = −0,45%, DXY 104,2→104,6 = +0,38%, BTC 67000→66450 = −0,82%,
semuanya cocok. State kosong aslinya juga di-screenshot.


---

## 12. Fase 6 (Performa)

Dua modul baru: Paper Trading dan Trading Journal. Performance sudah aktif sejak Fase 1
(`HistoryView`).

### Keputusan
- **Keduanya `localStorage`, tanpa perubahan backend.** Ini data milik user, bukan data platform —
  sama polanya dengan Watchlist di Fase 2. Tidak perlu skema server.
- **Paper Trading tidak punya kolom harga entry.** Posisi dibuka dan ditutup di harga yang sedang
  dikutip feed saat tombol ditekan. Fill di harga yang tidak pernah dicetak pasar akan membuat
  rekam jejaknya fiksi — dan rekam jejak fiksi lebih buruk daripada tidak punya rekam jejak sama
  sekali. Saat harga tidak tersedia, tombolnya dimatikan, bukan mundur ke harga basi.
- **Journal tidak bisa menciptakan transaksi.** Barisnya berasal dari `/api/history`; jurnal hanya
  menambahkan catatan user di atas sinyal yang benar-benar sudah ditutup engine.

### Verifikasi (dengan data nyata)
- Dijalankan end-to-end di browser: buka 2 posisi di harga live 4.025,50, tutup satu di harga live,
  cek isi `localStorage` — `entryPrice`/`exitPrice` keduanya berasal dari feed, bukan input.
- Journal menampilkan **8 sinyal tertutup asli** dari `/api/history` (GBP/USD Stop Loss Hit −1,00R,
  USD/CAD TP1 Hit, dst). Catatan tersimpan terhadap id record asli
  `HIST-SIG-GBPUSD-MSDBDF45-msua7j17`.
- Harga entry dan exit kebetulan sama karena feed beku di sandbox, jadi P&L 0 — perilaku yang benar,
  bukan bug.


---

## 13. Fase 7 (Advanced)

Enam modul baru: Momentum, Market Structure, Anomaly Detection, Market Breadth, On-Chain Macro,
dan **Alerts** — plus satu endpoint baru `GET /api/flow/chains` (DefiLlama TVL per chain).

Dengan ini **seluruh 42 modul di registry berstatus `active`** — tidak ada lagi placeholder.

### Sumber data
| Modul | Sumber | Terverifikasi di sandbox? |
|---|---|---|
| Momentum | candle engine + harga live | Sebagian (kolom 24 jam nyata) |
| Market Structure | `structureBreakdown` dari `/api/signals` | **Ya, data nyata** |
| Anomaly Detection | candle engine (z-score) | Matematika teruji |
| Market Breadth | harga live | **Ya, data nyata** |
| On-Chain Macro | DefiLlama chains + stablecoins | Tidak (403) |
| Alerts | harga + sinyal live | **Ya, alert menyala beneran** |

### Keputusan
- **Market Structure tidak mendeteksi ulang apa pun.** Tiap kolom adalah boolean yang sudah
  dipublikasikan engine pada sinyalnya, jadi yang tampil persis apa yang dipakai engine untuk
  bertindak. Pair tanpa setup aktif = tidak punya pembacaan struktur, berbeda dari semua-false.
- **RSI ditahan di bawah periode 14 bar**, z-score ditahan di bawah 8 observasi. Menandai anomali
  dari tiga bar itu derau yang didandani jadi temuan.
- **Market Breadth menyebut cakupannya di panel**: delapan instrumen, breadth atas universe sendiri,
  bukan internal S&P.
- **Alert dievaluasi di shell**, terhadap state live yang sama dengan yang dibaca semua modul —
  satu evaluasi per pembaruan feed. Aturan yang inputnya hilang **tetap diam**, tidak menyala atas
  nilai asumsi. Tiap aturan punya cooldown 10 menit.

### Yang TIDAK dikerjakan (disengaja)
§9 Fase 7 juga menyebut **Market Intelligence Graph** dan **custom dashboard**. Keduanya tidak
dibangun: graph butuh model relasi antar-entitas yang akan tipis tanpa sumber data yang belum
terpasang (COT/ETF flow/retail), dan custom dashboard butuh persistensi layout milik user. Lebih
baik disebutkan apa adanya daripada dikirim setengah jadi.

### Verifikasi
21 asersi baru untuk alert engine + analitik Fase 7 (ambang, cooldown, aturan mati, input hilang,
RSI/z-score ditahan, breadth) — semuanya lulus, ditambah regresi 24 asersi Fase 3 yang tetap hijau.
Alur alert dijalankan end-to-end di browser: aturan dibuat, engine mengevaluasinya terhadap feed
live, event tercatat dengan harga nyata 4.025,50 dan rute kembali ke asetnya.
