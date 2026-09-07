# Ringkasan gabungan — Batch 2 (D3-lanjut, Order Book #2, Watchlist, Liquidity Map, Audit-sisa)

Laporan ini menutup batch kedua yang dikerjakan paralel di sesi ini. Dikerjakan sesuai instruksi:
Tahap H (alert channel) dan kalibrasi sinyal 7 pair baru tetap di-skip/ditunda seperti diminta.
Risk/Position-Size Calculator (§51) dan Portfolio Risk (§52) TIDAK disentuh sama sekali sesuai
penolakan eksplisit user di awal sesi.

## Status per tahap

| Tahap | Status | PR |
|---|---|---|
| **D3-lanjut** — Tier 2 (ESTIMATED) | **Ditutup** (diaudit 2x, tidak ada sumber gratis) | [#27](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/27) |
| **D3-lanjut** — Tier 3 (RUMORED) | **Dibangun** | [#27](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/27) |
| **Order Book #2** — ETH-USDT | **Dibangun** | [#28](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/28) |
| **Watchlist** — Commodities/Indices | **Dibangun** | [#26](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/26) |
| **Liquidity Map** — BTC-USDT | **Dibangun (partial, liquidations tidak termasuk)** | [#29](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/29) |
| **Audit-sisa** — Gold options IV/skew | **Dikonfirmasi ulang: tetap NOT-FREE** | [#30](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/30) |
| **Audit-sisa** — Historical Replay | **Audit kelayakan saja, tidak dibangun** | [#30](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/30) |
| **Audit-sisa** — Regime ML | **Di luar scope, dilaporkan saja** | [#30](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/30) |

Semua PR di atas **belum di-merge** — menunggu review, sesuai instruksi eksplisit ("jangan merge
PR mana pun sendiri").

## Ringkasan tiap tahap

**D3 Tier 2**: dikonfirmasi ULANG lewat GitHub Actions (bukan diasumsikan dari audit lama) bahwa
halaman laporan gratis Metals Focus tetap tidak menyebut "central bank" sama sekali. Ditutup
sebagai keputusan final — ditandai eksplisit di UI (`cbGold.tier2Closed`) dan dokumentasi, bukan
dibiarkan sebagai "pending" tanpa akhir.

**D3 Tier 3**: dibangun pakai pola identik Tahap F — field baru `goldPurchaseRumor` di prompt AI
klasifikasi berita yang sudah jalan tiap 15 menit, tanpa provider baru. Endpoint baru mengembalikan
DAFTAR (bukan skor agregat) karena tiap rumor adalah klaim sendiri-sendiri. UI-nya Panel TERPISAH
dari Tier 1, badge "UNCONFIRMED" warna amber di tiap baris.

**Order Book #2**: relay BTC-USDT direfaktor jadi factory (`createOrderBookRelay`) supaya bisa
diinstansiasi per pair — perilaku BTC-USDT dipertahankan persis, ETH-USDT ditambahkan dengan pola
yang sama (OKX primary, Bybit fallback, SSE). Probe permanen baru (`okx:orderbook-eth`)
diverifikasi lulus via GitHub Actions sebelum PR dibuka.

**Watchlist**: bukan sistem baru — mekanisme `lib/watchlist.ts` sudah generik (menerima id apapun
dari `listAssets()`, yang sudah mencakup commodities/indices sejak Tahap C). Gap-nya cuma tombol
bintang yang belum ada di `CommodityBoard.tsx`/`IndicesView.tsx` — sekarang ditambahkan.

**Liquidity Map**: dibangun karena prasyaratnya (order book live) sekarang ada. Order book depth =
data langsung (measurement). Swing high/low dan FVG = logic yang sudah ada di signal engine,
diturunkan ulang jadi level harga nyata dan diekspos lewat endpoint baru (bukan provider baru).
Liquidations diaudit dan dikonfirmasi TIDAK wired di mana pun di codebase — dibangun versi partial,
ditandai jujur (`liquidationsIncluded: false` + alasan spesifik selalu tampil, tidak disembunyikan).

**Audit-sisa**: 3 item, semuanya audit/laporan saja tanpa kode. Gold options IV/skew dikonfirmasi
ulang tetap NOT-FREE (CME sekarang 403 langsung, Barchart "gratis" ternyata cuma shell tanpa data
opsi riil). Historical Replay: `candleStore` dikonfirmasi cap 30 candle (2.5 jam) langsung dari
kode; replay candle+signal+macro murah dan feasible, tapi order-flow-level replay butuh
infrastruktur storage baru yang jauh lebih besar — keputusan biaya/infra terpisah, tidak dibangun.
Regime ML: dilaporkan di luar scope (pelatihan model sungguhan), tidak dicoba dibangun.

## Verifikasi yang dilakukan tiap tahap

Semua tahap: `npm run lint` (tsc --noEmit) dan `npm run build` bersih sebelum commit. Setiap
endpoint baru diuji lewat boot test lokal (gagal aman/`unavailable: true` dengan alasan spesifik di
sandbox tanpa akses jaringan, bukan crash). Setiap sumber eksternal baru (probe ETH order book,
audit Metals Focus/CME/Barchart) diverifikasi via GitHub Actions `workflow_dispatch`, bukan
percobaan lokal.

## Tidak ada pertanyaan/klarifikasi baru untuk batch ini

Berbeda dari batch sebelumnya (D3 Tier 2/3 yang butuh klarifikasi definisi), batch ini semua item
bisa diselesaikan tanpa perlu jawaban tambahan dari user — Tier 2/3 D3 sendiri sudah ditutup/
dibangun di tahap ini menggunakan asumsi kerja yang diberikan di instruksi terbaru.

## Catatan

JANGAN merge PR mana pun secara otomatis — PR #26, #27, #28, #29, #30 semuanya menunggu review
manual, sama seperti batch sebelumnya (#23, #24, #25).
