# Fase 8 — Laporan Audit (§1 pembersihan tab + §2–§3 data universe)

Status: **laporan, belum ada kode**. Sesuai §7 dan §12, tidak ada yang dibangun sebelum
laporan ini direview.

---

## BAGIAN A — Batas kepercayaan laporan ini (baca duluan)

Sandbox pengembangan ini **tidak bisa menjangkau satu pun sumber data eksternal**. Bukti,
dijalankan barusan:

| URL diuji | HTTP |
|---|---|
| `query1.finance.yahoo.com/v8/finance/chart/CL=F` | `000` (blocked) |
| `farside.co.uk/bitcoin-etf-flow-all-data/` | `000` |
| `www.gold.org` | `000` |
| `deribit.com/api/v2/public/get_index_price` | `000` |
| `blockchain.info/q/hashrate` | `000` |
| `api.eia.gov` | `000` |
| `api.llama.fi/v2/chains` | `000` |

Artinya untuk tiap baris audit di Bagian C saya **tidak bisa membuktikan** sumbernya hidup,
formatnya seperti apa, atau rate limit-nya berapa. Ini persis risiko yang §7 ingin dihindari.

Repo ini sudah pernah kena masalah yang sama dan sudah punya solusinya:
`scripts/verify-feeds.ts` — headernya menulis sendiri *"the sandbox this project is developed
in cannot reach those domains… Search evidence is a real signal but it is NOT the same as
opening the URL."* Skrip itu dijalankan dari mesin normal lewat
`.github/workflows/verify-feeds.yml`.

**Rekomendasi #1: bikin `scripts/verify-sources.ts` dengan pola yang sama** — satu pass yang
menembak semua kandidat di Bagian C, mencetak status/format/sample, exit non-zero kalau ada yang
gagal. Dijalankan sekali dari GitHub Actions, laporan ini berubah dari "berdasar pengetahuan"
jadi "terverifikasi". Itu pekerjaan setengah jam yang menghemat berhari-hari salah bangun.

Tiap baris di Bagian C punya kolom **Keyakinan**:
- `WIRED` — sudah jalan di kode sekarang, terbukti (bisa saya cek langsung)
- `FREE-API` — API publik terdokumentasi, tanpa key / key gratis. Belum diuji dari sini
- `FREE-SCRAPE` — datanya gratis tapi tanpa API resmi → harus scrape HTML. Rapuh
- `NOT-FREE` — hanya ada di provider berbayar
- `UNKNOWN` — belum ketemu jawabannya, perlu diprobe

---

## BAGIAN B — §1 Pembersihan tab (terverifikasi dari kode)

### B1. "Kenapa ada 2 Ringkasan/Overview" — ketemu, dan bukan duplikasi isi

Ini **tabrakan label, bukan duplikasi data**. Tiga modul berbeda dilabeli sama persis
`'Overview'` di kamus Inggris:

| Modul | Route | Label EN | Label ID | Komponen | Isi sebenarnya |
|---|---|---|---|---|---|
| `ringkasan` | `/` | **Overview** | Ringkasan | `OverviewView` | Dashboard: kartu statistik, top signals, watchlist |
| `market-overview` | `/market/overview` | **Overview** | Overview | `MarketView` | Daftar aset + chart TradingView + detail sinyal |
| `macro-overview` | `/macro/overview` | **Overview** | Overview | `MacroOverviewView` | 9 kartu makro (rate, kurva, VIX, likuiditas) |

Isinya benar-benar berbeda. Yang salah cuma penamaan — di sidebar EN terbaca "Overview" tiga
kali di tiga grup. **Perbaikannya rename, bukan hapus.** Usul: `Dashboard` / `All Markets` /
`Macro Snapshot`.

### B2. Duplikasi isi yang NYATA (komponen sama persis, dua route)

| Route A | Route B | Komponen | Catatan |
|---|---|---|---|
| `/analysis/positioning` | `/macro/cot` | `PositioningView` | Sengaja saya buat begitu di Fase 4 — satu laporan, dua pintu masuk |
| `/signals/history` | `/performance/overview` | `HistoryView` | Sama persis, dua nama |

Keduanya duplikat asli. §1 memang minta Signal History pindah ke Performa → hapus
`/signals/history`, sisakan `/performance/overview`. Untuk COT, saya sarankan sisakan
`/macro/cot` saja dan hapus `/analysis/positioning`, karena §10 minta Institutional Flow jadi
sub-view di Liquidity & Flow — COT akan tampil di sana juga.

### B3. Tab yang §1 minta dihapus — dampak & rencana pemindahan

