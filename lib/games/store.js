// Penyimpanan sesi game per user. State disimpan di DB supaya permainan bisa
// dilanjutkan walau chat ditutup, dan supaya model bahasa tidak perlu mengingat
// papan (sumber utama kecurangan/lupa giliran).

import { dbHandle as db } from '../memory.js'

const GAME = 'tic-tac-toe'

const baris = (userId) =>
  db.prepare('SELECT user_id, game, state, result, wins, losses, draws, updated_at FROM game_sessions WHERE user_id = ? AND game = ?')
    .get(String(userId), GAME)

export function loadSession(userId) {
  const row = baris(userId)
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

export function saveSession(userId, state, result = null) {
  const u = String(userId)
  const ada = baris(u)
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
    .run(u, GAME, JSON.stringify(state), result, stats.wins, stats.losses, stats.draws)

  return stats
}

export function clearSession(userId) {
  db.prepare('DELETE FROM game_sessions WHERE user_id = ? AND game = ?').run(String(userId), GAME)
}

export function getStats(userId) {
  const ada = baris(userId)
  return ada ? { wins: ada.wins, losses: ada.losses, draws: ada.draws } : { wins: 0, losses: 0, draws: 0 }
}
