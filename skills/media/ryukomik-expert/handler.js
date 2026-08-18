// skills/media/ryukomik-expert/handler.js
import { searchComics, latestComics } from '../../../lib/ryukomik.js'

export async function executeSearchRyukomik({ query, filter_special = false }) {
  if (!query || !query.trim()) {
    return { error: 'Query pencarian komik tidak boleh kosong.' }
  }

  try {
    const list = await searchComics(query.trim(), { adult: Boolean(filter_special) })
    return {
      query: query.trim(),
      total: list.length,
      comics: list.slice(0, 6).map(c => ({
        title: c.title,
        url: c.url,
        format: c.format || 'KOMIK',
        type: c.type || '',
        chapter: c.chapter || '',
        score: c.score || '',
        image: c.image || ''
      }))
    }
  } catch (err) {
    return { error: `Gagal mencari komik di Ryukomik: ${err.message}` }
  }
}

export async function executeGetLatestComics({ limit = 6 }) {
  try {
    const list = await latestComics()
    const count = Math.min(Math.max(Number(limit) || 6, 1), 10)
    return {
      total: list.length,
      comics: list.slice(0, count).map(c => ({
        title: c.title,
        url: c.url,
        format: c.format || 'KOMIK',
        type: c.type || '',
        chapter: c.chapter || '',
        score: c.score || '',
        image: c.image || ''
      }))
    }
  } catch (err) {
    return { error: `Gagal mengambil update komik: ${err.message}` }
  }
}

export default {
  search_ryukomik: executeSearchRyukomik,
  get_latest_comics: executeGetLatestComics
}