| Modul | Data & kode yang ada | Kalau halaman dihapus |
|---|---|---|
| `watchlist` | `lib/watchlist.ts` (localStorage) + bintang di baris Ringkasan | **Simpan hook & bintangnya.** Ringkasan sudah punya daftar aset — jadikan itu watchlist-nya. Nol kehilangan data |
| `paper-trading` | `lib/paperTrading.ts` + view | Tidak ada pengganti. Hapus halaman = fitur hilang. **Perlu keputusanmu**: buang beneran, atau pindahkan ke bawah chart aset |
| `trading-journal` | `lib/journal.ts` + view | Sama. Catatan user tersimpan di localStorage — kalau halamannya hilang, datanya jadi tidak bisa diakses |
| `alerts` | `lib/alerts/{engine,store,types}.ts` + view | §1 bilang notifikasi tetap ada sebagai toast global. **Engine dan store dipertahankan**, yang dihapus cuma halamannya — tapi lalu tidak ada tempat untuk *membuat* rule. Perlu diputuskan: rule dibuat dari mana? |

**Ini yang saya butuh keputusanmu sebelum menghapus apa pun** (§1: "laporkan daftarnya dulu").
Menghapus 4 halaman itu membuang ±1.100 baris kode yang jalan dan terverifikasi. Paper Trading
dan Journal khususnya tidak punya rumah baru di struktur §1.

---

## BAGIAN C — §2 Data universe audit

### C0. Koreksi: yang ditulis "sudah ada" di prompt tapi sebenarnya BELUM

Ini penting karena memengaruhi estimasi kerja. Prompt Fase 8 menganggap beberapa hal sudah
terpasang; saya cek ke kode, ternyata belum:

| Klaim di prompt | Kenyataan di `main` |
|---|---|
| "Put/Call & Max Pain Deribit sudah dipakai di Fase 3" | **Belum.** Deribit tidak pernah dipanggil. Sentiment Fase 3 = alternative.me Fear & Greed saja |
| "funding, OI, basis, liquidation (sudah ada)" | **Belum.** Binance/Bybit hanya dipakai untuk harga & kline |
| "total market cap, dominance (sudah ada)" | **Belum.** CoinGecko dipakai hanya sebagai *fallback harga* BTC/ETH/SOL |
| "whale activity (sudah ada dari Fase 1 infra)" | **Belum.** Etherscan/BscScan tidak pernah dipasang |
| "hash rate, difficulty (sudah ada)" | **Belum.** blockchain.info tidak pernah dipasang |
| "DEX volume (sudah ada dari DefiLlama)" | **Sebagian.** TVL per chain + stablecoin ✅, DEX volume ❌ |
| "EIA sudah ada infrastrukturnya" | **Belum.** Itu dari PR Macro yang di-revert 3× — tidak ada di `main` |
| "Copper harga dari Yahoo (sudah dipakai)" | **Belum.** Yahoo dipakai untuk FX, XAU, DXY, dan 10 indeks saja |
| "ETF flow Farside sudah ada" | **Belum.** Tidak pernah dipanggil |
| "COT per komoditas, infrastrukturnya sudah ada" | **Benar sebagian.** Endpoint CFTC ✅ jalan, tapi baru 6 market code (XAU, EUR, GBP, CHF, CAD, BTC). Menambah komoditas = tambah kode kontrak, murah |

Yang memang benar-benar sudah ada: FRED (13 seri), CFTC COT, Yahoo (FX/XAU/DXY/indeks),
DefiLlama (TVL + stablecoin), alternative.me, candle engine, kalender ForexFactory, dan
13 sumber RSS di watcher.

### C1. Temuan produksi yang mengubah pilihan provider

`server.ts:2815` mencatat: **`api.binance.com` / `fapi.binance.com` mengembalikan HTTP 451 dari
Render** (region-blocked), makanya Binance ditaruh sebagai fallback terakhir di bawah
Bybit → KuCoin → OKX → CoinGecko.

Konsekuensi untuk Fase 8: **semua rencana derivatif crypto (funding, OI, liquidation) tidak
boleh dibangun di atas Binance.** Harus Bybit/OKX. Ini fakta produksi, bukan dugaan.

### C2. XAU/USD (§2.1) — 40 metrik

