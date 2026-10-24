// Aturan batu-kertas-gunting murni (tanpa DB/model). Penilaian menang selalu
// dihitung di sini supaya hasil tidak bisa salah walau model memilih aneh.

export const PILIHAN = ['batu', 'kertas', 'gunting']
export const LABEL = { batu: 'Batu', kertas: 'Kertas', gunting: 'Gunting' }

// Peta "apa yang dikalahkan" — dipakai untuk menilai tanpa urutan indeks.
const KALAHKAN = { batu: 'gunting', gunting: 'kertas', kertas: 'batu' }

export function pilihanValid(x) {
  return PILIHAN.includes(String(x || '').toLowerCase())
}

export function normalisasi(x) {
  const s = String(x || '').toLowerCase().trim()
  if (s.includes('batu') || s === 'rock' || s === 'r') return 'batu'
  if (s.includes('kertas') || s === 'paper' || s === 'p') return 'kertas'
  if (s.includes('gunting') || s === 'scissors' || s === 's') return 'gunting'
  return ''
}

/** 'user_win' | 'yuki_win' | 'draw' */
export function hasilRonde(pemain, yuki) {
  const a = normalisasi(pemain)
  const b = normalisasi(yuki)
  if (!a || !b) return ''
  if (a === b) return 'draw'
  return KALAHKAN[a] === b ? 'user_win' : 'yuki_win'
}

export function acak() {
  return PILIHAN[Math.floor(Math.random() * PILIHAN.length)]
}

export function stateBaru() {
  return { score: { you: 0, yuki: 0 }, round: 0, history: [] }
}

/** Tambah satu ronde; riwayat dibatasi 5 supaya prompt tetap ringkas. */
export function catatRonde(state, pilihanPemain, pilihanYuki, hasil) {
  const s = state && state.score ? state : stateBaru()
  return {
    score: {
      you: s.score.you + (hasil === 'user_win' ? 1 : 0),
      yuki: s.score.yuki + (hasil === 'yuki_win' ? 1 : 0)
    },
    round: (s.round || 0) + 1,
    history: [...(s.history || []), { you: pilihanPemain, yuki: pilihanYuki, hasil }].slice(-5)
  }
}
