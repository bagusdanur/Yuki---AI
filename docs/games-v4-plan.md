# Game v4 — Tic-Tac-Toe (persiapan, BELUM DIRILIS)

Status: **dikerjakan di branch `v4-games`, tidak di-merge ke `main`, tidak aktif di produksi.**
V3 tetap berjalan normal dan masih bisa naik ke 3.4 / 3.5.

## Prinsip desain

**Aturan & langkah Yuki dihitung kode, bukan model bahasa.**
Model bahasa tidak dipakai sebagai mesin game karena tidak reliable untuk menghitung
papan (bisa lupa giliran, salah menilai pemenang, atau "curang"). Yuki tetap terasa
hidup lewat komentar/persona, bukan lewat perhitungan.

- Papan 3×3, pemain (`X`) selalu mulai, Yuki (`O`).
- Langkah Yuki memakai **minimax**, dengan peluang "lengah" mengikuti bond.
- State disimpan di DB supaya permainan bisa dilanjutkan meski chat ditutup.

## Tingkat kesulitan ikut kedekatan

| Bond | Peluang lengah | Perilaku |
|---|---|---|
| < 24 (orang asing) | 0% | main sempurna, sombong |
| 24–49 | 15% | sesekali meleset |
| 50–77 (luluh) | 35% | mulai tidak tega |
| ≥ 78 (kekasih) | 55% | sering memberi jalan |

Saat lengah, Yuki memilih langkah terbaik ke-2/ke-3 — bukan langkah acak yang bodoh —
supaya terasa "diam-diam mengalah", bukan tiba-tiba idiot.

## Yang sudah ada (branch ini)

- `lib/games/tic-tac-toe.js` — mesin murni: `createBoard`, `applyMove`, `findWinner`,
  `rankMoves`, `chooseYukiMove`, `slipChance`, `renderBoard`. Tanpa DB & tanpa model.
- `lib/games/store.js` — simpan/muat sesi + rekor (menang/kalah/seri) di tabel
  `game_sessions` (ditambahkan ke skema `lib/memory.js`).
- `scripts/test-games-ttt.mjs` — 16 uji (termasuk 300 simulasi memastikan Yuki tidak
  pernah kalah di bond 0, blokir ancaman, deteksi seri, dan uji penyimpanan).
- Endpoint (hanya aktif bila `GAMES_ENABLED=true`):
  - `GET  /api/game/ttt` — state + rekor
  - `POST /api/game/ttt/new`
  - `POST /api/game/ttt/move` `{ cell: 0..8 }`
  - `POST /api/game/ttt/reset` — papan baru, **rekor tetap disimpan**

## Kenapa aman meski kode ini ada di repo

- Route **tidak dipasang sama sekali** kalau `GAMES_ENABLED` bukan `'true'` →
  di produksi semuanya 404 (sudah diverifikasi).
- Belum ada tombol/menu yang menautkannya di UI.
- Modul game tidak disajikan sebagai file statis (bukan di `public/`).

## Langkah berikutnya (belum dikerjakan)

1. Kartu papan 3×3 di chat (React) — tap kotak, bukan mengetik.
2. Komentar Yuki per langkah/hasil (template + sesekali satu panggilan model saat
   selesai; **jangan** per langkah supaya hemat kuota).
3. Efek ke bond kecil saat menang/kalah + rekor tersimpan di profil.
4. Game kedua: **"Seberapa Kenal Kamu Sama Aku?"** (kuis dari memori nyata).
5. Tombol/menu resmi + entri changelog + docs saat v4 benar-benar dirilis.

## Cara mencoba lokal

```bash
PORT=3099 MEMORY_DB=/tmp/game.db GAMES_ENABLED=true node server.js
node scripts/test-games-ttt.mjs
```

Jangan menyalakan `GAMES_ENABLED` di PM2 produksi sebelum v4 dirilis.