| Kelompok | Metrik | Sumber | Freq | Keyakinan |
|---|---|---|---|---|
| Price | Spot | gold-api + Yahoo | Realtime | **WIRED** |
| Price | Futures curve | Yahoo per-kontrak (GC=F, GCM25…) | Delayed | UNKNOWN |
| Price | COMEX open interest | CFTC (`open_interest_all`) | Weekly | **WIRED** (sudah di response COT) |
| Price | Options IV / skew | CME berbayar | — | **NOT-FREE** |
| Rates | 2Y/5Y/10Y/30Y | FRED DGS2/5/10/30 | Daily | **WIRED** |
| Rates | Real yield | FRED DFII10 | Daily | **WIRED** |
| Rates | Breakeven inflation | FRED T10YIE | Daily | FREE-API |
| USD | DXY | Yahoo DX-Y.NYB | Near-realtime | **WIRED** |
| USD | USD funding (SOFR) | FRED SOFR | Daily | FREE-API |
| USD | Fed balance sheet | FRED WALCL | Weekly | **WIRED** |
| USD | RRP | FRED RRPONTSYD | Daily | FREE-API |
| USD | Bank reserves | FRED WRESBAL | Weekly | FREE-API |
| USD | TGA | FRED WTREGEN | Weekly | FREE-API |
| Fed | Policy rate | FRED DFEDTARU | Per-meeting | **WIRED** |
| Fed | Rate expectations | CME FedWatch tanpa API publik | — | **NOT-FREE** |
| Fed | Statement/speech sentiment | Watcher RSS + AI tone | Event | **WIRED** |
| Treasury | Issuance | treasurydirect.gov API | Daily | FREE-API |
| Treasury | Auction demand (bid-to-cover) | treasurydirect.gov API | Per-lelang | FREE-API |
| Treasury | Curve shape | dihitung | Daily | **WIRED** |
| Position | COT non-commercial | CFTC | Weekly | **WIRED** |
| Position | ETF holdings & flow (GLD/IAU) | spdrgoldshares / iShares | Daily | FREE-SCRAPE |
| Physical | Central bank purchases | World Gold Council | **Monthly** | FREE-SCRAPE |
| Physical | Mine supply/demand | World Gold Council | **Quarterly** | FREE-SCRAPE |
| Cross | Gold/SPX, Gold/BTC, Gold/DXY, Gold/RealYield | dihitung dari data yang ada | Realtime | **WIRED** |
| Cross | Gold/Oil, Gold/Silver | butuh CL=F & SI=F dari Yahoo | Delayed | FREE-API |
| Macro | CPI, NFP, unemployment, GDP, PMI | FRED + arsip | Monthly | **WIRED** |
| Macro | PCE | FRED PCEPI | Monthly | FREE-API |
| Macro | Inflation expectations | FRED T5YIE / MICH | Daily/Monthly | FREE-API |
| Geo | Risk score | dihitung dari news high-impact Fase 5 | Event | Computable |

**XAU coverage: 37/40 = 92%** — 21 sudah WIRED, 12 FREE-API, 3 FREE-SCRAPE (rapuh),
1 UNKNOWN (futures curve), 2 NOT-FREE (options, FedWatch).

Kenapa setinggi ini: FRED menutupi hampir seluruh sisi rates/USD/liquidity/macro, dan
infrastruktur FRED sudah jalan sejak Fase 4 — menambah seri = satu baris di `ECON_INDICATORS`.

### C3. Komoditas (§2.2) — 21 metrik

| Kelompok | Metrik | Sumber | Keyakinan |
|---|---|---|---|
| Energy | WTI (CL=F), Brent (BZ=F), NatGas (NG=F) | Yahoo | FREE-API |
| Energy | Inventory mingguan | EIA API (**key gratis**) | FREE-API |
| Energy | Futures curve | Yahoo per-kontrak | UNKNOWN |
| Metals | Copper (HG=F), Platinum (PL=F), Palladium (PA=F) | Yahoo | FREE-API |
| Metals | Silver (SI=F) | Yahoo | FREE-API |
| Metals | Aluminum / Nickel / Zinc | LME berbayar | **NOT-FREE** |
| Agri | Wheat, Corn, Soybeans, Coffee, Sugar, Cocoa, Cotton | Yahoo futures ticker | FREE-API |
| Semua | COT per komoditas | CFTC (tambah market code) | FREE-API |

**Commodities coverage: 17/21 = 81%** — 3 NOT-FREE (base metals LME), 1 UNKNOWN (curve).

⚠️ Catatan penting: **seluruh baris "Yahoo" di sini belum pernah diuji dari mana pun.** Yahoo
sudah terbukti jalan untuk FX/XAU/DXY/indeks di kode kita, tapi ticker futures (`CL=F`, `ZW=F`)
belum. Kalau Yahoo ternyata tidak melayani ticker futures dengan andal, angka 81% ini runtuh
jadi ~20%. **Ini kandidat probe nomor satu.**

### C4. Crypto (§2.3) — 20 metrik

