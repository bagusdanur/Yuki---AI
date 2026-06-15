// lib/semantic.js — embedding LOKAL (gratis, tanpa API) untuk recall semantik.
let extractor = null
let loading = null

async function getExtractor() {
  if (extractor) return extractor
  if (!loading) {
    loading = (async () => {
      try {
        const { pipeline } = await import('@xenova/transformers')
        const model = process.env.EMBED_MODEL || 'Xenova/all-MiniLM-L6-v2'
        extractor = await pipeline('feature-extraction', model)
        return extractor
      } catch (e) {
        console.warn('[semantic] embedding nonaktif (model gagal di-load):', e.message)
        return null
      }
    })()
  }
  return loading
}

// Ubah teks -> vektor angka (mean-pooled & ternormalisasi). null kalau tak tersedia.
export async function embed(text = '') {
  const t = String(text).trim()
  if (!t) return null
  const ex = await getExtractor()
  if (!ex) return null
  try {
    const out = await ex(t, { pooling: 'mean', normalize: true })
    return Array.from(out.data)
  } catch {
    return null
  }
}

// Kemiripan kosinus (vektor sudah ternormalisasi -> cukup dot product)
export function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return -1
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

// Panaskan model di awal (opsional) biar balasan pertama tidak lambat
export async function warmupEmbedder() {
  await embed('halo')
}