// skills/computing/html-canvas-builder/handler.js

export async function executeBuildInteractiveArtifact({ title, type = 'html', html_content }) {
  if (!title || !title.trim()) {
    return { error: 'Parameter "title" tidak boleh kosong.' }
  }
  if (!html_content || !html_content.trim()) {
    return { error: 'Parameter "html_content" tidak boleh kosong.' }
  }

  const cleanTitle = String(title).trim()
  const cleanType = ['html', 'javascript', 'svg'].includes(type) ? type : 'html'
  let code = String(html_content).trim()

  // Jika belum dibungkus struktur HTML lengkap, berikan template dasar modern
  if (cleanType === 'html' && !code.toLowerCase().includes('<!doctype') && !code.toLowerCase().includes('<html')) {
    code = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    }
  </style>
</head>
<body>
  ${code}
</body>
</html>`
  }

  const artifactId = `art_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`

  return {
    success: true,
    message: `Artifact "${cleanTitle}" berhasil dirakit dan siap dirender di Live Preview.`,
    artifact: {
      id: artifactId,
      title: cleanTitle,
      type: cleanType,
      content: code
    }
  }
}

export default {
  build_interactive_artifact: executeBuildInteractiveArtifact
}