| Metrik | Sumber | Keyakinan |
|---|---|---|
| Harga majors | Bybit / KuCoin / OKX | **WIRED** |
| Total market cap, dominance | CoinGecko `/global` | FREE-API |
| Funding rate, Open Interest | **Bybit / OKX** (bukan Binance — 451 di Render) | FREE-API |
| Basis (spot vs perp) | dihitung | Computable |
| Liquidation | Bybit terbatas; Coinglass berbayar | UNKNOWN |
| Options IV / skew / term | Deribit public API | FREE-API |
| Exchange inflow/outflow | Glassnode / CryptoQuant | **NOT-FREE** |
| Whale transfer | Etherscan (key gratis) | FREE-API |
| Active addresses | blockchain.info | FREE-API |
| Realized cap, MVRV, SOPR | Glassnode | **NOT-FREE** |
| Stablecoin supply | DefiLlama | **WIRED** |
| Exchange reserves | CryptoQuant | **NOT-FREE** |
| ETF flow BTC/ETH | Farside (HTML) | FREE-SCRAPE |
| TVL | DefiLlama | **WIRED** |
| DEX volume | DefiLlama | FREE-API |
| Fees, hash rate, difficulty | blockchain.info / mempool.space | FREE-API |
| Miner flows | Glassnode | **NOT-FREE** |

**Crypto coverage: 14/20 = 70%** — 4 NOT-FREE (semua metrik on-chain kelas Glassnode),
1 FREE-SCRAPE, 1 UNKNOWN.

### C5. Forex (§2.4) — 10 metrik

| Metrik | Sumber | Keyakinan |
|---|---|---|
| Spot | Yahoo + open.er-api | **WIRED** |
| Volatility per pair | candle engine | **WIRED** |
| COT & positioning per currency | CFTC (EUR/GBP/CHF/CAD sudah ada) | **WIRED** |
| Correlation vs DXY | dihitung | **WIRED** |
| Rate differential | FRED (rate ECB/BOE/BOJ — ID seri perlu diverifikasi) | FREE-API |
| Yield differential | FRED (yield 10Y per negara) | FREE-API |
| Carry | dihitung dari rate differential | Computable |
| Economic surprise index | dihitung dari actual vs forecast kalender | Computable |
| Session liquidity | dihitung dari jam — tanpa API | Computable |
| CB expectation per currency | tidak ada padanan FedWatch gratis | **NOT-FREE** |

**FX coverage: 9/10 = 90%** — paling murah dikerjakan, hampir semuanya turunan data yang sudah ada.

### C6. Global Macro & Non-Market (§2.5) — 12 metrik

| Metrik | Sumber | Keyakinan |
|---|---|---|
| Fiscal: debt, deficit, receipts, spending | FRED GFDEBTN / MTSDS133FMS / dll | FREE-API |
| Housing, manufacturing, consumer confidence, trade balance | FRED | FREE-API |
| RBA, BOC | FRED / situs resmi (RSS sudah di watcher) | FREE-API |
| PBOC | tanpa API resmi berbahasa Inggris | UNKNOWN |
| Bank Indonesia | bi.go.id (RSS **sudah ada di watcher**), data rate tanpa API | FREE-SCRAPE |
| Shipping index (Baltic Dry) | Trading Economics berbayar | **NOT-FREE** |
| Energy supply disruption | tidak ketemu sumber terstruktur | **NOT-FOUND** |

**Global Macro coverage: 8/12 = 67%**

---

## BAGIAN D — Ringkasan coverage

```
XAU Intelligence Coverage : 92%  (37 dari 40 metrik)
Commodities Coverage      : 81%  (17 dari 21)  ← bergantung Yahoo futures ticker, BELUM DIUJI
Crypto Coverage           : 70%  (14 dari 20)
FX Coverage               : 90%  (9 dari 10)
Global Macro Coverage     : 67%  (8 dari 12)
------------------------------------------------------
TOTAL                     : 83%  (85 dari 103 metrik)
```

**Angka ini estimasi berbasis pengetahuan, bukan hasil uji.** Yang paling rapuh: Commodities
(seluruhnya bertumpu pada asumsi Yahoo melayani ticker futures) dan 3 baris FREE-SCRAPE di XAU
(WGC, GLD holdings) yang secara historis paling sering rusak karena struktur HTML berubah —
persis alasan PR Macro dulu di-revert.

## BAGIAN E — Yang saya sarankan dikerjakan, urut

1. **`scripts/verify-sources.ts`** (½ hari) — probe semua baris FREE-API/FREE-SCRAPE/UNKNOWN di
   atas, jalankan dari GitHub Actions, cetak matriks nyata. Ini mengubah 83% estimasi jadi angka
   terverifikasi, dan menghapus risiko terbesar sebelum coding besar.
2. **Keputusanmu untuk Bagian B3** — 4 halaman yang mau dihapus, khususnya Paper Trading &
   Journal yang tidak punya rumah baru.
3. **Rename 3 "Overview"** (§B1) — 10 menit, langsung menyelesaikan keluhan "tab tumpang tindih".
4. **Confluence Engine XAU** (§4) — begitu 1 & 2 beres. XAU coverage 92% berarti hampir semua
   input untuk supporting/contradicting factor sudah tersedia; ini memang pilihan aset yang benar
   untuk membuktikan konsepnya.

