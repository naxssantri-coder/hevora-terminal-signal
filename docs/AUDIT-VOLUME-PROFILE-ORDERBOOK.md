# Audit — Volume Profile (§9) & Order Book/DOM + Order Flow (§7–§8)

Status: **laporan kelayakan, nol kode UI**. Sesuai instruksi tahap ini, tidak ada Volume
Profile, Order Book, atau Order Flow yang dibangun — ini murni audit sumber data + estimasi
kompleksitas, supaya keputusan bangun/tidak dibuat dengan angka nyata, bukan tebakan.

Ditulis menyambung sesi Gold Seasonality (commit `fc65cd2e`, terverifikasi via GitHub Actions
`Verify Data Sources` — 267 data point / 27 tahun kalender). Pola pembuktian yang sama dipakai
di sini: kalau ada klaim tentang endpoint provider, itu hasil pencarian dokumentasi resmi
(WebSearch — WebFetch langsung ke `bybit-exchange.github.io`/`okx.com` diblokir kebijakan
egress environment ini, jadi bukan hasil buka URL, dicatat sebagai batasan di bawah).

---

## BAGIAN A — Batas kepercayaan laporan ini

- **WebFetch ke domain dokumentasi (`bybit-exchange.github.io`, `okx.com`) diblokir** oleh
  kebijakan egress environment ini (`EGRESS_BLOCKED`), sama seperti `curl` langsung dari sandbox
  develop selalu diblokir untuk semua provider data proyek ini (lihat `docs/FASE-8-AUDIT.md`
  Bagian A). Fakta-fakta endpoint di bawah karena itu berasal dari **WebSearch** (hasil query,
  bukan halaman dokumentasi dibuka langsung) — ditandai sumbernya per klaim, dan mana yang masih
  perlu diverifikasi dengan probe nyata sebelum dijadikan dasar kode ditandai eksplisit.
- Fakta tentang kode proyek sendiri (struktur `candleStore`, endpoint yang sudah ada, arsitektur
  poll) diverifikasi langsung dari `server.ts` di repo ini — bukan dari memori atau blueprint.

---

## BAGIAN B — Volume Profile (blueprint §9)

### B1. Apa yang tersimpan di engine candle store sekarang

`server.ts:4008` (`--- 1. Engine candle store ---`) dan struct `Candle` di `server.ts:403`:

```ts
interface Candle {
  open: number; high: number; low: number; close: number; volume: number; time: number;
}
```

Faktanya:
- **OHLCV per bar 5 menit**, bukan per level harga. `volume` di sini adalah total volume dalam
  satu bar waktu (kalau kline provider berhasil, contoh `server.ts:2909`: `volume:
  parseFloat(k[5])` dari Bybit kline) — itu **volume-per-WAKTU**, bukan **volume-per-HARGA**.
  Volume Profile butuh yang kedua: berapa volume yang trading persis di harga $4,427.10 vs
  $4,426.90, bukan berapa volume dalam 5 menit terakhir.
- Buffer dibatasi **30 bar** (limit=30 pada request kline, ditegaskan lagi lewat `.slice(-30)` di
  titik-titik yang butuh trim manual — semua titik populate `candleStore` ada di
  `server.ts:2902, 2930, 3019, 3111, 3249, 3357, 3514`). 30 bar × 5 menit =
  **2.5 jam** riwayat di memori. Volume Profile yang berguna butuh minimum 1 sesi (24 jam) atau
  multi-hari (range profile) — 2.5 jam bahkan tidak cukup untuk profile sesi harian sekalipun
  datanya per-harga.
- Endpoint publik `/api/market/candles` (`server.ts:4013`) **sengaja tidak mempublikasikan
  volume sama sekali** — komentar di kode sendiri: *"Deliberately publishes OHLC and time only,
  never volume: when a provider kline is unavailable the engine backfills bars from its own tick
  buffer and stamps them volume: 100 as a filler."* Tim sebelumnya sudah sadar volume di store
  ini tidak selalu asli dan memilih untuk tidak menampilkannya ke publik sama sekali, bukan
  oversight.

**Kesimpulan B1: candle store internal TIDAK punya granularitas harga sama sekali, dan bahkan
granularitas waktunya (30 bar/2.5 jam) terlalu pendek untuk profile apa pun.** Ini bukan bahan
baku Volume Profile dalam bentuk apa pun.

### B2. Apakah OKX/Bybit/Yahoo (provider utama proyek ini) punya endpoint tick/trade yang bisa dipakai

