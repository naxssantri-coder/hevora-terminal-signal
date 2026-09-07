# Tahap Audit-sisa — 3 item Blueprint Phase 3 (audit saja, tidak dibangun)

Tiga item ini secara eksplisit diminta AUDIT SAJA, bukan dibangun. Tidak ada perubahan kode di
tahap ini.

## 1. Gold options IV/skew (§16) — dikonfirmasi ulang: tetap NOT-FREE

Audit lama sudah bilang CME berbayar. Dikonfirmasi ULANG lewat GitHub Actions (bukan diasumsikan)
sebelum menulis kesimpulan ini, plus dicek 1 kandidat alternatif yang belum pernah diperiksa:

- **CME gold options quotes page** (`cmegroup.com/markets/metals/precious/gold.quotes.options.html`):
  **HTTP 403 Forbidden** langsung — bukan cuma "butuh login untuk data", akses ke halamannya
  sendiri diblokir. Lebih ketat dari yang diasumsikan sebelumnya.
- **Barchart** (`barchart.com/futures/quotes/GCJ26/options`) — kandidat alternatif gratis yang
  belum pernah dicek sesi-sesi sebelumnya. Halaman **200 OK**, TAPI diperiksa lebih dalam:
  - Teks "Implied Volatility" yang muncul di halaman ternyata cuma **link menu navigasi**
    ("Highest Implied Volatility" — halaman screener terpisah), BUKAN data IV untuk kontrak GC
    yang sebenarnya.
  - Angka persentase yang ditemukan di halaman (38.2%, 61.8%) adalah level **Fibonacci retracement**
    dari widget lain, BUKAN nilai Greeks/IV opsi.
  - Tidak ada elemen tabel opsi (`option-table`/`bc-table` class) di HTML.
  - API internal Barchart (`proxies/core-api/v1/options/get`) dicoba tanpa key → **HTTP 401**,
    mengonfirmasi data riil memang di balik autentikasi/langganan.

**Kesimpulan**: tetap **NOT-FREE**. Tidak ditemukan alternatif gratis yang terlewat. CME 403
(diblokir), Barchart free-tier cuma shell halaman tanpa data opsi riil. Tidak dibangun.

## 2. Historical Replay (blueprint §62 tambahan-3) — audit kelayakan saja

**Kapasitas penyimpanan aktual saat ini** (diperiksa langsung di `server.ts`):
- `candleStore` per pair di-cap keras di `.slice(-30)` — MAKSIMAL 30 candle 5-menit disimpan per
  pair, kapan pun, tanpa terkecuali (3 titik kode berbeda memakai batas yang sama:
  `candleStore[pairId] = constructed.slice(-30)` dan 2 pemakaian serupa lainnya).
- 30 candle × 5 menit = **150 menit = 2.5 jam** — persis seperti dugaan user, dikonfirmasi dari
  kode, bukan diasumsikan.
- Bahkan mekanisme persist-lewat-restart (`CANDLE_STORE_MAX_RESTORE_AGE_MS = 6 jam`) cuma menjaga
  snapshot tetap "segar" untuk restore, TIDAK menambah kapasitas — begitu di-restore, cap 30
  candle tetap berlaku. Tidak ada arsip historis yang terakumulasi di mana pun.

**Kebutuhan untuk replay beneran** (price → order flow → macro → signal → outcome), estimasi kasar:

| Lapisan | Kebutuhan | Estimasi ukuran |
|---|---|---|
| Candle harga (semua pair, granularitas 5m) | Cukup murah — cuma perlu STOP membuang data lama | ~90 hari × 8 pair × 288 candle/hari × ~100 byte ≈ **20 MB/3 bulan** — feasible dengan pendekatan file/Redis yang ada sekarang, tinggal hilangkan cap 30 |
| Order flow (snapshot order book bid/ask) | **Infrastruktur BARU** — butuh time-series DB (bukan JSON/Redis biasa) kalau granularitas tinggi (per detik) | Untuk BTC-USDT saja, snapshot 1x/detik × 90 hari ≈ 7.7 juta baris — perkiraan kasar **1-4 GB/3 bulan UNTUK SATU PAIR**, tumbuh signifikan kalau ditambah pair lain |
| Macro snapshot per event | Relatif murah, mirip pola `LiveEventReactionSnapshotSet` yang sudah ada | Puluhan MB/tahun |
| Signal + outcome | Sudah ada (`SignalHistoryRecord`), murah | Sudah berjalan |

**Kesimpulan**: candle+signal+macro SAJA — feasible dengan penyesuaian kecil (hilangkan cap 30,
simpan lebih lama). Tapi **order flow** (yang dibutuhkan supaya "price→order flow→signal" beneran
bisa direplay, bukan cuma "price→signal") butuh infrastruktur penyimpanan baru yang jauh lebih
besar dan mahal daripada pola JSON-file/Redis proyek ini sekarang — cocok dengan dugaan user.

**TIDAK dibangun apa pun** di tahap ini — keputusan besar (biaya storage, pilihan DB, retention
policy) butuh diskusi terpisah dengan user, bukan diputuskan sepihak di sini.

## 3. Regime Machine Learning (blueprint Phase-3) — di luar scope batch ini

Ini pelatihan model ML sungguhan (perlu: data training berlabel, pipeline training/validasi,
infrastruktur serving model, evaluasi drift dari waktu ke waktu) — kategori pekerjaan yang
FUNDAMENTAL BERBEDA dari item lain di proyek ini (yang sejauh ini semuanya "wiring data dari
sumber yang sudah ada" atau "audit sumber"). Butuh perencanaan terpisah (sumber data training apa,
target/label seperti apa, bagaimana validasi, di mana model di-serve) sebelum bisa dikerjakan sama
sekali.

**TIDAK ada percobaan membangun apa pun untuk ini** — dilaporkan sebagai keputusan scope, bukan
hasil audit teknis yang menyimpulkan "bisa/tidak bisa".
