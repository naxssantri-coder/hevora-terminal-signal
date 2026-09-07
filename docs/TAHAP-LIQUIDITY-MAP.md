# Tahap Liquidity Map — BTC-USDT (blueprint §50)

Sebelumnya belum bisa dibangun karena prasyaratnya (order book BTC-USDT live) belum ada. Sekarang
sudah ada (Tahap-Polish, lalu Tahap Order Book #2 memperluas pola relay-nya ke ETH-USDT) — jadi
tahap ini dikerjakan.

## Audit input sebelum kode

Instruksi: "gabungkan data yang SUDAH wired, TANPA provider baru". Diaudit satu-satu:

| Input | Status | Bukti |
|---|---|---|
| Order book depth | **Sudah wired** | `btcUsdtBook` (relay OKX/Bybit, live sejak Tahap-Polish/Order Book #1) |
| Liquidations | **TIDAK wired** | `grep -rn liquidation server.ts src/types.ts` sebelum menulis kode ini → 0 hasil. Tidak ada feed liquidation apa pun di codebase, gratis atau berbayar. |
| Swing high/low | **Ada logic-nya, tapi tidak diekspos** | `detectMarketRegime`/`calculateStructureAnalysis` di `server.ts` sudah menghitung swing high/low nyata dari candle (fractal 3-candle), tapi cuma dipakai internal untuk confluence score sinyal — tidak pernah diekspos sebagai level harga lewat API mana pun. |
| Fair Value Gap (FVG) | **Ada logic-nya, tapi cuma boolean** | Deteksi FVG asli (gap 3-candle: `c3.low > c1.high` / `c3.high < c1.low`) sudah ada, TAPI hanya menghasilkan `bullishFVG`/`bearishFVG` boolean untuk 3 candle TERAKHIR saja — bukan batas harga zona, dan tidak scan seluruh window. |

**Kesimpulan audit**: order book = data langsung yang sudah live. Swing/FVG = logic-nya sudah ada
dan terbukti (dipakai signal engine), tapi perlu di-scan ulang atas seluruh window candle (bukan
cuma 3 candle terakhir) dan diekspos sebagai level harga nyata — ini BUKAN provider baru, murni
menurunkan output baru dari data candle yang SUDAH mengalir ke `candleStore['BTCUSDT']`.
Liquidations genuinely tidak ada — dibangun versi PARTIAL, ditandai jujur.

## Yang dibangun

`GET /api/market/liquidity-map/btcusdt` (`server.ts`):
1. `scanLiquidityStructure()` — fungsi baru, standalone, memindai SELURUH `candleStore.BTCUSDT`
   (bukan cuma 3 candle terakhir seperti signal engine) pakai logic fractal/gap yang SAMA dengan
   yang sudah dipakai signal engine, untuk konsistensi.
2. FVG "belum terisi" (unfilled) — kalau harga sudah pernah balik masuk ke zona gap sejak
   terbentuk, zona itu tidak dianggap masih relevan.
3. Zona structural (swing + FVG) diklasifikasi buy-side (di bawah harga) / sell-side (di atas
   harga) mengikuti konvensi SMC/ICT standar: order stop-loss/breakout cenderung berkumpul di atas
   swing high terbaru (buy-side liquidity — harga cenderung tersedot naik untuk menyapunya) dan di
   bawah swing low terbaru (sell-side liquidity).
4. Level order book (bid/ask terbesar dari relay yang sudah live) ditambahkan sebagai kategori
   TERPISAH (`kind: 'orderbook'`) — ini pengukuran langsung, bukan inferensi seperti swing/FVG.
   UI SENGAJA tidak mencampur kedua kategori jadi satu angka, supaya pembaca tidak salah kira
   inferensi struktural sebagai data order book nyata.
5. **Gagal aman**: kurang dari 5 candle di window → `unavailable: true` dengan alasan spesifik.

## Kejujuran soal liquidations

`liquidationsIncluded: false` selalu ada di response, plus `liquidationsNote` yang menjelaskan
kenapa (tidak ada feed liquidation wired, Bybit stream-nya terbatas/tidak reliable dari
infrastruktur proyek ini, Coinglass — agregator umum — berbayar). Ini BUKAN placeholder
"coming soon" yang disembunyikan — field ini selalu tampil di response dan di UI (baris peringatan
warna amber), supaya pembaca tahu persis input mana yang hilang dari peta ini.

## UI

Modul baru "Liquidity Map (BTC-USDT)" (`/market/liquidity-map`, kategori `market`, dekat BTC-USDT
Depth). Layout mirip panel order book (ladder harga), tapi tiap baris punya badge yang menandai
sumbernya (`Order book` / `Swing level` / `FVG`) — warna/opacity beda antara zona order book
(measurement) dan zona structural (inference), sesuai instruksi "jangan sampai tercampur visual".

## Verifikasi

- `npm run lint` (tsc --noEmit) dan `npm run build`: bersih.
- Boot test lokal: `/api/market/liquidity-map/btcusdt` merespons `unavailable: true` dengan alasan
  spesifik ("Not enough candle history yet") di sandbox tanpa akses jaringan — tidak crash.
