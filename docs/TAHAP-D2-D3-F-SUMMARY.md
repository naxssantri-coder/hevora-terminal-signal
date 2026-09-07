# Ringkasan gabungan — Tahap D2, D3 (3-tier), F

Laporan ini menutup batch tahap yang dikerjakan paralel di sesi ini (di luar Tahap H yang
di-skip, dan kalibrasi 7 pair baru yang ditunda, keduanya sesuai instruksi eksplisit).

## Status per tahap

| Tahap | Status | PR | Catatan |
|---|---|---|---|
| **D2** — COMEX delivery/inventory | Diaudit ulang, **tetap tidak dibangun** | [#24](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/24) | `Gold_Stocks.xls` gratis tapi format OLE/CFB lama (lebih buruk dari XLSX biasa); 2 endpoint JSON alternatif dicoba, keduanya 404. Tidak ada perubahan kode. |
| **D3 Tier 1** — Central Bank Gold (OFFICIAL) | **Dibangun** | [#24](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/24) | WGC blog "Gold Focus" gratis (bukan XLSX yang ternyata 403 diblokir). `GET /api/macro/central-bank-gold`, modul UI baru, Data Health Center diupdate, 2 probe permanen baru. Diverifikasi lewat GitHub Actions (run [32008283000](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/actions/runs/32008283000), success). |
| **D3 Tier 2** — ESTIMATED (analis) | **Belum dibangun — butuh klarifikasi** | — | Lihat pertanyaan di bawah. |
| **D3 Tier 3** — RUMORED/UNCONFIRMED | **Belum dibangun — butuh klarifikasi** | — | Lihat pertanyaan di bawah. |
| **F** — Geopolitical Risk Score | **Dibangun** | [#23](https://github.com/yogiaaxlheyugi-svg/hevora-terminal-signal-production/pull/23) | Perluasan prompt AI klasifikasi berita yang sudah jalan tiap 15 menit (bukan GPR Index bulanan). `GET /api/intelligence/geopolitical-risk`, metodologi agregasi dijelaskan penuh di response (bukan black box). |

Semua PR di atas **belum di-merge** — menunggu review, sesuai instruksi eksplisit ("jangan merge
PR mana pun sendiri").

## Ringkasan bukti kunci

**D2**: audit ulang terpisah dari D3 (sumbernya beda, CME bukan WGC) mengonfirmasi ulang
`Gold_Stocks.xls` — gratis, reachable, TAPI signature byte `d0cf11e0` menunjukkan format
OLE/Compound File Binary lama (bukan ZIP/XLSX modern), `unzip` gagal total. Ini lebih sulit
diparse daripada asumsi awal (XLSX biasa). Tidak ada endpoint JSON/CSV pengganti ditemukan.
Kesimpulan tidak berubah, tapi sekarang didasari bukti konkret, bukan asumsi "sama rapuhnya
dengan D3".

**D3 Tier 1**: audit ulang menemukan bahwa audit SEBELUMNYA salah probe halaman WGC (data
demand konsumen, bukan cadangan bank sentral). Halaman yang benar (`gold-reserves-by-country`)
memang punya file XLSX bertanggal yang cocok dengan deskripsi user (IMF IFS-sourced) — tapi file
itu diblokir HTTP 403 (dikonfirmasi 2x, termasuk dengan header `Referer`), BUKAN cuma rapuh
formatnya. Solusinya ditemukan lewat sumber lain milik WGC sendiri: blog bulanan gratis "Gold
Focus" yang mengutip sumber yang sama (IMF IFS + bank sentral) dalam teks artikelnya, dengan lag
pelaporan ~2 bulan persis seperti dijelaskan user. Dibangun dengan parser prosa (bukan tabel),
diuji cocok 100% (9/9 baris) terhadap teks asli, dan punya safe-fail eksplisit (<3 negara
terekstrak → `unavailable`, bukan tampilkan data tipis).

**F**: opsi "lebih live" (perluas prompt AI yang sudah jalan tiap 15 menit) dipilih dibanding GPR
Index (XLS bulanan, sudah dikonfirmasi rapuh sesi lalu) karena tidak ditemukan blokir nyata —
hanya field baru di skema JSON yang sudah diminta ke Gemini per headline, tanpa provider baru.
GPR Index tetap didokumentasikan sebagai fallback, bukan dibuang.

## Pertanyaan/klarifikasi yang perlu dijawab user

Ini murni karena pesan sebelumnya soal definisi Tier 2/3 terputus — bukan karena audit gagal
menemukan jawabannya sendiri.

### Tier 2 (ESTIMATED)

Tier 1 yang dibangun (blog Gold Focus) ternyata SUDAH mengutip "IMF IFS, respective central
banks" sebagai sumbernya sendiri, untuk bulan yang sudah lewat (lag ~2 bulan). Ini mengubah
premis awal Tier 2 ("estimasi analis mengisi celah sebelum data resmi keluar"), karena tidak
jelas celah APA yang dimaksud lagi. Dua kemungkinan, mohon konfirmasi salah satu (atau definisi
lain):

1. Tier 2 dimaksudkan untuk mengisi celah BULAN yang belum dilaporkan Tier 1 (mis. estimasi
   Juli/Agustus 2026 sebelum WGC merilis angka resmi itu, karena Tier 1 baru sampai Juni)? Kalau
   ya — sejauh audit ini, tidak ditemukan sumber GRATIS untuk itu (Metals Focus, yang disebut
   user, produk relevannya berbayar). Perlu digali lebih jauh, atau dikonfirmasi bahwa lag ~2
   bulan dari Tier 1 memang batas realistis yang diterima.
2. Atau Tier 2 dimaksudkan sebagai VALIDASI/pembanding independen terhadap angka Tier 1 (bukan
   pengisi celah waktu)? Kalau ini maksudnya, perlu didefinisikan ulang apa yang mau divalidasi
   dan dari sumber mana.

### Tier 3 (RUMORED/UNCONFIRMED)

Secara TEKNIS bisa dibangun sekarang dengan pola yang identik dengan Tahap F (field baru,
mis. `goldPurchaseRumor: { relevant, country, tonnesEstimate, reason }`, ditambahkan ke prompt AI
klasifikasi berita yang sama — tidak perlu provider baru). Yang belum ada adalah definisi persis
"rumor" yang dimaksud user (pesan sebelumnya terputus sebelum ini dijelaskan). Mohon konfirmasi:

- Apakah cukup "berita yang menyebut kemungkinan pembelian emas oleh bank sentral tertentu,
  belum dikonfirmasi resmi oleh WGC/bank sentral ybs" (mirip yang saya asumsikan)? Atau ada
  kriteria tambahan (mis. sumber berita harus kredibilitas tertentu, ambang confidence tertentu)?
- Bagaimana rumor ini seharusnya ditampilkan relatif ke Tier 1 (official) — apakah perlu badge
  "UNCONFIRMED" yang jelas dan terpisah, atau bentuk lain?

Tier 1 tetap berjalan penuh terlepas dari status Tier 2/3 — tidak ada yang diblokir menunggu
jawaban ini.

## Catatan

JANGAN merge PR mana pun secara otomatis — PR #23 dan #24 keduanya menunggu review manual.
