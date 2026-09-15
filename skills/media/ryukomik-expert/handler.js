// skills/media/ryukomik-expert/handler.js
import { searchComics, latestComics } from '../../../lib/ryukomik.js'

export async function executeSearchRyukomik({ query, filter_special = false, limit = 6, format = '' }) {
  if (!query || !query.trim()) {
    return { error: 'Query pencarian komik tidak boleh kosong.' }
  }

  try {
    const requestedFormat = String(format || (/\bmanhwa\b/i.test(query) ? 'MANHWA' : /\bmanhua\b/i.test(query) ? 'MANHUA' : /\bmanga\b/i.test(query) ? 'MANGA' : '')).toUpperCase()
    const count = Math.min(Math.max(Number(limit) || 6, 1), 10)
    const list = (await searchComics(query.trim(), { adult: Boolean(filter_special) }))
      .filter(comic => !requestedFormat || comic.format === requestedFormat)
    return {
      query: query.trim(),
      total: list.length,
      requestedLimit: count,
      comics: list.slice(0, count).map(c => ({
        title: c.title,
        url: c.url,
        format: c.format || 'KOMIK',
        type: c.type || '',
        chapter: c.chapter || '',
        updated: c.updated || '',
        score: c.score || '',
        image: c.image || ''
      }))
    }
  } catch (err) {
    return { error: `Gagal mencari komik di Ryukomik: ${err.message}` }
  }
}

export async function executeGetLatestComics({ limit = 6, genre = '' }) {
  try {
    const list = await latestComics({ genre })
    const count = Math.min(Math.max(Number(limit) || 6, 1), 10)
    return {
      total: list.length,
      comics: list.slice(0, count).map(c => ({
        title: c.title,
        url: c.url,
        format: c.format || 'KOMIK',
        type: c.type || '',
        chapter: c.chapter || '',
        updated: c.updated || '',
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
