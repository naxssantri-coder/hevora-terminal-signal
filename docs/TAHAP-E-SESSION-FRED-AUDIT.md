# Tahap E — Session Intelligence + FRED Nganggur (blueprint §22, §47): audit + hasil

## E1 — Session Intelligence: DIBANGUN

Murni perhitungan dari jam UTC + candle yang sudah live (`/api/market/candles`) - tidak ada
provider baru, tidak ada perubahan server.ts.

**Audit modul sebelum membangun**: `src/modules/registry.ts` tidak punya modul session/overlap
apa pun. Modul terdekat (`macro-overview`, `global-macro`) adalah FRED/fiskal, bukan jam sesi -
menambahkan ke sana akan jadi modul campur aduk, bukan perluasan yang wajar. Dibuat modul baru
`session-intelligence` di kategori **analysis** (satu keluarga dengan Volatility/Momentum/Market
Structure - overlay analitik di atas pair yang sudah ada), bukan **macro**, dan dinamai eksplisit
"Session Intelligence" - bukan "Overview" lagi - persis menghindari kesalahan yang sudah pernah
terjadi di proyek ini (3 modul beda dilabeli sama).

**Temuan penting sebelum membangun rentang H/L per sesi**: `candleStore` di server.ts cuma
menyimpan **30 candle 5-menit per pair (~2.5 jam), bukan histori penuh** (`candleStore[pairId] =
candles.slice(-30)` - dikonfirmasi lewat pembacaan kode langsung, bukan asumsi). Artinya sesi yang
sudah berjalan lebih dari 2.5 jam (semua sesi utama berjalan 8-9 jam) TIDAK BISA dihitung rentang
penuhnya dari data yang tersedia sekarang - datanya memang tidak cukup panjang, persis pola
"data ada tapi tidak cukup padat/panjang" yang jadi pelajaran dari bug Gold Seasonality.

**Keputusan desain**: rentang sesi dihitung dari candle yang tersedia, DIBATASI JUJUR:
- Kalau candle tertua yang ada ≤ waktu buka sesi → rentang itu memang rentang sesi PENUH, ditandai
  badge "Full session".
- Kalau sesi sudah berjalan lebih lama dari jendela candle → ditandai badge "Partial" dengan
  keterangan eksplisit, BUKAN ditampilkan seolah itu rentang sesi penuh.

Tidak ada penyimpanan baru di server - semua dihitung di client dari data yang sudah dikirim,
menghindari sentuhan ke engine tick loop yang sensitif.

**Yang dibangun**:
- `src/lib/market/sessions.ts` - definisi 4 sesi (Sydney/Tokyo/London/New York, jam UTC TETAP,
  bukan disesuaikan DST - dinyatakan eksplisit di UI, bukan dipoles seolah presisi), perhitungan
  status buka/tutup + overlap, dan `sessionRangeFromCandles()` dengan capping jujur di atas.
- Modul baru `src/components/analysis/SessionIntelligenceView.tsx` - jam sesi, overlap aktif,
  tabel rentang per pair dengan badge cakupan (Full session / Partial).

## E2 — FRED "nganggur": SUDAH TIDAK ADA, sudah ditutup di fase sebelumnya

**Audit**: dibandingkan setiap `fredSeriesId` di `ECON_INDICATORS` (server.ts, 37 indikator) dan
setiap probe `fred:*` di `verify-sources.ts` terhadap pemakaian nyata di `src/components/`.

**Hasil**: nol yang nganggur. Semua 37 indikator sudah dikonsumsi oleh minimal satu modul macro
(`EconomicHistoryView`, `GlobalMacroView`, `InflationView`, `YieldCurveView`, dst). Komentar di
`GlobalMacroView.tsx` sendiri mengonfirmasi ini sudah pernah jadi tugas eksplisit di fase
sebelumnya: *"Four of these eight (SOFR, RRPONTSYD, WRESBAL, WTREGEN) were actually probed as
reachable a phase ago and simply never connected to anything - closing that is as much a part of
this pass as the metrics §2.5's own audit named."* - artinya pekerjaan "sambungkan FRED yang sudah
diprobe tapi belum dipakai" sudah selesai sebelum sesi ini dimulai.

Setiap probe `fred:*` di `verify-sources.ts` juga sudah punya komentar header yang menyatakan hal
sama: *"FRED series the audit lists as one-line additions (§C2), now wired into ECON_INDICATORS"*.

**Kesimpulan**: tidak ada perubahan yang diperlukan untuk E2. Tidak ada kode yang ditambahkan.

## Ringkasan

| Item | Status | Kenapa |
|---|---|---|
| E1: Session Intelligence | **Dibangun** | Murni perhitungan, tanpa provider baru; rentang sesi dibatasi jujur sesuai kedalaman candleStore yang nyata (~2.5 jam) |
| E2: FRED nganggur | **Sudah selesai sebelumnya** | Audit membuktikan nol series yang belum tersambung - semua 37 indikator sudah dipakai di modul macro yang ada |
