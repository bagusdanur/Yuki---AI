// Penyimpanan sesi game per user. State disimpan di DB supaya permainan bisa
// dilanjutkan walau chat ditutup, dan supaya model bahasa tidak perlu mengingat
// papan (sumber utama kecurangan/lupa giliran).

import { dbHandle as db } from '../memory.js'

export const GAME_TTT = 'tic-tac-toe'
export const GAME_RPS = 'batu-kertas-gunting'
const GAME = GAME_TTT

const baris = (userId, game = GAME) =>
  db.prepare('SELECT user_id, game, state, result, wins, losses, draws, updated_at FROM game_sessions WHERE user_id = ? AND game = ?')
    .get(String(userId), game)

export function loadSession(userId, game = GAME) {
  const row = baris(userId, game)
  if (!row) return null
  let state = null
  try { state = JSON.parse(row.state) } catch { state = null }
  return {
    state,
    result: row.result || null,
    stats: { wins: row.wins, losses: row.losses, draws: row.draws },
    updatedAt: row.updated_at
  }
}

export function saveSession(userId, state, result = null, game = GAME) {
  const u = String(userId)
  const ada = baris(u, game)
  const stats = ada
    ? { wins: ada.wins, losses: ada.losses, draws: ada.draws }
    : { wins: 0, losses: 0, draws: 0 }

  // Hasil hanya dihitung sekali per sesi: kalau result sebelumnya sudah sama,
  // jangan tambah skor lagi (mencegah dobel saat endpoint dipanggil ulang).
  const sudahDihitung = ada && ada.result && result && ada.result === result && ada.state === JSON.stringify(state)
  if (result && !sudahDihitung) {
    if (result === 'user_win') stats.wins += 1
    else if (result === 'yuki_win') stats.losses += 1
    else if (result === 'draw') stats.draws += 1
  }

  db.prepare(`INSERT INTO game_sessions (user_id, game, state, result, wins, losses, draws, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
              ON CONFLICT(user_id, game) DO UPDATE SET
                state = excluded.state,
                result = excluded.result,
                wins = excluded.wins,
                losses = excluded.losses,
                draws = excluded.draws,
                updated_at = excluded.updated_at`)
    .run(u, game, JSON.stringify(state), result, stats.wins, stats.losses, stats.draws)

  return stats
}

export function clearSession(userId) {
  db.prepare('DELETE FROM game_sessions WHERE user_id = ? AND game = ?').run(String(userId), GAME)
}

const hariWIB = (d) => new Date(d.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)

/**
 * Ringkasan hasil main TERAKHIR untuk dibaca Yuki saat ngobrol biasa.
 * Sengaja hanya membaca tabel game_sessions — tidak menulis apa pun, jadi
 * memori profil/fakta user tidak pernah tertimpa oleh hasil permainan.
 */
export function gameMemoryText(userId) {
  const rows = db
    .prepare('SELECT game, result, wins, losses, draws, updated_at FROM game_sessions WHERE user_id = ?')
    .all(String(userId))
  if (!rows.length) return ''

  const NAMA = { [GAME_TTT]: 'Tic-tac-toe', [GAME_RPS]: 'Batu-kertas-gunting' }
  const bagian = []

  for (const row of rows) {
    const { wins = 0, losses = 0, draws = 0 } = row
    if (!row.result && !wins && !losses && !draws) continue

    let kapan = ''
    if (row.updated_at) {
      const lalu = hariWIB(new Date(row.updated_at.replace(' ', 'T') + 'Z'))
      const kini = hariWIB(new Date())
      const selisih = Math.round((new Date(kini) - new Date(lalu)) / 86400000)
      kapan = selisih <= 0 ? ' hari ini' : selisih === 1 ? ' kemarin' : ` ${selisih} hari lalu`
    }

    const hasil = row.result === 'user_win' ? 'dia menang'
      : row.result === 'yuki_win' ? 'kamu yang menang'
      : row.result === 'draw' ? 'seri'
      : 'sedang berjalan'

    const nama = NAMA[row.game] || row.game
    bagian.push(`${nama} terakhir${kapan}: ${hasil} (rekor: dia ${wins}, kamu ${losses}, seri ${draws}).`)
  }

  return bagian.join(' ')
}

export function getStats(userId) {
  const ada = baris(userId)
  return ada ? { wins: ada.wins, losses: ada.losses, draws: ada.draws } : { wins: 0, losses: 0, draws: 0 }
}