Yang saya sarankan **jangan** dikerjakan dulu: Commodities (§2.2) sebelum probe Yahoo futures
selesai — kalau ternyata tidak jalan, itu 17 metrik yang salah dibangun.


---

## BAGIAN F — HASIL TERVERIFIKASI (run #3, GitHub Actions, 2026-08-16)

Estimasi di Bagian C sekarang **tergantikan oleh pengukuran nyata**. 43 OK · 5 FAIL · 0 SKIP,
semua probe kritis lulus.

### Yang terbukti JALAN

| Kelompok | Hasil | Bukti dari log |
|---|---|---|
| Yahoo futures | **15/15** | semua ticker komoditas mengembalikan harga |
| FRED seri baru | **8/8** | T10YIE, SOFR, RRPONTSYD, WRESBAL, WTREGEN, PCEPI, T5YIE, GFDEBTN |
| FRED rate asing | **3/3** | ECBDFR, BOJ, BOE — mis. BOE `2026-02-01 = 3.7274` |
| CFTC | OK | 400 market code ditemukan (bukan ditebak) |
| OKX funding | OK | `BTC-USDT-SWAP 0.0000688` |
| **OKX open interest** | **OK** | `OI 3.363.229` — endpoint yang run pertama belum tes |
| OKX OI history | OK | 719 baris — cukup untuk baca flow, bukan cuma titik |
| Deribit options | OK | 818 opsi, semuanya bawa `mark_iv` |
| CoinGecko global | OK | BTC dominance 56,16% |
| blockchain.info / mempool | OK | hashrate + fee |
| DefiLlama DEX volume | OK | 24h $4,11 B |
| treasurydirect | OK | 36 lelang, bid-to-cover terbaca |
| **EIA crude stocks** | **OK** | `2026-08-07 = 194615` — key bekerja |
| GLD holdings (scrape) | OK | penanda "Total Net Asset" ada |
| WGC gold demand (scrape) | OK | penanda demand ada |

### Yang terbukti TIDAK bisa (5)

| Probe | Hasil | Konsekuensi |
|---|---|---|
| `bybit:funding` | 403 | Dikonfirmasi terblokir. **OKX jadi jalur utama** derivatif crypto |
| `bybit:open-interest` | 403 | idem |
| `farside:btc-etf-flow` | 403 | Sumber ETF flow BTC utama tidak bisa dipakai |
| `yahoo:IBIT-shares` | 401 | Yahoo v10 quoteSummary butuh crumb/cookie |
| `yahoo:GLD-shares` | 401 | idem |

`coingecko:btc-etf-proxy` OK tapi isinya **treasury korporat, bukan ETF flow** — sudah ditandai
begitu di output probe-nya sendiri supaya tidak salah dipakai.

### Keputusan yang mengikuti hasil ini

1. **Komoditas boleh dikerjakan.** Coverage 81% di Bagian C3 valid — asumsi Yahoo terbukti benar.
2. **Derivatif crypto: OKX, bukan Bybit.** Funding, OI, dan OI history ketiganya jalan. Deribit
   membuka opsi IV/skew yang di Fase 3 dikira sudah ada padahal belum.
3. **ETF flow BTC/ETH: `Provider not wired`.** Tiga jalur dicoba, tiga-tiganya gagal. Sesuai aturan
   keras §10, ini ditandai apa adanya — **tidak** didekati dari pergerakan harga atau volume.
   Yang tetap bisa: **Gold ETF flow via GLD holdings** (scrape jalan) dan **COT percentile**.
   Jadi §10 tetap bisa dikerjakan sebagian, tidak diblok total.
4. **EIA aktif** — inventory minyak mingguan siap dipakai untuk modul Energy.
5. **Rate diferensial FX siap** — ketiga seri rate bank sentral asing jalan.

## BAGIAN G — Source Coverage Matrix (§3), terverifikasi

| Data | Source | Frequency | Status |
|---|---|---|---|
| Harga spot XAU | gold-api + Yahoo | Realtime | LIVE |
| Yield 3M/2Y/5Y/10Y/30Y | FRED | Daily | LIVE |
| Real yield, breakeven | FRED DFII10 / T10YIE | Daily | LIVE |
| DXY | Yahoo DX-Y.NYB | Near-realtime | LIVE |
| Fed balance sheet, RRP, reserves, TGA | FRED | Weekly | LIVE |
| COT + percentile | CFTC | **Weekly** | LIVE |
| GLD holdings | spdrgoldshares (scrape) | Daily | LIVE (rapuh) |
| Central bank gold purchase | WGC (scrape) | **Monthly** | LIVE (rapuh) |
| Treasury auction | treasurydirect | Event | LIVE |
| Komoditas (15 ticker) | Yahoo futures | Delayed | LIVE |
| Crude inventory | EIA | **Weekly** | LIVE |
| Crypto funding / OI | **OKX** | Near-realtime | LIVE |
| Options IV / skew | Deribit | Near-realtime | LIVE |
| Dominance, market cap | CoinGecko | Near-realtime | LIVE |
| Hash rate, fees | blockchain.info / mempool | Daily / Realtime | LIVE |
| DEX volume, TVL, stablecoin | DefiLlama | Daily | LIVE |
| Rate asing (ECB/BOJ/BOE) | FRED | Monthly | LIVE |
| **BTC/ETH ETF flow** | — | — | **PROVIDER NOT WIRED** |
| Opsi emas (IV/skew) | CME | — | NOT FREE |
| Fed rate expectations | CME FedWatch | — | NOT FREE |
| Base metals (Al/Ni/Zn) | LME | — | NOT FREE |
| On-chain MVRV/SOPR/reserves | Glassnode | — | NOT FREE |

