// skills/research/web-search/handler.js

const STOP_WORDS = new Set(['yang', 'dan', 'atau', 'untuk', 'dari', 'di', 'ke', 'the', 'a', 'an', 'of', 'terbaru', 'berita', 'update', 'cari', 'riset'])
const TOPICS = {
  anime: ['anime', 'animasi', 'episode', 'season'],
  game: ['game', 'gaming', 'mobile game', 'playstation', 'xbox', 'nintendo'],
  manga: ['manga', 'manhwa', 'manhua', 'komik', 'chapter'],
  finance: ['saham', 'crypto', 'pasar', 'harga', 'ekonomi']
}

function tokens(value = '') {
  return String(value).toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter(token => token.length > 2 && !STOP_WORDS.has(token))
}

export function scoreSearchRelevance(query, result = {}) {
  const queryTokens = [...new Set(tokens(query))]
  const haystack = `${result.title || ''} ${result.snippet || ''}`.toLowerCase()
  const overlap = queryTokens.filter(token => haystack.includes(token)).length
  let score = queryTokens.length ? overlap / queryTokens.length : 0
  const wantedTopics = Object.entries(TOPICS).filter(([, words]) => words.some(word => String(query).toLowerCase().includes(word))).map(([topic]) => topic)
  if (wantedTopics.length) {
    const matchesWanted = wantedTopics.some(topic => TOPICS[topic].some(word => haystack.includes(word)))
    if (!matchesWanted) score -= 0.55
    const conflicting = Object.keys(TOPICS).filter(topic => !wantedTopics.includes(topic) && TOPICS[topic].some(word => haystack.includes(word)))
    if (conflicting.length && !matchesWanted) score -= 0.25
  }
  return Math.max(0, Math.min(1, Number(score.toFixed(2))))
}

function publicationDate(text = '') {
  return String(text).match(/\b(20\d{2}-\d{2}-\d{2}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|Mei|Jun|Jul|Agu|Sep|Okt|Nov|Des)[a-z]*\s+20\d{2})\b/i)?.[1] || null
}

export async function executeWebSearch({ query, max_results = 4 }) {
  if (!query || !query.trim()) {
    return { error: 'Query pencarian tidak boleh kosong.' }
  }

  const cleanQuery = query.trim()
  const limit = Math.min(Math.max(Number(max_results) || 4, 1), 6)

  try {
    // 1. Coba DuckDuckGo HTML search
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(cleanQuery)}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      signal: controller.signal
    })
    clearTimeout(timeout)

    if (!response.ok) {
      throw new Error(`DuckDuckGo returned status ${response.status}`)
    }

    const html = await response.text()
    const results = []

    // Parse hasil pencarian HTML
    const resultBlocks = html.split(/class="result\s+results_links/i).slice(1)

    for (const block of resultBlocks) {
      if (results.length >= limit) break

      const titleMatch = block.match(/<a class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
                         block.match(/<a class="result__snippet[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i) ||
                         block.match(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      
      const snippetMatch = block.match(/<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i) ||
                           block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i)

      let link = titleMatch ? titleMatch[1] : ''
      let title = titleMatch ? titleMatch[2].replace(/<[^>]+>/g, '').trim() : ''
      let snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]+>/g, '').trim() : ''

      // Decode redirect link duckduckgo (//duckduckgo.com/l/?uddg=...)
      if (link.includes('uddg=')) {
        try {
          const rawParam = link.split('uddg=')[1]?.split('&')[0]
          if (rawParam) link = decodeURIComponent(rawParam)
        } catch {}
      }

      if (title && snippet) {
        results.push({
          title,
          snippet: snippet.slice(0, 300),
          url: link
        })
      }
    }

    if (results.length > 0) {
      const ranked = results.map(result => ({ ...result, publishedAt: publicationDate(`${result.title} ${result.snippet}`), relevance: scoreSearchRelevance(cleanQuery, result) }))
        .filter(result => result.relevance >= 0.25 && /^https?:\/\//i.test(result.url || ''))
        .sort((a, b) => b.relevance - a.relevance).slice(0, limit)
      return { query: cleanQuery, total: ranked.length, rejectedIrrelevant: results.length - ranked.length, results: ranked,
        relevanceStatus: ranked.length ? 'verified' : 'no_relevant_results' }
    }

    // Fallback: DuckDuckGo Instant Answer API
    const apiRes = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}&format=json&no_html=1&skip_disambig=1`)
    if (apiRes.ok) {
      const data = await apiRes.json()
      const fallbackResults = []
      if (data.AbstractText) {
        fallbackResults.push({
          title: data.Heading || cleanQuery,
          snippet: data.AbstractText,
          url: data.AbstractURL || ''
        })
      }
      if (Array.isArray(data.RelatedTopics)) {
        for (const item of data.RelatedTopics.slice(0, limit)) {
          if (item.Text && item.FirstURL) {
            fallbackResults.push({
              title: item.Text.slice(0, 60),
              snippet: item.Text,
              url: item.FirstURL
            })
          }
        }
      }
      if (fallbackResults.length > 0) {
        const ranked = fallbackResults.map(result => ({ ...result, publishedAt: publicationDate(`${result.title} ${result.snippet}`), relevance: scoreSearchRelevance(cleanQuery, result) }))
          .filter(result => result.relevance >= 0.25 && /^https?:\/\//i.test(result.url || '')).slice(0, limit)
        return { query: cleanQuery, total: ranked.length, rejectedIrrelevant: fallbackResults.length - ranked.length, results: ranked,
          relevanceStatus: ranked.length ? 'verified' : 'no_relevant_results' }
      }
    }

    return {
      query: cleanQuery,
      total: 0,
      results: [],
      message: `Tidak ditemukan hasil spesifik untuk "${cleanQuery}". Coba kata kunci yang lebih umum.`
    }
  } catch (err) {
    return {
      query: cleanQuery,
      error: `Gagal melakukan pencarian web: ${err.message}`
    }
  }
}

export default {
  web_search: executeWebSearch
}
