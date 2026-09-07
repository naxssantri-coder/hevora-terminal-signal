# Tahap D2 — COMEX Delivery & Inventory, audit ulang terpisah dari D3

Sebelumnya D2 distop bareng D3 (dianggap sama-sama sumber rapuh). Diaudit ulang SENDIRI, terpisah
dari D3, sesuai instruksi - karena sumbernya memang beda (CME, bukan WGC).

## Bukti baru dari audit ulang (GitHub Actions, `scripts/audit-wgc-imf-structure.ts`)

`Gold_Stocks.xls` (`cmegroup.com/delivery_reports/`) dikonfirmasi ulang:
- **Gratis, reachable (HTTP 200)** - sama seperti temuan sebelumnya.
- **Signature byte: `d0cf11e0`** - ini bukan ZIP/XLSX modern (yang akan diawali `PK`), tapi
  **format OLE/Compound File Binary lama (.xls klasik, pra-2007)**. `unzip` gagal total
  ("not a zipfile") - format ini secara struktural BUKAN sesuatu yang bisa dibuka pakai tool
  unzip standar sama sekali, beda dengan XLSX (yang setidaknya adalah ZIP berisi XML, dan
  probe Tahap D yang lain berhasil membukanya).
- 2 kandidat endpoint JSON yang dicoba (`CmeWS/mvc/Reports/L1LookupTable`,
  `services/delivery-reports/gold-stocks`) - keduanya **404**, tidak ada API pengganti yang
  ditemukan.

## Kesimpulan: tetap TIDAK dibangun, dengan bukti lebih kuat dari sebelumnya

Audit ulang ini menguatkan (bukan melemahkan) keputusan sebelumnya: bukan cuma "XLSX vs JSON"
seperti dugaan awal, tapi format biner lama yang lebih sulit diparse daripada XLSX modern
(perlu library khusus untuk format OLE/CFB, bukan sekadar unzip+baca XML seperti pendekatan yang
berhasil dipakai di Tahap D3 Tier 1). Tidak ada endpoint JSON/CSV pengganti yang ditemukan.

Keputusan tidak berubah: **tidak dibangun**, alasan yang sama seperti sebelumnya (kelas kerapuhan
GLD/WGC yang sudah ditolak eksplisit) plus bukti konkret baru bahwa formatnya lebih buruk dari
yang diasumsikan awalnya. Tidak ada perubahan kode untuk D2.
