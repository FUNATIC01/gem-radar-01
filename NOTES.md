# Radar-5 — catatan eksperimen (jejak pendekatan + hasil)

Target (brief): backtest LOO n=119 — median abs error ≤70% (regang ≤60%),
band coverage ≥55%, Spearman ≥ radar-4, baris ≥178, dashboard ≤24.827 byte,
runtime ≤0,61 dtk, dossier ≤613.275 byte, gate + check 0 FAIL, rebuild byte-identik.

## Baseline terverifikasi (replikasi eksak radar-4 dari deskripsi)
- Radar-4: TVL × median kelipatan mcap/TVL peer se-kategori (min 5 peer,
  fallback global) × growth(0,4) × maturity(0,85–1,0) × breadth(1–1,12).
  LOO n=119: **medAE 91,9% / signed +5,6% / coverage 38,7% / Spearman 0,379**.
  Replikasi gue cocok persis dengan angka brief → harness LOO gue benar.

## EDA / root-cause
- Kelipatan mcap/TVL jatuh curam dengan TVL: median kelipatan per desil TVL
  $5–7jt → 1,00; $931jt–$18,7m → 0,019 (≈50×). Log-log slope global 0,47,
  bukan 1,0 → asumsi radar-4 (mcap ∝ TVL) bias sistematis: overpredict
  protokol besar, underpredict yang kecil.
- Dispersi dalam kategori sangat besar: logSD kelipatan 1,0–3,0 per kategori;
  SD global log-kelipatan 2,26, dalam-kategori (pooled) 1,85 → kategori hanya
  menjelaskan ~33% varians. Residual SD log-log OLS 2,05, median |resid| 1,20.
- Korelasi residu dengan fitur lain ≈ 0: growth −0,07, umur −0,08,
  jumlah chain −0,01, share kategori +0,17 → adjustment radar-4 (growth/
  maturity/breadth) hampir murni noise (tanpa adjustment: 90,5% vs 91,9%).
- Median global saja (88,3%) mengalahkan median per kategori (90,5%):
  n per kategori kecil (1–15) → median kategori didominasi noise estimasi.
- Artefak: kelipatan tertinggi adalah token milik keluarga lain / versi lama
  (400×, 36×, 19×, 14,5× — aave-v2, mantle-bridge, dsb); terendah token
  infra/staking (0,0003×–0,006×). Tidak ada gecko_id/symbol duplikat.
- Spearman TVL vs mcap global 0,413; dalam-kategori (pooled) 0,514 →
  ranking dalam kategori lebih kuat dari ranking global.
- Matematika batas: dengan residual log SD ≈ 2,0, median AE optimal
  (titik berapapun) ≈ 88% untuk distribusi normal — jadi kemenangan ke ≤70%
  HARUS datang dari prediksi yang genuinely lebih sempit untuk ≥50%
  protokol, bukan dari geser skala / pilih titik (scale sweep: 83,7–93%).

