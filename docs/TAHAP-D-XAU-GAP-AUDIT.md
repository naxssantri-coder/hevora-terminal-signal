# Tahap D — Sisa Gap XAU (blueprint §13-15): audit + hasil

Tiga item, tiga hasil berbeda. Semua diverifikasi via GitHub Actions run
(`31990599438`, branch `claude/tahap-multi-audit-probes`) sebelum keputusan dibuat - bukan
asumsi dari WebSearch atau memori model.

## D1 — COMEX gold futures curve: DIBANGUN

**Klaim yang diverifikasi**: apakah Yahoo Finance melayani kontrak futures gold COMEX per bulan
individual (bukan cuma `GC=F` continuous front-month yang sudah dipakai untuk spot/seasonality).

**Bukti nyata (GitHub Actions, bukan lokal)**:

| Probe | Hasil |
|---|---|
| `yahoo:GCZ26` (tanpa suffix bursa) | `404 Not Found` |
| `yahoo:GCZ26.CMX` (Des 2026) | `200` — `4450.2 USD` |
| `yahoo:GCV26.CMX` (Okt 2026, near month) | `200` — `4417.2 USD` |
| `yahoo:GCG27.CMX` (Feb 2027) | `200` — `4486.1 USD` |
| `yahoo:GCJ27.CMX` (Apr 2027) | `200` — `4530.3 USD` |
| `yahoo:GCM27.CMX` (Jun 2027) | `200` — `4554 USD` |

Suffix `.CMX` wajib (tanpa suffix 404), dan 5 kontrak bulan berbeda semuanya menjawab dengan harga
**berbeda dan konsisten dengan bentuk kurva** (naik dari kontrak dekat ke jauh - contango asli,
bukan angka yang sama diulang 5x). Ini cukup untuk membangun.

**Yang dibangun**: `GET /api/market/xau-futures-curve` (server.ts) + modul baru "XAU Futures
Curve" (`/macro/xau-futures-curve`, `XauFuturesCurveView.tsx`) - line chart + tabel per kontrak,
selisih vs kontrak terdekat, label contango/backwardation otomatis dari 2 titik ujung kurva.

Bulan kontrak mengikuti siklus listing standar COMEX gold (Feb/Apr/Jun/Aug/Okt/Des - bulan genap),
konvensi resmi bursa, bukan tebakan per-run. **Bulan kalender berjalan sengaja tidak pernah jadi
salah satu dari 5 kontrak yang ditampilkan** - hanya kombinasi bulan/tahun yang benar-benar
terbukti reachable di atas yang dipakai; pola nama simbol (kode bulan + tahun 2 digit + `.CMX`)
digeneralisasi karena itu konvensi standar futures yang terdokumentasi, tapi kasus spesifik
Agustus-2026 sendiri tidak pernah diprobe langsung.

Probe permanen ditambahkan ke `scripts/verify-sources.ts` (grup "XAU Futures Curve", `critical:
true` karena panel baru ini bergantung padanya).

## D2 — COMEX delivery/inventory (registered/eligible): TIDAK DIBANGUN

**Klaim yang diverifikasi**: apakah CME/COMEX punya endpoint publik gratis untuk data inventory
gold (registered/eligible).

**Bukti nyata**: `https://www.cmegroup.com/delivery_reports/Gold_Stocks.xls` - **gratis, reachable
(200)**, TAPI:

```
content-type: application/vnd.ms-excel
23,431 bytes
signature: legacy XLS binary (bukan ZIP/XLSX, bukan JSON, bukan CSV)
```

**Keputusan: tidak dibangun.** Ini persis kelas kerapuhan yang sama dengan GLD holdings dan WGC
data (`docs/FASE-8-AUDIT.md` §I1) yang sudah eksplisit ditolak sesi sebelumnya: bukan soal
berbayar, tapi format binary spreadsheet yang butuh parser baru (dependency baru untuk format
biner) demi satu angka inventory yang update harian. Konsisten dengan keputusan yang sudah ada,
bukan keputusan baru yang longgar.

Probe dipertahankan permanen di `verify-sources.ts` (non-critical) sebagai tripwire format - kalau
CME suatu saat menerbitkan JSON/CSV, probe ini akan menandainya untuk audit ulang.

## D3 — Central bank gold buying per-negara (World Gold Council): TIDAK DIBANGUN, klaim awal salah

**Temuan penting**: instruksi tahap ini berasumsi WGC data "sudah di-scrape proyek ini". Audit
kode membuktikan itu **tidak benar** - `server.ts` tidak punya satu baris pun yang mem-parse data
WGC. Yang ada hanya satu probe reachability di `verify-sources.ts` (`wgc:gold-demand`) yang
memvalidasi halaman `gold.org/goldhub/data/gold-demand-by-country` masih mengandung kata kunci
("central bank", "tonnes", "demand") - ini cek "halaman masih hidup", bukan pipeline data.

Per `docs/FASE-8-AUDIT.md` §I1 (eksplorasi 3 run sebelumnya, sudah didokumentasikan): halaman WGC
itu sendiri cuma tautan unduhan XLSX bertanggal, update kuartalan, tidak ada JSON bersih. Karena
tidak pernah benar-benar di-parse, pertanyaan "breakdown per-negara atau cuma agregat" tidak
relevan - datanya belum pernah masuk aplikasi sama sekali, dalam bentuk apa pun.

**Keputusan: tidak dibangun**, dengan alasan yang sama seperti D2 (XLSX-only, sudah pernah
ditolak eksplisit). Tidak ada perubahan pada `verify-sources.ts` untuk item ini - probe
reachability yang sudah ada dibiarkan seperti apa adanya.

## Ringkasan

| Item | Status | Kenapa |
|---|---|---|
| D1: Futures curve | **Dibangun** | Format terbukti bekerja, 5/5 kontrak reachable dengan harga berbeda-beda yang masuk akal |
| D2: Delivery/inventory | Tidak dibangun | Gratis, tapi XLS-only - kelas kerapuhan yang sama dengan GLD/WGC (sudah ditolak sebelumnya) |
| D3: WGC per-negara | Tidak dibangun | Klaim "sudah di-scrape" salah - faktanya cuma probe reachability, dan sumbernya sendiri XLSX-only |