| Provider | Endpoint | Limit per-request | Cakupan riwayat | Sumber |
|---|---|---|---|---|
| Bybit | `GET /v5/market/recent-trade` | max **1000** (linear/inverse/option), max **60** untuk **spot** | Hanya trade TERBARU saat request — tidak ada parameter range waktu/pagination ke belakang | [Bybit API docs — Get Recent Public Trades](https://bybit-exchange.github.io/docs/v5/market/recent-trade) (WebSearch) |
| OKX | `GET /api/v5/market/trades` | max **500**, default 100 | Sama — snapshot trade terbaru, bukan tape historis | [OKX API v5 guide](https://algotrading101.com/learn/okx-api-guide/) (WebSearch) |
| OKX | `GET /api/v5/market/trades-history` | disebut ada, tapi WebSearch tidak menemukan konfirmasi jelas soal akses publik vs bertingkat (VIP) untuk endpoint ini | Belum bisa dipastikan dari sini | Tidak cukup bukti — perlu probe nyata |
| Yahoo Finance chart API | (sudah dipakai proyek ini) | — | OHLCV per hari/menit, **sama sekali tidak ada trade-level data** | Sudah dikonfirmasi lewat pemakaian proyek sendiri (`fetchYahooDailyCloses`) |

Baik Bybit maupun OKX REST trade endpoint **hanya mengembalikan snapshot trade paling baru saat
itu juga** — bukan riwayat yang bisa di-query mundur berhari-hari dalam satu request. Untuk
membangun Volume Profile yang jujur (bukan karangan) dari sumber ini, satu-satunya cara adalah:

1. **Poll endpoint recent-trade terus-menerus** (mis. tiap beberapa detik) dan **akumulasi**
   sendiri trade-by-trade ke bucket harga di server — bukan "wire provider yang sudah ada",
   tapi **membangun subsistem pengumpul tape baru** yang berjalan lama sebelum datanya berguna.
2. Datanya **baru mulai terkumpul dari nol saat fitur di-deploy** — sesi profile (24 jam) baru
   punya bentuk lengkap setelah proyek jalan 24 jam nonstop tanpa restart. Proyek ini sendiri
   mencatat `candleStore` di memori **hilang total tiap restart** kecuali dijaga lewat snapshot
   ke disk/Redis (`server.ts:522-604`, ditandai `[DATA AT RISK]` di komentar) — pola yang sama
   akan berlaku ke tape trade, dengan taruhan lebih tinggi karena granularitasnya jauh lebih
   padat (ribuan trade/menit di BTC-USDT vs 1 candle/5 menit).
3. Yahoo Finance (provider untuk XAUUSD/forex/commodities) **tidak punya trade-level data sama
   sekali** — jadi Volume Profile untuk XAU/forex/commodities tidak mungkin dari provider yang
   sudah dipakai proyek ini, titik.

### B3. Kesimpulan Tahap A

**Provider not wired — dan bukan karena belum diintegrasikan, tapi karena tidak ada satu pun
sumber gratis yang menyediakan data volume-per-harga dalam bentuk siap pakai.** Membangunnya
berarti membuat subsistem pengumpul tape trade real-time yang baru (bukan wiring provider yang
ada), butuh waktu berjalan riil (bukan instan) sebelum datanya bermakna, dan hanya bisa untuk
pair crypto (BTC-USDT/ETH-USDT via Bybit/OKX) — XAU dan forex tidak punya jalur sama sekali
lewat provider yang sudah dipakai proyek ini.

Sesuai instruksi eksplisit tugas ini: **tidak mendekati dengan approksimasi kasar dari OHLCV**
(POC/VAH/VAL yang dihitung dari volume-per-waktu, bukan volume-per-harga, akan terlihat presisi
tapi levelnya tidak nyata — persis risiko yang instruksi ini minta dihindari). Rekomendasi:
tandai Volume Profile sebagai **"Provider not wired — tidak ada sumber gratis untuk
volume-per-level-harga; opsi satu-satunya adalah membangun pengumpul tape sendiri dari Bybit/OKX
recent-trade, hanya untuk BTC-USDT/ETH-USDT, dan butuh waktu akumulasi nyata sebelum berguna"**
di UI kalau/ketika modul ini didaftarkan, bukan dibangun sekarang.

---

## BAGIAN C — Order Book/DOM (§7) & Order Flow/Footprint (§8)

### C1. Endpoint yang tersedia (OKX & Bybit, dari WebSearch — belum diprobe nyata)

| Exchange | Jenis | Endpoint/channel | Depth | Frekuensi update | Sumber |
|---|---|---|---|---|---|
| OKX | REST snapshot | `GET /api/v5/market/books` | `sz` max 400 per sisi | on-demand, rate limit **20 req/2s per IP** | WebSearch |
| OKX | WebSocket | `books` | 400 level | snapshot + incremental | WebSearch |
| OKX | WebSocket | `books5` | 5 level | snapshot tiap 100ms | WebSearch |
| OKX | WebSocket | `bbo-tbt` | best bid/offer saja | tiap 10ms | WebSearch |
| OKX | WebSocket | `books50-l2-tbt` / `books-l2-tbt` | 50 / 400 level tick-by-tick | — | **Butuh tier VIP4+/VIP5+ — tidak bisa dipakai produk publik** (WebSearch) |
| Bybit | REST snapshot | `GET /v5/market/orderbook` | tergantung kategori | on-demand | WebSearch (limit per-endpoint belum terkonfirmasi jelas) |
| Bybit | WebSocket | `orderbook.{depth}.{symbol}` | 1/50/200/1000 (spot/linear/inverse), 25/100 (option) | 10ms–200ms tergantung depth | WebSearch |

**Poin penting:** channel publik gratis yang cukup untuk DOM biasa (`books`/`books5` di OKX,
`orderbook.50` di Bybit) **tidak butuh API key** — order book Level 2 publik memang gratis di
kedua exchange ini. Ini beda dari Volume Profile: sumbernya ADA dan gratis, masalahnya murni
arsitektur (REST-poll vs WebSocket), bukan ketersediaan data.

### C2. Kenapa ini perubahan arsitektur, bukan sekadar endpoint baru

Dikonfirmasi langsung dari kode: **`server.ts` tidak punya satu pun pemakaian `WebSocket` saat
ini** (`grep -n "new WebSocket" server.ts src/` → nol hasil). Seluruh engine — signal tick,
semua provider funding/OI/harga — jalan lewat `setInterval` + `fetch()` REST biasa, dengan tick
utama tiap 1 detik (`server.ts:3846`). Semua client poll endpoint HEVORA sendiri tiap ~1 detik
lewat `useEndpoint` (`src/lib/useEndpoint.ts`) — pola **satu sumber kebenaran**: server hitung
sekali, semua device baca hasil yang sama.

Order book **berubah puluhan-ratusan kali per detik** (lihat frekuensi update di tabel C1:
10ms–200ms). REST-poll 1 detik ala arsitektur sekarang akan menampilkan DOM yang terasa patah
dan bisa menyesatkan (level yang "terlihat" sebenarnya sudah tidak ada beberapa ratus ms
sebelumnya) — untuk fitur yang traders pakai justru untuk melihat pergerakan level real-time,
ini bukan sekadar "kurang responsif", tapi salah secara fungsional.

### C3. Dua opsi desain

**Opsi (a) — Server jadi WebSocket relay** *(direkomendasikan)*
- Server buka **satu koneksi WS persisten per exchange per simbol** (mis. 2 koneksi: OKX
  BTC-USDT + Bybit BTC-USDT, atau pilih satu exchange saja per simbol untuk mulai), pelihara
  order book lokal di memori (apply snapshot lalu delta sesuai protokol masing-masing exchange —
  ini bagian yang butuh effort: nomor urut/sequence harus dijaga, resync penuh kalau ada gap).
- Client tetap pakai pola yang **sudah ada** — `GET /api/market/orderbook/:symbol` di-poll lewat
  `useEndpoint`, cuma polling-nya dipercepat (mis. 300-500ms) untuk fitur ini saja. Server
  menjawab dari state order book yang sudah dipelihara di memori, bukan fetch baru tiap request.
- **Konsisten dengan aturan "satu sumber kebenaran"** yang sudah dipakai proyek ini di
  tempat lain — semua device tetap melihat book yang sama dari server yang sama.
- Biaya: proses Express (single process, sekarang) dapat beban baru berupa koneksi WS
  jangka-panjang + reconnect/resync logic — **jenis kode baru yang belum pernah ada** di
  proyek ini, effort-nya nyata, bukan trivial.

**Opsi (b) — Client connect langsung ke WS exchange dari browser**
- Server tidak berubah sama sekali; client buka WS langsung ke OKX/Bybit.
- Risiko: **rate/connection limit exchange itu per-IP publik**, di luar kendali proyek ini.
  Kalau banyak user berada di belakang NAT/jaringan kantor/mobile carrier yang sama, mereka
  berbagi IP publik dan bisa saling kena limit exchange tanpa proyek ini bisa mendeteksi atau
  mengatasinya.
- **Melanggar pola "satu sumber kebenaran"** yang jadi prinsip arsitektur proyek ini di semua
  tempat lain (signal, harga, funding, OI — semua dihitung sekali di server). Order book jadi
  satu-satunya fitur yang device-nya bisa "beda pandangan" satu sama lain.

**Rekomendasi: Opsi (a).** Lebih terkontrol, konsisten dengan arsitektur yang sudah ada di
seluruh proyek, dan risiko rate-limit ditanggung satu koneksi server (predictable) bukan N
koneksi client yang tidak terkontrol.

### C4. Order Flow / Footprint (§8)

Blueprint sendiri menyebut §8 berprasyarat pada §7 (order book). Order Flow/Footprint butuh
**tape trade real-time + order book digabung** (klasifikasi tiap trade sebagai aggressor
buy/sell terhadap level book saat itu) — secara teknis satu tingkat lebih kompleks dari order
book sendirian: butuh dua stream WS berjalan bersamaan (trade + book) per simbol, disinkronkan
per-timestamp, dan diagregasi ke sel harga×waktu untuk footprint chart.

**Rekomendasi: JANGAN dikerjakan sebelum §7 (order book) selesai dan terbukti stabil di
produksi.** Kalau relay WS untuk order book saja belum pernah dibangun dan diuji, menambah
lapisan agregasi trade+book di atasnya sekaligus akan menggandakan risiko debugging tanpa
fondasi yang terbukti.

### C5. Estimasi kompleksitas & rekomendasi urutan

| Fitur | Kelayakan sumber data | Estimasi kompleksitas | Rekomendasi |
|---|---|---|---|
| Volume Profile (§9) | **Provider not wired** — tidak ada sumber gratis volume-per-harga | N/A (bukan soal effort kode, soal data tidak ada) | Jangan bangun. Tandai "Provider not wired" di UI kalau didaftarkan, dengan alasan spesifik di atas |
| Order Book/DOM (§7), crypto only | Data tersedia gratis & publik (OKX `books`/`books5`, Bybit `orderbook.50`) | **Sedang-besar** — subsistem WS relay baru (belum pernah ada di proyek ini), sequence/resync logic, endpoint baru, panel UI baru. Tapi scope-nya terisolasi (1-2 simbol crypto) | Bisa dikerjakan, mulai dari 1 pair (BTC-USDT) sebagai pilot sebelum diperluas |
| Order Flow/Footprint (§8) | Sama seperti §7 + butuh trade stream digabung | **Besar** — dua stream WS disinkronkan + agregasi footprint, di atas fondasi §7 | Tunda sampai §7 terbukti stabil di produksi |
| DOM untuk forex/XAU | **Tidak ada jalur** — DOM forex butuh broker-specific feed, biasanya berbayar/tanpa API publik (sesuai catatan tugas ini sendiri) | N/A | Jangan dikejar; crypto-only untuk fitur ini |

---

## BAGIAN D — Ringkasan untuk keputusan

1. **Volume Profile (§9): stop di sini.** Bukan soal effort — datanya tidak ada secara gratis
   dalam bentuk yang jujur. Satu-satunya jalan (bangun pengumpul tape sendiri, hanya crypto,
   butuh waktu akumulasi riil) adalah proyek baru, bukan "wire provider yang ada".
2. **Order Book/DOM (§7): layak dikerjakan**, crypto-only (BTC-USDT/ETH-USDT lewat OKX atau
   Bybit), dengan Opsi (a) — server jadi WS relay, client tetap poll pola yang sudah ada.
   Ini genuinely fitur baru yang butuh subsistem koneksi-persisten pertama di proyek ini —
   effort sedang-besar, tapi scope-nya bisa dibatasi ke 1 pair dulu sebagai pilot.
3. **Order Flow/Footprint (§8): tunda** sampai §7 selesai dan terbukti stabil — jangan
   dikerjakan paralel, prasyaratnya belum ada.
4. **Fakta endpoint OKX/Bybit di Bagian C1 berasal dari WebSearch, belum diprobe nyata.**
   Sebelum menulis kode §7, langkah pertama tetap sama seperti Gold Seasonality kemarin: tambah
   probe baru di `scripts/verify-sources.ts` untuk `GET /api/v5/market/books` (OKX) dan
   `GET /v5/market/orderbook` (Bybit), verifikasi format response sungguhan lewat GitHub Actions
   `workflow_dispatch` — baru setelah itu hijau, desain relay WS bisa mulai ditulis.

Tidak ada kode UI Volume Profile, Order Book, atau Order Flow yang ditulis di tahap ini, sesuai
instruksi.
