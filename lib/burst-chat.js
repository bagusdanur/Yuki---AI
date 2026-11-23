// Pemecah balasan alami ("Multi-Bubble / Burst Chat") untuk mode companion.
// Memecah balasan tertentu menjadi maksimal 2 bubble pendek saat emosi ekspresif
// (malu, kesal, ceria, cemburu) agar terasa seperti chat WA/LINE sungguhan.

const BURST_MOODS = new Set(['malu', 'kesal', 'ceria', 'cemburu'])

export function splitNaturalBurst(reply = '', { mood = 'tenang', isSerious = false, hasComics = false, hasArtifacts = false } = {}) {
  const text = String(reply || '').trim()
  if (!text) return []
  if (isSerious || hasComics || hasArtifacts) return [text]
  if (text.includes('```') || text.includes('http://') || text.includes('https://')) return [text]
  if (text.length < 28 || text.length > 320) return [text]
  if (!BURST_MOODS.has(String(mood || '').toLowerCase())) return [text]

  // 1) Jika sudah ada 2 paragraf jelas dipisah baris kosong, jadikan 2 bubble.
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  if (paragraphs.length === 2 && paragraphs[0].length >= 6 && paragraphs[1].length >= 8) {
    return paragraphs
  }

  // 2) Cari batas kalimat alami (tanda baca akhir . ! ? … atau em-dash jeda malu)
  //    di luar gesture *...*
  const splitCandidates = []
  let inGesture = false
  for (let i = 0; i < text.length - 1; i++) {
    const ch = text[i]
    if (ch === '*') { inGesture = !inGesture; continue }
    if (inGesture) continue
    if (/[.!?…]/.test(ch) && /\s/.test(text[i + 1])) {
      // Lewati ellipsis yang masih berlanjut (mis. "...")
      if (ch === '.' && text[i + 1] === '.') continue
      const left = text.slice(0, i + 1).trim()
      const right = text.slice(i + 1).trim()
      if (left.length >= 8 && right.length >= 10) {
        splitCandidates.push({ left, right, balance: Math.abs(left.length - right.length) })
      }
    }
  }

  if (!splitCandidates.length) return [text]

  // Pilih titik potong yang paling seimbang (tidak terlalu pendek di salah satu sisi).
  splitCandidates.sort((a, b) => a.balance - b.balance)
  const best = splitCandidates[0]
  return [best.left, best.right]
}
