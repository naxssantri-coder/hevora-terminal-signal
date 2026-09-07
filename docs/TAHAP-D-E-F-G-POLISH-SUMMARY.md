# Ringkasan sesi: Tahap D, E, G, Polish, F

Lima tahap dikerjakan paralel dari main terkini (`86612ea`, setelah PR #15/#16/#17 merged), tiap
tahap di branch dan PR terpisah, tidak ada yang di-merge sendiri - semuanya menunggu review.
Urutan di bawah sesuai urutan penyelesaian, bukan urutan brief.

| Tahap | Status | PR | Ringkasan |
|---|---|---|---|
| Polish (Order Book) | **Selesai** | [#18](../../pull/18) | Depth bar 10%→25% opacity, tambah cumulative depth bar+kolom. Presentasi murni, tidak ada perubahan logika data/WebSocket. |
| D (XAU gap) | **Selesai** | [#19](../../pull/19) | D1 (COMEX futures curve) dibangun, terverifikasi GitHub Actions. D2 (inventory) dan D3 (WGC per-negara) TIDAK dibangun - keduanya XLSX-only, kelas kerapuhan yang sama dengan GLD/WGC yang sudah pernah ditolak eksplisit. |
| E (Session Intel + FRED) | **Selesai** | [#20](../../pull/20) | E1 (Session Intelligence) dibangun, murni perhitungan UTC + candle live. E2 (FRED nganggur) ternyata sudah ditutup di fase sebelumnya - audit membuktikan nol series yang belum tersambung. |
| G (Data Health Center) | **Selesai** | [#21](../../pull/21) | Tab admin baru + endpoint `/api/admin/data-health`, status kategorikal per provider, bukan skor numerik. Mengikuti konvensi akses `storage-health` yang sudah ada. |
| F (Geopolitical Risk Score) | **STOPPED** | - | Tidak ada satu pun jalur bersih yang murni gratis+real-time+internal - lihat detail di bawah. Menunggu keputusan Anda, sesuai instruksi eksplisit bahwa tahap ini boleh berhenti. |

Detail audit lengkap tiap tahap ada di file terpisah:
- `docs/TAHAP-D-XAU-GAP-AUDIT.md`
- `docs/TAHAP-E-SESSION-FRED-AUDIT.md`
- `docs/TAHAP-G-DATA-HEALTH-CENTER.md`

---

## Tahap F — Geopolitical Risk Score: kenapa berhenti

Ini SATU-SATUNYA tahap yang berhenti menunggu konfirmasi, sesuai instruksi eksplisit. Bukan
karena satu-satunya opsi berbayar (tidak ada opsi berbayar yang ditemukan) - tapi karena tidak ada
satu jalur pun yang "murni gratis + granularitas memadai + tanpa parsing biner" seperti tahap lain
di sesi ini. Ini keputusan yang genuinely ambigu, bukan sesuatu yang aman diputuskan sendiri.

### 1. Dari pipeline internal (news + klasifikasi geopolitik yang sudah ada)?

Dicek kode `server.ts` untuk klasifikasi topik pada Live Intelligence. Hasilnya: field topik
`'Geopolitics'` (dari `LIVE_EVENT_SEGMENT_TOPICS`) **memang ada**, TAPI hanya dipakai di pipeline
transkrip event langsung (pidato, konferensi pers - `buildLiveEventAutofillPrompt`), bukan di
pipeline berita umum (`buildMarketNewsAutofillPrompt`, tipe `market_news`) yang jadi sumber volume
berita sehari-hari. Berita umum cuma diberi `impact` (High/Medium/Low) dan arah per kelas aset -
tidak ada tag topik geopolitik sama sekali.

Artinya: skor dari data internal MURNI (tanpa perubahan apa pun) tidak bisa dibuat - datanya
terlalu jarang (cuma dari pidato/transkrip, bukan arus berita harian). Untuk membuatnya bisa,
prompt AI klasifikasi berita (`buildMarketNewsAutofillPrompt`) perlu ditambah satu field topik -
ini teknis kecil (memakai ulang panggilan AI yang sudah ada per-judul, tidak ada biaya baru), TAPI
tetap sebuah keputusan scope: menambah tanggung jawab baru ke prompt yang sudah ada, bukan
sekadar "menghitung dari yang sudah ada" seperti Session Intelligence.

### 2. Dari index eksternal (GPR - Caldara & Iacoviello, matteoiacoviello.com)?

Diverifikasi via GitHub Actions (bukan cuma WebSearch): `data_gpr_export.xls` - **gratis, publik,
akademik, reachable (200)**, TAPI:

```
content-type: application/vnd.ms-excel
2,694,276 bytes
signature: legacy XLS binary (bukan JSON, bukan CSV)
```

Sama seperti D2/D3 di atas - kelas kerapuhan yang sama dengan GLD/WGC yang sudah pernah ditolak.
Ditambah: index ini **bulanan**, bukan realtime - berbeda kelas kegunaan dari kebanyakan panel di
proyek ini.

### Kesimpulan: dua opsi nyata, tidak ada yang "cuma wiring"

1. **Perluas prompt klasifikasi berita** untuk menandai topik geopolitik per judul (biaya AI $0
   tambahan, tapi menambah tanggung jawab ke prompt yang sudah ada - butuh persetujuan scope).
2. **Parsing XLS GPR bulanan** (build dependency baru untuk format biner, demi satu index bulanan
   - persis alasan yang sudah menolak GLD/WGC dua kali di proyek ini).

Tidak ada opsi ketiga yang "cuma menghitung dari data yang sudah ada tanpa keputusan desain baru".
Karena itu berhenti di sini, tidak membangun apa pun, menunggu Anda memilih (atau menolak
keduanya).

---

## Yang perlu diperhatikan saat review

- PR #19 (Tahap D) menambahkan probe `critical: true` baru ke `verify-sources.ts` - sudah
  diverifikasi via GitHub Actions run kedua PERSIS di branch itu (bukan cuma run gabungan awal)
  sebelum dilaporkan selesai.
- PR #20 dan #21 tidak menyentuh `server.ts`'s realtime price/candle/order-book logic sama sekali
  - keduanya baca-saja dari state yang sudah ada.
- Semua 4 PR (18, 19, 20, 21) sudah lolos `npm run lint` dan `npm run build` bersih, dan build
  artifact (`dist/`, `public/assets/*`) sudah dikembalikan sebelum commit.
- Tidak ada PR yang di-merge oleh saya - semuanya menunggu review Anda.
