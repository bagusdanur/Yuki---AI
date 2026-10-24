// Uji mesin Tic-Tac-Toe tanpa server, DB produksi, atau model.
// Jalankan: MEMORY_DB=/tmp/ttt-test.db node scripts/test-games-ttt.mjs

import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import {
  createBoard, applyMove, findWinner, legalMoves, chooseYukiMove, rankMoves,
  slipChance, renderBoard, MARK_USER, MARK_YUKI
} from '../lib/games/tic-tac-toe.js'

let lulus = 0
const cek = (nama, fn) => {
  try { fn(); console.log('PASS  ' + nama); lulus++ }
  catch (e) { console.log('FAIL  ' + nama + ' -> ' + e.message); process.exitCode = 1 }
}

cek('papan awal kosong & giliran pemain', () => {
  const s = createBoard()
  assert.equal(s.board.length, 9)
  assert.ok(s.board.every((x) => x === ''))
  assert.equal(s.turn, MARK_USER)
  assert.equal(s.status, 'playing')
})

cek('menolak langkah di luar giliran', () => {
  const s = createBoard()
  const { error } = applyMove(s, 0, MARK_YUKI)
  assert.ok(error)
})

cek('menolak kotak terisi', () => {
  let s = createBoard()
  s = applyMove(s, 4, MARK_USER).state
  const { error } = applyMove(s, 4, MARK_YUKI)
  assert.ok(error)
})

cek('menolak kotak tidak valid', () => {
  const s = createBoard()
  assert.ok(applyMove(s, 9, MARK_USER).error)
  assert.ok(applyMove(s, -1, MARK_USER).error)
  assert.ok(applyMove(s, 'x', MARK_USER).error)
})

cek('mendeteksi kemenangan baris', () => {
  const b = ['X', 'X', 'X', '', '', '', '', '', '']
  const w = findWinner(b)
  assert.equal(w.mark, 'X')
  assert.deepEqual(w.line, [0, 1, 2])
})

cek('mendeteksi kemenangan kolom & diagonal', () => {
  assert.equal(findWinner(['O', '', '', 'O', '', '', 'O', '', '']).mark, 'O')
  assert.equal(findWinner(['X', '', '', '', 'X', '', '', '', 'X']).mark, 'X')
})

cek('mendeteksi seri saat papan penuh tanpa pemenang', () => {
  // X O X / X O O / O X X  -> seri
  // 8 kotak terisi tanpa pemenang; kotak terakhir (index 8) masih kosong.
  let s = { board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', ''], turn: MARK_USER, status: 'playing', winnerLine: null, moves: 8 }
  const out = applyMove(s, 8, MARK_USER).state
  assert.equal(out.status, 'draw')
})

cek('pemain menang terdeteksi lewat applyMove', () => {
  let s = createBoard()
  s = applyMove(s, 0, MARK_USER).state   // X
  s = applyMove(s, 3, MARK_YUKI).state   // O
  s = applyMove(s, 1, MARK_USER).state   // X
  s = applyMove(s, 4, MARK_YUKI).state   // O
  s = applyMove(s, 2, MARK_USER).state   // X menang
  assert.equal(s.status, 'user_win')
  assert.deepEqual(s.winnerLine, [0, 1, 2])
})

cek('Yuki menang terdeteksi', () => {
  let s = createBoard()
  s = applyMove(s, 0, MARK_USER).state
  s = applyMove(s, 3, MARK_YUKI).state
  s = applyMove(s, 1, MARK_USER).state
  s = applyMove(s, 4, MARK_YUKI).state
  s = applyMove(s, 8, MARK_USER).state
  s = applyMove(s, 5, MARK_YUKI).state
  assert.equal(s.status, 'yuki_win')
})

cek('Yuki memblokir ancaman menang pemain', () => {
  // Pemain punya X di 0 dan 1 -> Yuki wajib mengisi 2
  const board = ['X', 'X', '', '', 'O', '', '', '', '']
  const cell = chooseYukiMove(board, 0, () => 0.99) // bond 0 = tanpa lengah
  assert.equal(cell, 2)
})

cek('Yuki memilih kemenangan bila tersedia', () => {
  // Yuki punya O di 3 dan 4 -> menang dengan 5
  const board = ['X', '', '', 'O', 'O', '', 'X', '', '']
  const cell = chooseYukiMove(board, 0, () => 0.99)
  assert.equal(cell, 5)
})

cek('bond 0 selalu main sempurna: 300 simulasi tanpa kalah', () => {
  let userWin = 0
  for (let g = 0; g < 300; g++) {
    let s = createBoard()
    while (s.status === 'playing') {
      if (s.turn === MARK_USER) {
        const opsi = legalMoves(s.board)
        const pilih = opsi[Math.floor(Math.random() * opsi.length)]
        s = applyMove(s, pilih, MARK_USER).state
        continue
      }
      const cell = chooseYukiMove(s.board, 0)
      s = applyMove(s, cell, MARK_YUKI).state
    }
    if (s.status === 'user_win') userWin++
  }
  assert.equal(userWin, 0, `Yuki kalah ${userWin} kali dari 300`)
})

cek('peluang lengah naik mengikuti bond', () => {
  assert.equal(slipChance(0), 0)
  assert.ok(slipChance(24) > 0)
  assert.ok(slipChance(50) > slipChance(24))
  assert.ok(slipChance(78) > slipChance(50))
})

cek('saat lengah, langkah tetap masuk akal (bukan kotak tolol)', () => {
  const board = ['X', 'X', '', '', 'O', '', '', '', '']
  const ranked = rankMoves(board)
  const terbaik = ranked[0].cell
  // paksa selalu lengah
  const cell = chooseYukiMove(board, 78, () => 0)
  assert.notEqual(cell, 2, 'langkah lengah seharusnya bukan blok langsung')
  assert.ok(legalMoves(board).includes(cell))
  assert.ok(terbaik === 2)
})

cek('render papan mudah dibaca', () => {
  const teks = renderBoard(['X', '', '', '', 'O', '', '', '', ''])
  assert.equal(teks, 'X . .\n. O .\n. . .')
})

// ── penyimpanan (DB sementara) ────────────────────────────────────────────────
const tmp = path.join(os.tmpdir(), `ttt-test-${Date.now()}.db`)
process.env.MEMORY_DB = tmp
const store = await import('../lib/games/store.js')

cek('simpan & muat sesi + skor', () => {
  const s = createBoard()
  store.saveSession('u_test', s, null)
  const load = store.loadSession('u_test')
  assert.equal(load.state.board.length, 9)
  assert.equal(load.stats.wins, 0)

  const selesai = { ...s, status: 'user_win' }
  store.saveSession('u_test', selesai, 'user_win')
  assert.equal(store.getStats('u_test').wins, 1)

  // simpan ulang state yang sama tidak boleh menambah skor dua kali
  store.saveSession('u_test', selesai, 'user_win')
  assert.equal(store.getStats('u_test').wins, 1)

  store.clearSession('u_test')
  assert.equal(store.loadSession('u_test'), null)
})

try { fs.unlinkSync(tmp) } catch { /* biarkan */ }
console.log(`\n${lulus} uji lulus.`)
