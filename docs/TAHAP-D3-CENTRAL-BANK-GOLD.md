# Tahap D3 — Central Bank Gold Buying, model 3-tier (blueprint §14)

Keputusan D3 sebelumnya (stop, dianggap sama rapuh dengan WGC/GLD XLSX) di-**override** user
dengan model 3-tier. Diaudit ulang lewat 5 putaran GitHub Actions
(`scripts/audit-wgc-imf-structure.ts`, dihapus setelah dipakai) sebelum menulis parser apa pun.

## TIER 1 — OFFICIAL: DIBANGUN

### Audit: bukan XLSX yang diblokir, tapi blog gratis WGC sendiri

**Temuan #1 (penting)**: audit D3 sebelumnya salah probe halaman. `gold-demand-by-country` (yang
diprobe sebelumnya) itu data **demand konsumen** (perhiasan, investasi ritel), BUKAN cadangan
bank sentral. Halaman yang benar untuk "central bank gold buying" adalah
`gold.org/goldhub/data/gold-reserves-by-country`.

**Temuan #2**: halaman itu memang punya link unduhan XLSX bertanggal (`Changes_latest_as_of_
<Bulan><Tahun>_IFS.xlsx` - persis nama file yang mengindikasikan sumbernya IMF IFS, sesuai
konteks yang diberikan user). TAPI file itu **HTTP 403** saat benar-benar diunduh - dikonfirmasi
2x lewat GitHub Actions, termasuk dengan header `Referer` yang mensimulasikan datang dari halaman
listing-nya. Ini bukan cuma soal format (seperti WGC/GLD sebelumnya) - ini blokir akses.

**Temuan #3 (yang akhirnya dipakai)**: WGC punya blog bulanan GRATIS, publik, TANPA login -
"Gold Focus" - dengan post rutin "Central bank gold statistics: [Bulan] [Tahun]", sumbernya
eksplisit disebut di teks artikel: **"Source: IMF IFS, respective central banks, World Gold
Council"** - persis tiga sumber yang disebut user. Post Agustus 2026 terkonfirmasi asli membahas
data Juni 2026 - lag pelaporan ~2 bulan, persis seperti yang dijelaskan user.

**Struktur nyata** (dikonfirmasi lewat isi post asli, bukan diasumsikan):
- **0 `<table>` di dalam post** - bukan tabel HTML.
- Chart embed yang ada di halaman cuma config loader Drupal (`ajaxPageState`), BUKAN data.
- Daftar negara + tonase ada sebagai **PROSA**, contoh nyata yang diambil:
  > "Poland remains the top buyer (82t), followed by Uzbekistan (41t), China (40t) and
  > Kazakhstan (27t), Czech Republic (11t), Singapore (10t), Chile (8t). Turkey remains the
  > largest y-t-d seller (83t)... Russia also sold gold, with 44t net sales y-t-d."
- Judul (`<h1>`) berisi bulan datanya secara eksplisit: "Central bank gold statistics: June 2026".

### Yang dibangun

`GET /api/macro/central-bank-gold` (server.ts):
1. Fetch index `gold.org/goldhub/gold-focus`, cari link post "central bank" terbaru.
2. Fetch post itu, ekstrak `lastReportedMonth` dari `<h1>` (BUKAN dari `fetchedAt` - dua tanggal
   ini beda makna sesuai instruksi, ditampilkan terpisah di UI).
3. Ekstrak baris negara+tonase per KALIMAT: kalimat yang mengandung kata "sold/seller/sales/
   selling" menandai SEMUA negara di kalimat itu sebagai net SELLER (negatif); default net BUYER
   (positif). Angka diambil dari 60 karakter setelah nama negara (menangani format "(Nt)" maupun
   "dengan Nt"). Nilai tidak masuk akal (≤0 atau >500t) dibuang, bukan dipaksakan.
4. **Gagal aman**: kalau hasil ekstraksi <3 negara, endpoint melempar error dan
   `unavailable: true` dengan alasan spesifik - bukan menampilkan daftar tipis seolah lengkap.

**Diuji manual** (skrip Node terpisah, bukan bagian dari codebase) terhadap teks ASLI yang
ditemukan via GitHub Actions - hasil ekstraksi PERSIS cocok dengan 9 baris yang sebenarnya ada di
artikel (7 pembeli + 2 penjual, arah dan angka benar semua).

**UI**: modul baru "Central Bank Gold Buying" (`/macro/central-bank-gold`, kategori `macro`,
dekat XAU Futures Curve/Gold Seasonality). Label "Last reported: [Bulan]" ditampilkan MENONJOL,
terpisah dari `DataQualityBadge` (yang menunjukkan kapan HEV terakhir berhasil fetch, bukan bulan
datanya).

**Data Health Center**: baris WGC yang sebelumnya `UNAVAILABLE` ("not wired") sekarang di-update
mencerminkan status nyata (dibaca dari cache `cachedExternalFeed`, sama seperti provider lain).

**Kejujuran soal risiko**: ini genuinely rapuh - scraping teks bebas (prosa), bukan tabel/JSON.
Kalau WGC ubah gaya kalimat, ekstraksi bisa rusak. Ini didokumentasikan eksplisit di komentar
kode, di UI (`cbGold.methodNote`), dan di probe permanen baru di `verify-sources.ts`
(`wgc:gold-focus-index`, critical - kegagalannya adalah sinyal pertama kalau ekstraksi perlu
diaudit ulang).

## TIER 2 — ESTIMATED (analis): DIAUDIT ULANG, DITUTUP (bukan "butuh klarifikasi" lagi)

Audit sebelumnya sudah menyimpulkan tidak ada sumber gratis yang jelas. Sesuai instruksi, ini
dikonfirmasi ULANG lewat GitHub Actions (bukan diasumsikan dari laporan lama) sebelum ditutup:

- **Metals Focus** (`metalsfocus.com/reports/`, halaman laporan gratisnya) - dicek ulang: 200 OK,
  TAPI teks halaman **tidak menyebut "central bank" sama sekali**. Ini menguatkan kesimpulan lama:
  tidak ada laporan gratis Metals Focus yang berisi estimasi pembelian bank sentral per negara.
  `Precious Metals Weekly` (gratis) tetap laporan harga, bukan estimasi pembelian.

Premis Tier 2 juga tetap sama seperti temuan audit pertama: artikel Gold Focus yang jadi sumber
Tier 1 SENDIRI sudah mengutip "IMF IFS, respective central banks" sebagai sumbernya untuk bulan
yang sudah lewat - jadi tidak ada "celah sebelum data resmi" yang jelas untuk diisi Tier 2, dan
sumber gratis untuk mengisi celah waktu 1-2 bulan sebelum Tier 1 terbit (kalaupun didefinisikan
begitu) tetap tidak ditemukan.

**Keputusan final**: Tier 2 **ditutup** untuk saat ini - bukan "belum dibangun, menunggu", tapi
"sudah diaudit dua kali (5 putaran + re-konfirmasi ini), tidak ada solusi gratis". Ditandai
eksplisit di UI (`cbGold.tier2Closed`, ditampilkan di bawah data Tier 1) dan di sini. Akan
ditinjau ulang kalau ada sumber gratis baru yang ditemukan di masa depan - bukan keputusan
permanen-selamanya, tapi bukan lagi item pending.

## TIER 3 — RUMORED/UNCONFIRMED: DIBANGUN

Definisi kerja yang dipakai (asumsi kerja dari user, karena pesan definisi asli terputus): berita
yang menyebut aktivitas pembelian/penjualan emas bank sentral tertentu, TAPI belum muncul di
sumber Tier 1 (WGC Gold Focus) untuk bulan yang sama - artinya belum dikonfirmasi resmi oleh
WGC/bank sentral ybs.

**Dibangun** dengan pola yang identik dengan Tahap F: field baru `goldPurchaseRumor: { relevant,
country, tonnesEstimate, reason }` ditambahkan ke prompt AI klasifikasi berita yang sama
(`buildMarketNewsAutofillPrompt`) yang sudah dipakai Tahap F untuk `geopoliticalRisk` - tidak ada
provider baru, memakai ulang panggilan AI yang sudah berjalan tiap 15 menit. `country`/
`tonnesEstimate` dipaksa `null` di server kalau `relevant` bukan literal `true`, sama seperti pola
`normalizeLiveEventGeopoliticalRisk` di Tahap F - tidak pernah percaya angka dari item yang model
sendiri tidak tandai relevan.

**Tampilan**: `GET /api/macro/central-bank-gold-rumors` mengembalikan daftar rumor dari LiveEvent
yang sudah dipublikasi (14 hari terakhir, sama window dengan Tahap F). Ditampilkan di UI sebagai
section TERPISAH dari Tier 1, dengan badge **"UNCONFIRMED"** berwarna beda (amber, bukan hijau/
warna Tier 1) dan disclaimer eksplisit di setiap baris - supaya tidak pernah terlihat sama
otoritatifnya dengan Tier 1 yang sudah diverifikasi terhadap teks WGC asli.

**Kejujuran soal risiko**: ini SECARA INHEREN kurang reliable daripada Tier 1 - AI mengklasifikasi
prosa berita bebas, bukan membaca tabel/sumber resmi. Ini sesuai definisi Tier 3 itu sendiri
(rumor = belum terkonfirmasi), bukan bug yang perlu diperbaiki - makanya badge dan disclaimernya
eksplisit, bukan disamarkan.

## Ringkasan

| Tier | Status | Kenapa |
|---|---|---|
| 1 (Official) | **Dibangun** | WGC Gold Focus blog gratis, terverifikasi 5 putaran GitHub Actions, parser diuji cocok dengan data asli |
| 2 (Estimated) | **Ditutup (diaudit 2x)** | Tidak ada sumber gratis - dikonfirmasi ulang via GitHub Actions (Metals Focus tidak menyebut "central bank" di halaman gratisnya) |
| 3 (Rumored) | **Dibangun** | Perluasan prompt AI Tahap F, tag "UNCONFIRMED" terpisah visual dari Tier 1 |