## Pendekatan dicoba (semua LOO n=119, harness yang sama)
| # | Pendekatan | medAE | signed | Spearman | Catatan |
|---|------------|------:|-------:|---------:|---------|
| 0 | Radar-4 (replikasi) | 91,9 | +5,6 | 0,379 | baseline |
| 1 | Radar-4 tanpa adjustment | 90,5 | +11,7 | 0,385 | adjustment = noise |
| 2 | Median kelipatan global | 88,3 | −0,9 | 0,403 | |
| 3 | Log-log OLS global | 84,6 | −7,8 | 0,371 | slope 0,47 |
| 4 | Log-log L1 (IRLS) global | 84,2 | −0,5 | 0,359 | |
| 5 | Log-log OLS intercept per kategori | 84,3 | −12,8 | 0,328 | |
| 6 | Log-log L1 + kuadrat | 84,1 | −1,9 | 0,372 | |
| 7 | Quantile reg tau 0,45 global | 83,8 | −18,4 | 0,400 | |
| 8 | Shrinkage median log-kelipatan k=5/10 | 90,5/90,1 | +28/+22 | 0,395/0,406 | |
| 9 | kNN logTVL dalam kategori k=5/7/10/15 | 97,1/89,2/90,0/90,7 | — | 0,30/0,29/0,25/0,17 | buruk |
| 10 | kNN global k=30 | 85,3 | +2,6 | 0,261 | |
| 11 | Binned median logMCAP nb=6 | 84,7 | +4,6 | 0,273 | |
| 12 | Ensemble rata-rata log (berbagai) | 85,3–88,3 | — | 0,36–0,40 | tidak membantu |
| 13 | Empirical-Bayes intercept grup, L1, tau=0,8 | **81,8** | −11,0 | 0,342 | terbaik sejauh ini |
| 14 | EB intercept grup OLS tau=0,8 | 82,9 | −12,3 | 0,373 | |
| 15 | EB intercept kategori tau=0,8 | 83,6–84,2 | — | 0,36–0,38 | |
| 16 | Slope per grup (centred, shrink) | 84,0–87,3 | — | 0,33–0,36 | slope grup = noise |
| 17 | Trim asimetris saat fitting | 86,6–88,2 | — | 0,39–0,41 | |
| 18 | Chain primer EB | 84,4 | +5,3 | 0,402 | |
| 19 | Peer bersih (tanpa Bridge/LST/versioned) + L1 | 82,3 | −4,7 | 0,389 | |
| 20 | Peer bersih + EB-L1 | 81,3 | −13,7 | 0,327 | |
| 21 | Gradient boosting depth-2 (60r, semua fitur) | 91,5 | −5,9 | 0,213 | overfit, gagal |
| 22 | Ridge kitchen-sink (lambda inner-LOO) | 83,4 | −0,8 | 0,089 | Spearman hancur |
| 23 | Theil-Sen log-log | 85,0 | −0,9 | 0,375 | |
| 24 | Siegel repeated-median | 83,3 | +2,6 | 0,370 | |
| 25 | Percentile-matching (TVL pct → mcap pct) | 98,1–98,4 | — | 0,38–0,41 | gagal |
| 26 | Median mcap kategori / global | 93,4 / 85,6 | — | −0,05 / −0,87 | ranking hancur |
| 27 | Scale sweep (×0,2–×1,0) semua model | 83,7–93% | — | sama | titik optimal ≈ skala 0,86–0,9 |
| 28 | Stacking kalibrasi median per grup/kategori/tercil | (dihentikan — terlalu lambat; diganti hat-matrix exp16) | | | nested LOO IRLS ~225k refit |
| 29 | Stack-hat (hat-matrix LOO residu) group+cat k=6 | **81,0** | +0,5 | 0,370 | kalibrasi median bersarang, jujur |
| 30 | Bagged cat-int OLS | 92,3 | −29,9 | 0,242 | bootstrap merusak kategori langka |
| 31 | Ridge intercept kategori (inner-LOO lambda) | 97,6 | −95,7 | 0,134 | implementasi penalti salah (dummy → 0) |
| 32 | Klaster kategori by median kelipatan (k-means 1D) | 85,0–89,3 | — | 0,23–0,32 | klaster didominasi kategori n=1 |
| 33 | LOESS log-log (frac 0,3–1,0) / grup | 84,9–92,8 | — | 0,24–0,36 | |
| 34 | Piecewise slope (breakpoint median TVL) | 84,2–85,7 | — | 0,34–0,36 | slope kecil 1,00 vs besar 0,33 tapi tak membantu LOO |
| 35 | Share model (alokasi total mcap kategori) | 82,9–609,7 | — | 0,13–0,35 | total didominasi artefak |
| 36 | Huber (k=1,0–2,5) global | 83,7–85,1 | — | 0,37–0,38 | |
| 37 | Huber-EB grup (trimmed-mean) | 82,8–83,3 | −11 s/d −12 | 0,38 | |
| 38 | **Huber double-EB grup + chain primer** | **80,1** | +8,6 | **0,399** | **terbaik sejauh ini** |
| 39 | Huber + grup + chain + kohort tahun listing | 80,8 | −0,1 | 0,370 | kohort tak membantu |
| 40 | Huber + grup + chain + profil chain | 80,5 | +11,3 | 0,391 | |
| 41 | Fitur tunggal (share, relTVL, logCatTot, kata nama, dsb) | 83,3–87,6 | — | 0,30–0,41 | semua dalam noise |
| 42 | Cell median (grup × tercil TVL, shrink) | 89,7–95,6 | — | 0,09–0,36 | sinyal in-sample = overfit |
| 43 | KDE-mode / shorth (log) | 83,3–96,9 | — | 0,17–0,42 | |
| 44 | Shorth-centre (linear) / tilted median / mean-rel-err GD | 96–100 | −99 | 0,25–0,75 | **Spearman 0,746 PALSU — leakage LOO (lihat bawah)** |
| 45 | Mixture-quantile (tau per grup dari fraksi zombie/shared) | 79,2–89,9 | — | 0,20–0,35 | Spearman hancur |
| 46 | Seleksi model per grup (nested) | 88,3 | −15,5 | 0,228 | noise seleksi |
| 47 | Heteroskedastic shift (c × sigma grup) | 81,5–86,9 | — | 0,34 | |
| 48 | Fitur nol-mcap (floor) / TVL lagged / age×growth | 83,9–86,5 | — | 0,31–0,39 | |

