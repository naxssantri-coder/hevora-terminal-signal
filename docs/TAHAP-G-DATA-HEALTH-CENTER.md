# Tahap G — Market Data Health Center (blueprint §62 tambahan-2)

## Audit akses sebelum membangun

Dicek dulu konvensi akses yang sudah ada untuk halaman sejenis. `/api/admin/storage-health`
(Redis health) sudah ada, admin-only lewat `requireAdminAuth` (HTTP Basic Auth), ditampilkan
sebagai banner di `AdminDashboard.tsx` (bukan halaman publik terpisah). Health Center ini adalah
halaman ops/operasional (status koneksi provider), bukan fitur trading - jadi mengikuti konvensi
yang sama persis: tab baru di dalam `AdminDashboard.tsx` yang sudah ada (`Data Health`), endpoint
baru `GET /api/admin/data-health` di belakang `requireAdminAuth` yang sama. Tidak dibuat modul
publik baru, tidak dibuat pola akses baru.

## Desain: status kategorikal, BUKAN skor numerik

Sesuai instruksi eksplisit: kolom `status` hanya `LIVE | DELAYED | STALE | UNAVAILABLE` (kategori
yang sudah dipakai `DataQualityBadge` di seluruh aplikasi), plus `lastSuccessfulFetch` (timestamp
nyata). Tidak ada skor 0-100 atau sejenisnya - angka semacam itu sendiri berpotensi jadi angka
karangan di atas data yang sudah jujur.

## Sumber data: membaca state yang sudah ada, tidak fetch baru

Setiap baris membaca variabel/cache yang SUDAH dipelihara aplikasi untuk operasinya sendiri -
tidak ada satu pun panggilan jaringan baru dipicu oleh membuka halaman ini:

| Provider | Sumber baca |
|---|---|
| Yahoo Finance (FX & Gold spot) | `currentPrices.XAUUSD.lastUpdated` |
| Yahoo Finance (Commodities board) | `externalFeedCaches.get('commodities-board')` |
| Yahoo Finance (DXY) | `dxyState.lastUpdated` |
| Yahoo Finance (Gold Seasonality) | `externalFeedCaches.get('gold-seasonality')` |
| OKX (crypto spot/derivatives) | `currentPrices.BTCUSDT.lastUpdated` |
| BTC-USDT order book relay | `btcUsdtBook.updatedAt` + `.source` |
| Bybit (fallback) | Sama seperti di atas, diberi keterangan "fallback only, non-critical" - konsisten dengan pola project ini yang sudah lama menandai Bybit sebagai secondary path dari IP cloud |
| FRED (37 indikator) | `fredCache` Map (agregat: fetch tersukses paling baru + jumlah indikator ter-cache) |
| CFTC (COT) | `externalFeedCaches.get('cot')` |
| DefiLlama (TVL, stablecoin) | `externalFeedCaches.get('chains-tvl')` / `('stablecoins')` |
| Alternative.me (Fear & Greed) | `externalFeedCaches.get('fear-greed')` |
| CoinGecko (dominance) | `externalFeedCaches.get('crypto-dominance')` |
| EIA (crude inventory) | `externalFeedCaches.get('eia-crude-stocks')` |
| World Gold Council | **Sengaja UNAVAILABLE** - lihat di bawah |

Status dihitung dari umur data (`now - lastSuccessfulFetch`) dibanding TTL refresh masing-masing
provider (persis pola `statusFromAge` yang sudah dipakai di frontend), bukan pengecekan
error/success eksplisit - `externalFeedCaches` sendiri cuma menyimpan fetch yang BERHASIL, jadi
"umur data" sudah dengan sendirinya mencerminkan seberapa baru provider itu benar-benar menjawab.

## Baris WGC: contoh jujur dari "Provider not wired"

World Gold Council tetap dicantumkan di daftar (bukan dihilangkan diam-diam) dengan status
`UNAVAILABLE` dan alasan spesifik: sumbernya XLSX-download-only, tidak pernah benar-benar
di-parse ke aplikasi (lihat `docs/TAHAP-D-XAU-GAP-AUDIT.md`, item D3). Ini persis pola yang
diminta: "Provider not wired" + alasan spesifik, bukan pesan generik.

## Tidak duplikat modul data lain

Halaman ini cuma menampilkan RINGKASAN status koneksi - bukan re-tampilkan data individual
(harga, indikator, dsb.) yang sudah punya modul sendiri. Setiap baris hanya berisi:
provider, kategori, status, waktu fetch terakhir, dan satu baris keterangan.
