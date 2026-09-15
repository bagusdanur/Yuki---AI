// lib/ryukomik.js — ambil komik REAL langsung dari API Ryukomik (Komatoon).
// API: https://api.ryukomik.web.id  (sumber: komiku.org & doujindesu.tv) — tanpa scrape.
import 'dotenv/config'

const API = (process.env.RYUKOMIK_API || 'https://api.ryukomik.web.id').replace(/\/$/, '')
const MAX = Number(process.env.RYUKOMIK_MAX_RESULTS || 6)
const UA = 'Mozilla/5.0 (compatible; YukiBot/1.0)'
// Mode dewasa (R18) DEFAULT MATI. Aktifkan via .env RYUKOMIK_ADULT=true atau per-permintaan dari client.
const ADULT = String(process.env.RYUKOMIK_ADULT || 'false').toLowerCase() === 'true'

// Panggil API & balikin JSON
async function apiGet(path) {
  const res = await fetch(`${API}${path}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
  if (!res.ok) throw new Error(`ryukomik api ${res.status}`)
  return res.json()
}

// cache singkat biar nggak spam request (60 detik)
const cache = new Map()
const TTL = 60_000
function getCache(k) {
  const v = cache.get(k)
  return v && Date.now() - v.t < TTL ? v.d : null
}
function setCache(k, d) { cache.set(k, { t: Date.now(), d }) }

// Ubah link sumber (komiku.org / doujindesu.tv) -> link web Ryukomik biar promosiin situs sendiri
// komiku.org/manga/<slug>     -> ryukomik.my.id/komik/komiku/<slug>
// doujindesu.tv/manga/<slug>  -> ryukomik.my.id/komik/doujindesu/<slug>
const RYUKOMIK_SITE = 'https://ryukomik.my.id'
function ryukomikUrl(sumber, slug) { return `${RYUKOMIK_SITE}/komik/${sumber}/${slug}` }
function toLocalUrl(url = '') {
  const u = String(url || '')
  let m = u.match(/komiku\.org\/manga\/([^/?#]+)/i)
  if (m) return ryukomikUrl('komiku', m[1])
  m = u.match(/doujindesu\.[a-z]+\/manga\/([^/?#]+)/i)
  if (m) return ryukomikUrl('doujindesu', m[1])
  return u
}

// Format detector: Manhwa / Manga / Manhua / Komik
export function detectFormat(item = {}) {
  const explicit = String(item.format || item.comic_type || item.country || item.origin || '').trim().toLowerCase()
  const aliases = { manhwa: 'MANHWA', korea: 'MANHWA', korean: 'MANHWA', manhua: 'MANHUA', china: 'MANHUA', chinese: 'MANHUA', manga: 'MANGA', japan: 'MANGA', japanese: 'MANGA' }
  for (const [needle, normalized] of Object.entries(aliases)) if (explicit.includes(needle)) return normalized
  const haystack = `${item.type || ''} ${item.type_genre || ''} ${item.genre || ''} ${item.link || ''}`.toLowerCase()
  if (/\bmanhwa\b|\bkorea(?:n)?\b/.test(haystack)) return 'MANHWA'
  if (/\bmanhua\b|\bchin(?:a|ese)\b/.test(haystack)) return 'MANHUA'
  if (/\bmanga\b|\bjapan(?:ese)?\b/.test(haystack)) return 'MANGA'
  return 'KOMIK'
}

// Samakan bentuk hasil dari sumber komiku & doujindesu -> {title, url, type, chapter, score, format, image}
function normalize(x = {}) {
  const format = detectFormat(x)
  let rawScore = String(x.score || '').replace(/[^\d.]/g, '').trim()
  if (rawScore && !isNaN(Number(rawScore))) {
    rawScore = Number(rawScore).toFixed(1)
  }

  return {
    title: String(x.title || '').trim(),
    url: toLocalUrl(x.link || x.detail_link || ''),
    type: String(x.genre || x.type_genre || x.typeGenre || '').trim(),
    chapter: String(x.chapter_terbaru || x.chapterLast || '').replace(/^Terbaru:\s*/i, '').trim(),
    updated: String(x.waktu || x.updated || x.update || '').replace(/^Update\s*/i, '').replace(/\.$/, '').trim(),
    score: rawScore,
    format,
    image: x.image || ''
  }
}
function mapList(data = [], limit = MAX) {
  return data.map(normalize).filter((x) => x.title && x.url).slice(0, limit)
}

const GENRES = [
  ['action', ['action', 'aksi']], ['adventure', ['adventure', 'petualangan']],
  ['boys-love', ["boys love", "boy's love", 'bl', 'shounen ai']],
  ['comedy', ['comedy', 'komedi']], ['crime', ['crime', 'kriminal']],
  ['drama', ['drama']], ['ecchi', ['ecchi']], ['fantasy', ['fantasy', 'fantasi']],
  ['girls-love', ["girls love", "girl's love", 'gl', 'shoujo ai']],
  ['harem', ['harem']], ['historical', ['historical', 'sejarah']],
  ['horror', ['horror', 'horor']], ['isekai', ['isekai']], ['josei', ['josei']],
  ['martial-arts', ['martial arts', 'bela diri']], ['mecha', ['mecha']],
  ['medical', ['medical', 'medis']], ['music', ['music', 'musik']],
  ['mystery', ['mystery', 'misteri']], ['psychological', ['psychological', 'psikologi']],
  ['romance', ['romance', 'romantic', 'romantis']], ['school-life', ['school life', 'sekolah']],
  ['sci-fi', ['sci fi', 'sci-fi', 'science fiction', 'fiksi ilmiah']],
  ['seinen', ['seinen']], ['shoujo', ['shoujo']], ['shounen', ['shounen']],
  ['slice-of-life', ['slice of life', 'kehidupan sehari hari']], ['sports', ['sports', 'olahraga']],
  ['supernatural', ['supernatural', 'supranatural']], ['thriller', ['thriller']],
  ['tragedy', ['tragedy', 'tragedi']], ['wuxia', ['wuxia']], ['yuri', ['yuri']]
]

function cleanWords(value = '') {
  return String(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export function detectRequestedGenre(text = '') {
  const haystack = ` ${cleanWords(text)} `
  for (const [slug, aliases] of GENRES) {
    const alias = aliases.find(value => haystack.includes(` ${cleanWords(value)} `))
    if (alias) return { slug, aliases }
  }
  return null
}

function matchesGenre(comic, genre) {
  if (!genre) return true
  const metadata = ` ${cleanWords(comic?.type)} `
  return genre.aliases.some(alias => metadata.includes(` ${cleanWords(alias)} `))
}

async function genreComics(genre) {
  const key = `genre:${genre.slug}`
  const cached = getCache(key)
  if (cached) return cached
  try {
    const pages = await Promise.all([1, 2, 3].map(page => apiGet(`/genre/${genre.slug}?page=${page}`)))
    const seen = new Set()
    const list = mapList(pages.flatMap(page => page?.results || []), 60)
      .filter(item => matchesGenre(item, genre))
      .filter(item => !seen.has(item.url) && seen.add(item.url))
      .slice(0, MAX)
    setCache(key, list)
    return list
  } catch {
    return []
  }
}

// Cari komik berdasarkan judul/kata kunci.
// Default AMAN: saring dari katalog terbaru komiku.org. Kalau adult=true: endpoint /doujindesu/search (R18).
export async function searchComics(query = '', { adult = ADULT } = {}) {
  const q = String(query).trim()
  if (!q) return []
  const genre = !adult && detectRequestedGenre(q)
  if (genre) return genreComics(genre)
  const key = (adult ? 'qx:' : 'q:') + q.toLowerCase()
  const cached = getCache(key)
  if (cached) return cached
  let out = []
  try {
    if (adult) {
      const json = await apiGet(`/doujindesu/search?q=${encodeURIComponent(q)}`)
      out = mapList(json?.data || [])
    } else {
      // Mode aman: endpoint search RESMI komiku.org (umum, bukan R18)
      const json = await apiGet(`/komiku/search?q=${encodeURIComponent(q)}`)
      out = mapList(json?.data || [])
    }
  } catch {
    out = []
  }
  setCache(key, out)
  return out
}

// Komik terbaru (sumber "aman" komiku.org) buat "ada rekomendasi apa?"
export async function latestComics({ genre: genreInput = '' } = {}) {
  const genre = typeof genreInput === 'string' ? detectRequestedGenre(genreInput) : genreInput
  const cacheKey = genre ? `latest:${genre.slug}` : 'latest'
  const cached = getCache(cacheKey)
  if (cached) return cached
  let out = []
  try {
    const json = await apiGet('/komiku/terbaru')
    out = mapList(json?.data || [], 60).filter(item => matchesGenre(item, genre)).slice(0, MAX)
  } catch {
    out = []
  }
  setCache(cacheKey, out)
  return out
}

// Deteksi apakah user lagi minta rekomendasi/cari komik
export function wantsComic(text = '') {
  return /(rekomen|rekomendasi|saran komik|cariin|cari komik|baca apa|judul komik|baca komik|manga|manhwa|manhua|komik|webtoon|doujin)/i.test(text)
    || (/(minta|mau|pengen|carikan)/i.test(text) && Boolean(detectRequestedGenre(text)))
}

export function wantsLatestComics(text = '') {
  return /(terbaru|baru update|update terbaru|chapter baru|rilis terbaru|paling baru)/i.test(text)
}

// Ekstrak "kata kunci judul/genre" dari kalimat user
export function extractQuery(text = '') {
  return String(text)
    .replace(/(tolong|dong|kak|ya|please|cariin|carikan|cari|rekomendasikan|rekomendasi|rekomen|saran|yang|tentang|aku|mau|baca|judul|punya|ada|gak|nggak|apa|bagus|seru|terbaik|koleksi|list)/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Format hasil jadi konteks ringkas untuk system prompt (judul + link real)
export function buildComicContext(results, { query = '' } = {}) {
  if (!results?.length) {
    return `Catatan Ryukomik: tidak ada hasil cocok untuk "${query}". Sampaikan apa adanya dengan gayamu (JANGAN mengarang judul/link).`
  }
  const lines = results.map((r) => {
    const meta = [r.format ? `[${r.format}]` : '', r.type, r.chapter, r.updated ? `Update ${r.updated}` : '', r.score ? `★${r.score}` : ''].filter(Boolean).join(' · ')
    const coverQuery = r.image ? `?img=${encodeURIComponent(r.image)}` : ''
    return `**${r.title}**\n${meta}\n[Link](${r.url}${coverQuery})`
  }).join('\n\n')
  return `DATA NYATA dari Ryukomik (judul + link asli). Rekomendasikan HANYA dari daftar ini, JANGAN mengarang judul/link lain dan JANGAN mengganti genre. Jika query adalah genre, semua data sudah difilter ketat untuk genre itu. Balas RAPI & TERSTRUKTUR, JANGAN jadi satu paragraf panjang: beri 1 kalimat pembuka singkat bergaya tsundere, lalu tampilkan SETIAP judul di blok TERPISAH dengan susunan bertingkat — baris 1 judul **tebal**, baris 2 info format, chapter, genre & waktu update, baris 3 alias [Link](URL) (cukup teks \"Link\", BUKAN URL panjang). Pisahkan tiap judul dengan satu baris kosong. Contoh:\n\n**A Dragonslayer's Peerless Regression**\n[MANHWA] · Aksi, Fantasi · Chapter 89 · Update 20 menit lalu · ★8.5\n[Link](https://ryukomik.my.id/komik/komiku/a-dragonslayers-peerless-regression)\n\nData (pakai judul & link PERSIS dari daftar ini):\n${lines}`
}
