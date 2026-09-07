# Tahap F — Geopolitical Risk Score (blueprint §49): dibangun

## Keputusan: AI classification (Live Intelligence), bukan GPR Index

Sesuai instruksi: prioritaskan opsi yang lebih live. Dua opsi diaudit ulang:

1. **Perluas prompt AI klasifikasi berita yang sudah ada** (`buildMarketNewsAutofillPrompt`,
   dipanggil setiap ada berita baru lewat `scripts/live-intel-watcher.ts`, polling tiap **15
   menit** via GitHub Actions cron - dikonfirmasi dari `.github/workflows/live-intel-watcher.yml`).
2. **GPR Index** (Caldara & Iacoviello, matteoiacoviello.com) - sudah dikonfirmasi sesi
   sebelumnya: gratis, tapi XLS-only dan **bulanan**, bukan realtime.

**Dipilih: opsi 1.** Tidak ada masalah nyata yang ditemukan di opsi 1 (bukan cuma soal effort) -
ini murni menambah satu field ke skema JSON yang sudah diminta ke Gemini per judul berita,
memakai ulang panggilan AI yang sudah dibayar/dijalankan, tanpa biaya API baru dan tanpa provider
baru. GPR Index tetap TIDAK dibangun (sama seperti keputusan D2/D3: XLS-only, bulanan, kelas
kerapuhan yang sama) - dicatat sebagai fallback yang diaudit tapi tidak diperlukan, bukan
pengganti.

## Yang dibangun

**Prompt** (`buildMarketNewsAutofillPrompt`, server.ts) - field baru `geopoliticalRisk`:
```json
{
  "geopoliticalRisk": { "relevant": true | false, "score": 0-100, "reason": "..." }
}
```
Aturan eksplisit di prompt: `relevant: true` HANYA untuk ketegangan geopolitik LANGSUNG (perang,
sanksi, krisis diplomatik, terorisme, kudeta) - berita ekonomi/pasar biasa BUKAN geopolitik
meskipun berdampak ke pasar (bahkan kalau `impact` di atas "High"). Skor dipaksa 0 kalau
`relevant: false` (`normalizeLiveEventGeopoliticalRisk` di server.ts memvalidasi ini di sisi
server, tidak percaya begitu saja output AI).

**Alur data** (mengikuti pola `assetClassImpacts` yang sudah ada persis):
`runMarketNewsAiAutofill` → `POST /api/admin/live-events/ai-autofill` (watcher) →
`POST /api/admin/live-events` → `publishLiveEventRecord` → tersimpan di `LiveEvent.geopoliticalRisk`
(field opsional, konvensi "absent = belum pernah dicek" sama seperti `assetClassImpacts`).

**Agregasi**: `GET /api/intelligence/geopolitical-risk` - skor 0-100 dari rata-rata berbobot
(recency-weighted) atas semua item `market_news` dengan `geopoliticalRisk.relevant: true` dalam
14 hari terakhir. Bobot meluruh LINEAR dari 1.0 (baru terbit) ke 0.0 di ujung jendela 14 hari -
metodologi paling sederhana yang tetap memprioritaskan eskalasi baru, dijelaskan penuh di field
`methodology` response (bukan kotak hitam). `topContributors` menampilkan headline mana saja yang
menyumbang skor, dengan bobot masing-masing - bisa diverifikasi manual.

**UI**: modul baru "Geopolitical Risk" (`/analysis/geopolitical-risk`, kategori `analysis` -
sekeluarga dengan Sentiment, bukan Macro). Skor besar berwarna (hijau <33, kuning 33-66, merah
≥66 - arah warna KEBALIKAN dari komponen Gauge yang sudah ada, karena untuk skor risiko "tinggi =
buruk", bukan "tinggi = risk-on" seperti Sentiment - sengaja tidak memakai ulang komponen Gauge
supaya tidak salah warna), plus daftar kontributor teratas.

## Verifikasi

- `npm run lint` (tsc --noEmit): bersih
- `npm run build`: bersih
- Boot test lokal: `GET /api/intelligence/geopolitical-risk` mengembalikan `unavailable: true`
  dengan alasan jujur ("no geopolitically-relevant news scored") karena store lokal kosong -
  tidak crash, tidak mengarang angka
- Formula pembobotan diuji manual dengan 3 item contoh (baru/pertengahan/mendekati ujung
  jendela) - hasil sesuai ekspektasi (item mendekati ujung jendela bobotnya ~0, item baru
  mendominasi agregat)