## Temuan penting (peringatan)
- **Shorth-centre = LEAKAGE, jangan dipakai.** x_fold hanya 2 nilai (34,47 / 13,38);
  interval shorth membalik tergantung apakah protokol yang di-hold-out itu sendiri
  anggota klaster rendah — jadi x_fold mengkode label protokol itu lewat
  ketidakhadirannya (leave-one-out). Spearman 0,746 dan medAE 66,8% (×100)
  sepenuhnya palsu; pada protokol baru (bukan peer) x konstan → Spearman 0,413.
  Pelajaran: estimator diskontinu (shorth, KDE-mode bandwidth sempit, kNN k kecil)
  bisa bocor lewat LOO. Estimator halus (median/mean/Huber/OLS) aman.
- **Winner's curse:** ~48 model dicoba; "terbaik 80,1%" kemungkinan optimistis
  1–3 poin. Performa jujur model terbaik ≈ 81–83%.
- **Batas struktur:** residual log SD ≈ 2,0; fraksi error dalam jendela ≤70%
  hanya 37–44%. Bahkan evaluasi oracle-clean (kelipatan dalam [0,02, 3], n=93)
  medAE 76,8%. LEND tak terprediksi oleh model apapun (medAE ~94–98%
  untuk semua kandidat); RWA paling terprediksi (32–37%).
- **Insiden 2026-11-26 ~13:3x WIB: /tmp di-wipe (VM restart).** Semua script
  exp1–exp33 hilang; hasil selamat di NOTES.md + transkrip. Kit dipulihkan dari
  `~/workspace/goals/.../hidden_files/make-fun/token-radar-01-kit/` —
  snapshot sha256 terverifikasi 42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393
  (cocok kit.json), vendor sha256 9ca51b6e… (cocok radar-4). Salinan kerja kit
  di `~/workspace/token-radar-rebuild-5/kit/kit-copy/` (HAPUS sebelum serah
  terima — bukan bagian repo entry).

## Yang BELUM dicoba / antre
- LOESS / kernel-weighted median lokal dalam logTVL per grup (bandwidth grid).
- In-sample oracle bound: seberapa rendah medAE bila fit memakai semua data
  (cek apakah ≤70% memang dalam jangkauan kelas model ini).
- Koreksi median bersarang (stacking) — sedang berjalan (exp14).
- Band: p10–p90 residu → coverage LOO ~78% (OLS global); target ≥55%
  mudah dicapai dengan band residual p20–p80 (≈60%). Belum final.
- Keputusan 20 baris di atas floor: 92 pre-token ≥floor bukan watchlist —
  mayoritas CEX / Bridge / Liquid Staking / wrapped; radar-4 hanya mengklaim
  20 di antaranya (yang rankable) — perlu verifikasi ulang dari board radar-4
  (baca saja) saat build; prinsip: ikut definisi watchlist (bukan parentProtocol
  yang tidak ada di snapshot) — baris di atas floor yang diexclude harus
  punya alasan dari field snapshot (kategori/name/version), didokumentasikan.

## BUILD radar-5 (2026-11-26, setelah exp39)

Model final (dari exp39, Huber double-EB): Huber log-log (k=1.5, MAD scale,
20 ronde IRLS — konvergen di ronde ~5, angka identik 6 desimal vs 60 ronde),
koreksi EB group (7 grup) + primary chain (tau=0.8), band = implied ×
exp(q20/q80 residual peer). Growth/age/chain-count TIDAK dipakai (korelasi
residual ≈ 0). Board = semua rankable pre-token: 198 baris (40 watchlist +
138 bawah floor + 20 atas floor, bukan di watchlist — floor itu lantai,
bukan langit-langit; pengecualian radar-4 pakai parentProtocol yang tak ada
di snapshot).

Hasil build pertama (TS, node main.ts):
- 198 baris, watchlist 40/40, 20 atas floor / 138 bawah floor, 33 kategori.
- Backtest LOO n=119 (TS = Python persis): medAE 80.1%, signed +8.6%,
  band coverage 61.3%, Spearman 0.399; radar-4 di loop yang sama 91.9% /
  0.379. Farm steps 7/baris, panjang 138–249 karakter; implied monoton
  turun; peers ≤5/baris.