---

## BAGIAN H — Run #4 dan #5: probe baru untuk Commodities, Crypto, Forex

Dua run tambahan setelah engine-nya dibangun. Yang baru diuji di sini adalah hal-hal yang
sebelumnya cuma diasumsikan.

### H1. Kode kontrak COT komoditas — diuji, dan enam label saya salah

Probe `cftc:commodity-codes` (kritis) mengambil ke-13 kode yang dipasang di `server.ts` lalu
membandingkannya dengan nama pasar yang benar-benar dikembalikan CFTC. Semua kode ketemu, tapi
enam nama tidak sama dengan tebakan umum:

| Simbol | Kode | Nama yang benar-benar dikembalikan CFTC |
|---|---|---|
| CL=F | 067651 | **WTI-PHYSICAL** - NEW YORK MERCANTILE EXCHANGE |
| HG=F | 085692 | **COPPER-GRADE #1** - COMMODITY EXCHANGE INC. |
| KC=F | 083731 | COFFEE C - **NEW YORK BOARD OF TRADE** |
| SB=F | 080732 | SUGAR NO. 11 - **NEW YORK BOARD OF TRADE** |
| CC=F | 073732 | COCOA - **NEW YORK BOARD OF TRADE** |
| CT=F | 033661 | COTTON NO. 2 - **NEW YORK COTTON EXCHANGE** |

Pencocokan dilakukan lewat kode, jadi tidak ada data yang salah sambung — tapi label itulah yang
dikirim ke klien sebagai `market`, dan nama pasar yang tidak cocok dengan pasarnya adalah persis
jenis ketidakjujuran kecil yang probe ini dibuat untuk menangkap. Sudah dikoreksi ke nama terukur.

### H2. Yang lain

| Probe baru | Hasil |
|---|---|
| `yahoo:CL=F 1y daily` | OK — 251 penutupan harian, cukup untuk MA50 dan analog |
| `yahoo:EURUSD=X / GBPUSD=X / USDCHF=X / USDCAD=X 1y daily` | OK 4/4 — simbol spot `=X` beda namespace dari futures, jadi diprobe sendiri |
| `eia:crude-stocks` | Run #4 timeout 20 detik, run #5 OK — jadi timeout-nya sementara, bukan blokir |

**Run #5 (commit `3a6a340`): 49 OK · 5 FAIL · 0 SKIP, semua probe kritis lulus.**
Lima kegagalan tetap yang itu-itu saja: `bybit:funding`, `bybit:open-interest` (403, sudah
digantikan OKX), `farside:btc-etf-flow` (403), `yahoo:IBIT-shares`, `yahoo:GLD-shares` (401).

### H3. Yang ditandai belum tersambung di UI (§10)

Bukan cuma dicatat di dokumen ini — sekarang tercetak di panelnya sendiri, lengkap dengan alasan:

| Aset | Input yang hilang | Status di panel |
|---|---|---|
| BTC/USDT | Spot BTC ETF net flow | `Provider not wired` |
| USD/CHF | Suku bunga kebijakan CHF (SNB) | `Provider not wired` |
| USD/CAD | Suku bunga kebijakan CAD (BoC) | `Provider not wired` |

### H4. Celah yang ditutup

`InterestRatesView` sebelumnya menyatakan tidak ada sumber suku bunga bank sentral lain yang
tersambung, jadi selisih suku bunga FX tidak bisa ditampilkan. Run #3 membuktikan ECBDFR,
IRSTCI01GBM156N, dan IRSTCI01JPM156N semuanya bisa diambil, jadi ketiganya sekarang jadi indikator
di pipeline FRED — dan EUR/USD serta GBP/USD punya faktor selisih suku bunga yang nyata, berlabel
**Monthly**, karena seri itu memang terbit bulanan.

---

## BAGIAN I — §10 Institutional Flow, dibangun

Institutional Flow sekarang jadi sub-view di Liquidity & Flow (`/analysis/liquidity-flow`), sesuai
keputusan awal. Tiga bagian, tiga sikap kejujuran yang berbeda:

1. **Stablecoin Liquidity** — tidak berubah, sudah jalan dari sebelumnya.
2. **Institutional Flow (baru)** — crowdedness COT lintas semua market yang ter-cover (19 market:
   6 pasangan + 13 komoditas), diurutkan dari yang paling ekstrem. Percentile yang selama ini cuma
   dipakai di dalam Confluence Engine sekarang tercetak juga di sini dan di halaman COT (`/macro/cot`,
   badge "PCTL"). Market dengan observasi < 8 minggu tidak dipaksakan punya percentile — namanya
   disebutkan eksplisit di bawah chart, bukan didiamkan.
3. **Not Wired (diperjelas)** — dua badge terpisah dengan alasan spesifik masing-masing, bukan lagi
   satu kalimat generik.

### I1. GLD holdings — dicoba, ditolak, dan sekarang tercatat kenapa

Tiga run eksplorasi (lewat runner GitHub Actions, kode dibuang setelah dipakai) terhadap URL nyata
SPDR dan WGC:

| Yang diprobe | Hasil |
|---|---|
| Halaman `spdrgoldshares.com/usa/historical-data/` | React SPA — HTML mentahnya tidak berisi angka, cuma `__NEXT_DATA__` (props halaman, tidak ada data holdings) |
| `api.spdrgoldshares.com/api/v1/historical-archive` (ditemukan dari kode SPA) | Mengembalikan **berkas XLSX**, bukan JSON |
| `api.spdrgoldshares.com/api/v1/barlist` | Mengembalikan **berkas PDF** |
| `gold.org/goldhub/data/gold-demand-by-country` (WGC) | Cuma tautan unduhan XLSX bertanggal, update kuartalan |

Kesimpulan: tidak ada satu pun yang berupa JSON bersih. Mem-parse XLSX/PDF di server berarti
menambah dependensi baru untuk format biner, demi satu angka flow — persis kerapuhan yang sudah
ditandai audit sebelumnya ("GLD (rapuh)"), bukan jalan pintas yang layak diambil tanpa persetujuan
eksplisit. Jadi GLD holdings **tetap** `Provider not wired`, dan sekarang halaman menyebutkan
alasannya secara spesifik (XLSX/PDF, bukan cuma "tidak stabil").

### I2. Yang berubah di §10 dari rencana awal

Keputusan awal bilang "GLD holdings + COT percentile" bisa dikerjakan. Setelah verifikasi nyata,
GLD holdings-nya sendiri **tidak** bisa — tapi COT percentile bisa, dan sekarang sudah tampil di
dua tempat. BTC/ETH ETF flow tetap seperti sebelumnya: `Provider not wired`.

---

## BAGIAN J — §9 Chart library expansion

Scope yang saya ambil (teks asli prompt §9 tidak tersimpan verbatim, jadi ini interpretasi saya
yang saya nyatakan di sini secara eksplisit): ekspansi pustaka chart internal (`src/components/charts`),
bukan menambah dependensi charting pihak ketiga. Proyek ini konsisten zero-dependency untuk chart
sepanjang sesi (semua SVG buatan tangan), dan chart TradingView untuk aset yang di-trading sudah
punya interaktivitas penuh dari vendornya sendiri — jadi gap sebenarnya ada di 6 komponen chart
custom yang dipakai modul Analysis/Macro/Confluence.

Dua penambahan, keduanya backward-compatible (nol perubahan di 9 pemanggil `LineChart` yang sudah ada):

1. **Crosshair + tooltip interaktif di `LineChart`.** Sebelumnya cuma nilai min/max di ujung yang
   kelihatan sebagai teks — membaca angka di titik manapun di tengah grafik berarti menebak posisi
   piksel. Sekarang hover (mouse/touch) atau panah kiri/kanan (setelah chart di-fokus) memunculkan
   garis crosshair + kotak dengan tanggal dan nilai persis. Tanpa animasi easing — ini pembacaan
   angka, bukan hiasan, jadi di luar aturan larangan hover-bounce §6.
2. **Overlay dua-seri (`secondary` prop) + chart Price vs Moving Average di Confluence Engine.**
   Panel Commodities dan Forex sekarang menampilkan grafik harga vs MA50 tepat di bawah gauge —
   sebelumnya faktor "trend" cuma teks ("+2.39% vs MA50 76.59"), sekarang ada buktinya visual.
   **Aturan keras**: chart ini HANYA muncul kalau engine sudah menghitung faktor trend-nya sendiri
   (commodity.ts dan forex.ts). XAU dan BTC tidak punya faktor trend, jadi `trendChart` mereka
   selalu `null` — dijamin lewat assertion, bukan cuma niat baik. Chart mengilustrasikan klaim yang
   sudah dibuat engine, tidak pernah jadi klaim baru sendiri.

