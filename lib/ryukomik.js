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

// Samakan bentuk hasil dari sumber komiku & doujindesu -> {title, url, type, chapter, score}
function normalize(x = {}) {
  return {
    title: String(x.title || '').trim(),
    url: toLocalUrl(x.link || x.detail_link || ''),
    type: x.genre || x.type_genre || '',
    chapter: x.chapter_terbaru || x.update || '',
    score: x.score || '',
    image: x.image || ''
  }
}
function mapList(data = []) {
  return data.map(normalize).filter((x) => x.title && x.url).slice(0, MAX)
}

// Cari komik berdasarkan judul/kata kunci.
// Default AMAN: saring dari katalog terbaru komiku.org. Kalau adult=true: endpoint /doujindesu/search (R18).
export async function searchComics(query = '', { adult = ADULT } = {}) {
  const q = String(query).trim()
  if (!q) return []
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
export async function latestComics() {
  const cached = getCache('latest')
  if (cached) return cached
  let out = []
  try {
    const json = await apiGet('/komiku/terbaru')
    out = mapList(json?.data || [])
  } catch {
    out = []
  }
  setCache('latest', out)
  return out
}

// Deteksi apakah user lagi minta rekomendasi/cari komik
export function wantsComic(text = '') {
  return /(rekomen|rekomendasi|saran komik|cariin|cari komik|baca apa|judul|manga|manhwa|manhua|komik|webtoon|doujin)/i.test(text)
}

// Ekstrak "kata kunci judul" sederhana dari kalimat user
export function extractQuery(text = '') {
  return String(text)
    .replace(/(tolong|dong|kak|ya|please|cariin|carikan|cari|rekomendasikan|rekomendasi|rekomen|saran|komik|manga|manhwa|manhua|webtoon|doujin|yang|tentang|genre|aku|mau|baca|judul|punya|ada|gak|nggak|apa)/gi, ' ')
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
    const meta = [r.type, r.chapter, r.score ? `★${r.score}` : ''].filter(Boolean).join(' · ')
    const coverQuery = r.image ? `?img=${encodeURIComponent(r.image)}` : ''
    return `**${r.title}**${meta ? `\n${meta}` : ''}\n[Link](${r.url}${coverQuery})`
  }).join('\n\n')
  return `DATA NYATA dari Ryukomik (judul + link asli). Rekomendasikan HANYA dari daftar ini, JANGAN mengarang judul/link lain. Balas RAPI & TERSTRUKTUR, JANGAN jadi satu paragraf panjang: beri 1 kalimat pembuka singkat bergaya tsundere, lalu tampilkan SETIAP judul di blok TERPISAH dengan susunan bertingkat — baris 1 judul **tebal**, baris 2 info chapter & genre, baris 3 alias [Link](URL) (cukup teks \"Link\", BUKAN URL panjang). Pisahkan tiap judul dengan satu baris kosong. Contoh:\n\n**A Dragonslayer's Peerless Regression**\nChapter 89 · Aksi, Fantasi\n[Link](https://ryukomik.my.id/komik/komiku/a-dragonslayers-peerless-regression)\n\nData (pakai judul & link PERSIS dari daftar ini):\n${lines}`
}