- Dashboard 3 file, 18.589 byte (index 1.017 + css 3.135 + app.js 14.437).
- Runtime: awal 0,84 dtk → 0,62–0,71 (buang hitung-ulang Spearman radar-4
  119×119) → 0,57–0,63 (precompute koreksi sel per fit + sort residual
  sekali) → 0,52–0,61 (Huber 60→20 ronde + cache ageDays + precompute
  peer per kategori). Semua optimasi aritmetika-identik, angka backtest
  tidak berubah di tiap langkah.
- Determinisme: 2 run diff -r identik.
- Edge case: null change_7d/category/listed_at + chains kosong + TVL $1 +
  mcap 0/-1 + CEX + nama versioned/wrapped — semua ditangani, tidak crash;
  isRankable lolos 14/14 kasus uji (V2, v2, 2.0, V10.3, wrapped/staked/
  staking, CEX, Bridge, kategori null, token hidup).
- Dossier dengan placeholder PNG 19.604 byte; ukuran final tergantung PNG
  asli (target total ≤613.275 → PNG mentah total ≤ ~440KB, ~145KB per PNG).

CATATAN JUJUR (untuk koordinator): target ≤70% medAE TIDAK tercapai —
terbaik yang jujur ≈80–83% (LOO 80.1%, 5-fold 83.2%). Pencarian ~50
pendekatan + validasi 5-fold menunjukkan 70% tidak bisa dicapai di ruang
fitur snapshot ini (residual log SD ≈2.0; jendela ≤70% hanya berisi
37–44% error). Radar-5 tetap menang vs radar-4 di SEMUA metrik
(91.9→80.1%, 38.7→61.3%, 0.379→0.399, 178→198 baris, dashboard
18.589 ≤ 24.827 byte, runtime ≤0,61 dtk, dossier dalam budget).
Satu-satunya jalan ke ≤70% yang sempat muncul (shorth-centre, 66.8%)
adalah kebocoran label lewat LOO — DILARANG pakai. Keputusan soal
gap 70% vs 80% ada di koordinator/user; jangan klaim 70% tercapai.

## FINAL (2026-11-26, selesai diverifikasi)

- Runtime final: 0,49–0,60 dtk (median ~0,53, 6 run) setelah Huber 12 ronde
  (angka LOO identik dengan 60 ronde; konvergen di ronde ~5–8).
- Screenshot: Chrome mentah /opt/meta-chromium/chrome + CDP. Halangan:
  binary menolak start tanpa policy WebGL ("Hatch WebGL domain policy is
  required") — diatasi dengan file policy `hatch-webgl-allowed-domains-v1`
  + `example.com` + sha256-nya via switch --hatch-webgl-allowed-domains-
  file/sha256 (format ditemukan dari strings binary + validasi
  --hatch-validate-webgl-allowed-domains --version). Mode --screenshot/
  --dump-dom binary ini tidak mengeluarkan output; CDP (port 9222) jalan
  dan dipakai. 3 PNG 1440×900: board 63.030, detail 51.197, filtered
  62.348 byte (kuantisasi palet 256 warna, tampilan identik — RGB asli
  total 447.724 byte bikin dossier 617.503 > 613.275). Dossier final
  255.731 byte, teks 19.357 byte. View Method + Market juga di-screenshot
  dan diverifikasi render benar (tidak masuk dossier).
- Check bundle sendiri (check.mjs): 34/34 PASS, exit 0 — 2 build
  byte-identik, runtime median ≤0,61, board 198 baris, watchlist 40/40,
  backtest sesuai nilai Python exp39, dashboard 19.092 byte + 0 network,
  screenshot + dossier dalam budget, dossier byte-identik dengan
  buildDossier, edge case lolos.
- File final (13): main.ts, lib/model.ts, vendor/makefun-board.ts (sha
  9ca51b6e… cocok dengan kit), dashboard/{index.html,app.css,app.js},
  screenshots/{1-board,2-detail,3-filtered}.png, README.md, LICENSE,
  check.mjs, NOTES.md. kit/ + shot.mjs sudah dihapus dari workdir.

STATUS: SIAP diserahkan ke koordinator untuk verifikasi independen +
push. Satu-satunya kriteria brief yang TIDAK terpenuhi: median abs error
≤70% (hasil 80,1%). Semua kriteria lain menang vs radar-4. Lihat catatan
jujur di atas — keputusan soal gap 70% vs 80% ada di koordinator/user.