Verifikasi: 9 assertion baru untuk `buildTrendChart` (batas window, rata-rata benar secara manual,
baris rusak tidak meracuni seri, cap legibilitas tetap ambil titik terbaru, digits diteruskan apa
adanya bukan ditebak dari besaran harga) + 8 assertion batas per-engine (WTI/EUR-USD dapat chart,
XAU/BTC tidak pernah dapat chart). Total assertion sesi ini: 137. Diverifikasi juga di browser
dengan respons API di-stub: crosshair + tooltip bekerja, chart trend tampil hanya untuk WTI (bukan
untuk XAU di panel yang sama), dan tooltip existing consumer (Stablecoin Liquidity) juga otomatis
dapat crosshair tanpa perubahan kode di file itu sendiri.

---

## BAGIAN K — §2.5 Global Macro & Non-Market Data, dibangun

Modul baru **Global Macro** (`/macro/global`) menutup 8 dari 12 metrik yang tercatat sebagai
"FREE-API" di Bagian C6. Baltic Dry dan gangguan pasokan energi tetap `Provider not wired` —
keduanya sudah dicek dan ditolak saat audit (Baltic Dry cuma tersedia berbayar via Trading
Economics; gangguan energi tidak punya sumber terstruktur gratis), bukan sekadar belum dicoba.

### K1. Temuan: 8 seri FRED yang sudah diverifikasi reachable tapi tidak pernah disambungkan

Sebelum sesi ini, `T10YIE`, `SOFR`, `RRPONTSYD`, `WRESBAL`, `WTREGEN`, `PCEPI`, `T5YIE`, dan
`GFDEBTN` sudah ada sebagai probe di `verify-sources.ts` sejak jauh sebelumnya (grup "FRED (new
series)"), dan run-run lama sudah membuktikan semuanya bisa diakses — tapi tidak satu pun pernah
masuk ke `ECON_INDICATORS` di `server.ts` atau muncul di UI mana pun. Delapan seri yang sudah
lolos verifikasi, dibiarkan menganggur. Menutup ini jadi bagian dari pass ini juga.

### K2. Perbaikan klaim basi di Central Banks

`CentralBanksView` masih bilang ECB/BOJ/BOE "belum terpasang" — padahal ketiganya sudah
disambungkan sebagai `ECBDFR`/`BOEBR`/`BOJPR` beberapa commit lalu untuk Forex Confluence Engine.
Halaman ini sekadar belum diperbarui menyusul. Sudah diperbaiki: lima kartu nyata (ECB/BOE/BOJ +
RBA/BOC baru), PBOC dan Bank Indonesia dipindah ke panel "Belum Terpasang" tersendiri dengan
alasan spesifik masing-masing.

### K3. Verifikasi judul — bukan cuma "server menjawab"

19 kandidat seri FRED diverifikasi lewat endpoint metadata `/fred/series` (bukan cuma
`/observations`), dicocokkan ke judul yang diharapkan, sebelum disambungkan — aturan yang sama
yang menangkap enam label kode COT salah di Bagian H. Dua kandidat cadangan RBA/BOC
(`INTDSRAUM193N`, `IRSTCB01CAM156N`) ditolak karena datanya basi (terakhir 2013 dan Des 2023).

`scripts/verify-sources.ts` sekarang punya validator `fredTitleCheck` permanen; dua blok FRED lama
(8 seri) di-upgrade dari cek-bentuk-saja ke cek-judul, plus blok baru untuk 7 seri fiskal/aktivitas
dan 2 seri suku bunga tambahan (RBA/BOC). **Run permanen (bukan eksplorasi sementara)**: FRED (new
series) 8/8, FRED (foreign rates) 5/5, FRED (Global Macro §2.5) 7/7 — total **57 OK · 6 FAIL · 0
SKIP**, semua probe kritis lulus. Enam kegagalan adalah yang sudah tercatat sebelumnya (Bybit ×2
non-kritis, Farside, dua alternatif ETF Yahoo, timeout EIA) — tidak ada yang baru.

### K4. Perbaikan pendukung

`useFredSeries` memaksa `currency=USD` di setiap request — kalau dibiarkan, ini akan diam-diam
merusak lima indikator non-USD yang baru (ECBDFR/BOEBR/BOJPR/RBACR/BOCCR), karena endpoint akan
membacanya sebagai permintaan data USD atas nama indikator itu dan menjawab kosong. Parameter
`currency` sekarang dihapus dari hook ini; backend sudah bisa menentukan mata uang dari indikator
itu sendiri sejak perbaikan Forex Confluence, hook ini cuma belum menyusul.

**Total assertion sesi ini tetap 137** — fase ini murni penyambungan data/tampilan, tidak
menyentuh Confluence Engine mana pun.
