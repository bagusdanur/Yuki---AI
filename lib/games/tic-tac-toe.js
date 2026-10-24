// Mesin Tic-Tac-Toe murni (tanpa DB, tanpa model, tanpa efek samping).
// Aturan & langkah Yuki dihitung di sini supaya tidak mungkin "curang" atau
// lupa giliran seperti kalau diserahkan ke model bahasa.

export const MARK_USER = 'X'
export const MARK_YUKI = 'O'

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
]

const emptyBoard = () => Array(9).fill('')

export function createBoard() {
  return {
    board: emptyBoard(),
    turn: MARK_USER,       // pemain selalu mulai
    status: 'playing',     // playing | user_win | yuki_win | draw
    winnerLine: null,
    moves: 0
  }
}

export function legalMoves(board = []) {
  const out = []
  for (let i = 0; i < 9; i++) if (!board[i]) out.push(i)
  return out
}

export function findWinner(board = []) {
  for (const line of LINES) {
    const [a, b, c] = line
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { mark: board[a], line }
    }
  }
  return null
}

function evaluate(board) {
  const win = findWinner(board)
  if (!win) return 0
  return win.mark === MARK_YUKI ? 1 : -1
}

// Minimax klasik. Papan hanya 9 kotak, jadi tanpa memo pun cepat.
// `depth` dipakai agar kemenangan tercepat / kekalahan terlama dipilih.
function minimax(board, isYuki, depth = 0) {
  const win = findWinner(board)
  if (win) return win.mark === MARK_YUKI ? 10 - depth : depth - 10
  if (legalMoves(board).length === 0) return 0

  const moves = legalMoves(board)
  let best = isYuki ? -Infinity : Infinity
  for (const cell of moves) {
    board[cell] = isYuki ? MARK_YUKI : MARK_USER
    const nilai = minimax(board, !isYuki, depth + 1)
    board[cell] = ''
    best = isYuki ? Math.max(best, nilai) : Math.min(best, nilai)
  }
  return best
}

/** Skor setiap langkah yang mungkin, diurutkan dari terbaik untuk Yuki. */
export function rankMoves(board = []) {
  const hasil = []
  for (const cell of legalMoves(board)) {
    const uji = board.slice()
    uji[cell] = MARK_YUKI
    hasil.push({ cell, score: minimax(uji, false, 1) })
  }
  return hasil.sort((a, b) => b.score - a.score)
}

/**
 * Peluang Yuki bermain "tidak sempurna", mengikuti kedekatan.
 * Makin dekat, makin sering dia lengah / sengaja memberi jalan — bukan karena
 * bodoh, tapi karena tidak tega mengalahkan orang yang disayang.
 */
export function slipChance(bondValue = 0) {
  if (bondValue >= 78) return 0.55   // kekasih: sering lengah, suka memberi jalan
  if (bondValue >= 50) return 0.35   // luluh
  if (bondValue >= 24) return 0.15   // diam-diam peduli
  return 0                            // orang asing: main sempurna, sombong
}

/**
 * Pilih langkah Yuki. `randomFn` bisa diganti saat menguji agar deterministik.
 * Catatan: saat lengah, Yuki memilih dari langkah terbaik ke-2/ke-3 — bukan
 * langkah acak yang jelas tolol, supaya tetap terasa "diam-diam mengalah".
 */
export function chooseYukiMove(board = [], bondValue = 0, randomFn = Math.random) {
  const ranked = rankMoves(board)
  if (!ranked.length) return null

  const peluangLengah = slipChance(bondValue)
  if (peluangLengah > 0 && randomFn() < peluangLengah) {
    // ambil dari 2-3 besar; kalau hanya ada 1 langkah ya tetap itu
    const pilihan = ranked.slice(1, 3)
    if (pilihan.length) return pilihan[Math.floor(randomFn() * pilihan.length)].cell
  }
  return ranked[0].cell
}

/** Terapkan langkah; mengembalikan state baru (tidak mengubah input). */
export function applyMove(state, cell, mark) {
  if (!state || state.status !== 'playing') return { state, error: 'Permainan sudah selesai.' }
  if (state.turn !== mark) return { state, error: 'Bukan giliran itu.' }
  if (!Number.isInteger(cell) || cell < 0 || cell > 8) return { state, error: 'Kotak tidak valid.' }
  if (state.board[cell]) return { state, error: 'Kotak itu sudah terisi.' }

  const board = state.board.slice()
  board[cell] = mark
  const win = findWinner(board)
  let status = 'playing'
  if (win) status = win.mark === MARK_USER ? 'user_win' : 'yuki_win'
  else if (legalMoves(board).length === 0) status = 'draw'

  return {
    state: {
      board,
      turn: mark === MARK_USER ? MARK_YUKI : MARK_USER,
      status,
      winnerLine: win ? win.line : null,
      moves: (state.moves || 0) + 1
    }
  }
}

/** Papan jadi teks 3 baris untuk ditampilkan/diuji. */
export function renderBoard(board = []) {
  const isi = (i) => board[i] || '.'
  return [
    `${isi(0)} ${isi(1)} ${isi(2)}`,
    `${isi(3)} ${isi(4)} ${isi(5)}`,
    `${isi(6)} ${isi(7)} ${isi(8)}`
  ].join('\n')
}
