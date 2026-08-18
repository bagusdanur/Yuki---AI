// skills/computing/html-canvas-builder/handler.js
import fs from 'node:fs'
import path from 'node:path'

export async function executeBuildInteractiveArtifact(params = {}) {
  const { title, type = 'html', html_content, code, content } = params
  const cleanTitle = String(title || 'Interactive Canvas App').trim()
  const cleanType = ['html', 'javascript', 'svg'].includes(type) ? type : 'html'
  const rawCode = html_content || code || content

  if (!rawCode || !String(rawCode).trim()) {
    return { error: 'Parameter "html_content" atau "code" tidak boleh kosong.' }
  }

  let finalCode = String(rawCode).trim()

  // Jika belum dibungkus struktur HTML lengkap, berikan template dasar modern
  if (cleanType === 'html' && !finalCode.toLowerCase().includes('<!doctype') && !finalCode.toLowerCase().includes('<html')) {
    finalCode = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${cleanTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0b0f19;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      overflow-x: hidden;
    }
  </style>
</head>
<body>
  ${finalCode}
</body>
</html>`
  }

  const artifactId = `art_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  // Simpan file ke public/artifacts di server agar bisa langsung diakses / diunduh
  try {
    const artifactsDir = path.resolve('public/artifacts')
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true })
    }
    fs.writeFileSync(path.join(artifactsDir, `${artifactId}.html`), finalCode, 'utf8')
  } catch (err) {
    console.warn('[artifact] Gagal menyimpan file ke disk:', err.message)
  }

  return {
    success: true,
    message: `Artifact "${cleanTitle}" berhasil dirakit dan siap dirender di Live Preview.`,
    artifact: {
      id: artifactId,
      title: cleanTitle,
      type: cleanType,
      content: finalCode,
      url: `/artifacts/${artifactId}.html`
    }
  }
}

export default {
  build_interactive_artifact: executeBuildInteractiveArtifact
}
