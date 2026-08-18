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

  const rawContent = String(rawCode).trim()

  // Jika sudah HTML lengkap (punya <!DOCTYPE atau <html>), gunakan as-is tanpa wrapping
  // hanya inject mobile controls script sebelum </body>
  let finalCode
  if (rawContent.toLowerCase().includes('<!doctype') || rawContent.toLowerCase().includes('<html')) {
    // Inject mobile touch controls sebelum </body>
    const mobileScript = `
  <!-- Mobile touch controls (auto-injected by Yuki Agent) -->
  <div id="_m_controls" style="display:none;position:fixed;bottom:0;left:0;right:0;height:120px;pointer-events:none;z-index:9999">
    <div id="_m_left" style="position:absolute;bottom:12px;left:18px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.18);display:grid;place-items:center;pointer-events:all;touch-action:none;font-size:28px;color:rgba(255,255,255,.5);-webkit-tap-highlight-color:transparent">◀</div>
    <div id="_m_fire" style="position:absolute;bottom:20px;left:50%;transform:translateX(-50%);width:64px;height:64px;border-radius:50%;background:rgba(167,139,250,.15);border:2px solid rgba(167,139,250,.4);display:grid;place-items:center;pointer-events:all;touch-action:none;font-size:22px;color:rgba(167,139,250,.7);-webkit-tap-highlight-color:transparent">●</div>
    <div id="_m_right" style="position:absolute;bottom:12px;right:18px;width:80px;height:80px;border-radius:50%;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.18);display:grid;place-items:center;pointer-events:all;touch-action:none;font-size:28px;color:rgba(255,255,255,.5);-webkit-tap-highlight-color:transparent">▶</div>
  </div>
  <script>
    if (window.matchMedia('(pointer:coarse)').matches||'ontouchstart' in window){
      document.getElementById('_m_controls').style.display='block';
      function _mFire(el,type,key,code){el.addEventListener(type,function(e){e.preventDefault();window.dispatchEvent(new KeyboardEvent(type==='touchstart'?'keydown':'keyup',{key,code,bubbles:true}));},{passive:false});}
      _mFire(document.getElementById('_m_left'),'touchstart','ArrowLeft','ArrowLeft');
      _mFire(document.getElementById('_m_left'),'touchend','ArrowLeft','ArrowLeft');
      _mFire(document.getElementById('_m_right'),'touchstart','ArrowRight','ArrowRight');
      _mFire(document.getElementById('_m_right'),'touchend','ArrowRight','ArrowRight');
      _mFire(document.getElementById('_m_fire'),'touchstart',' ','Space');
      _mFire(document.getElementById('_m_fire'),'touchend',' ','Space');
    }
  </script>`
    finalCode = rawContent.replace(/<\/body>/i, mobileScript + '\n</body>')
    // Jika tidak ada </body>, append saja
    if (finalCode === rawContent) finalCode = rawContent + mobileScript
  } else {
    // Bungkus dengan template mobile-friendly
    finalCode = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${cleanTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #09090b; color: #f4f4f5; font-family: system-ui, sans-serif; overflow: hidden; touch-action: none; user-select: none; -webkit-user-select: none; }
    body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
    canvas { display: block; max-width: 100%; max-height: calc(100vh - 120px); touch-action: none; }
    #_m_controls { display: none; position: fixed; bottom: 0; left: 0; right: 0; height: 120px; pointer-events: none; z-index: 9999; }
    #_m_left, #_m_right { position: absolute; bottom: 12px; width: 80px; height: 80px; border-radius: 50%; background: rgba(255,255,255,0.08); border: 2px solid rgba(255,255,255,0.18); display: grid; place-items: center; pointer-events: all; touch-action: none; font-size: 28px; color: rgba(255,255,255,0.5); -webkit-tap-highlight-color: transparent; }
    #_m_left { left: 18px; }
    #_m_right { right: 18px; }
    #_m_fire { position: absolute; bottom: 20px; left: 50%; transform: translateX(-50%); width: 64px; height: 64px; border-radius: 50%; background: rgba(167,139,250,0.15); border: 2px solid rgba(167,139,250,0.4); display: grid; place-items: center; pointer-events: all; touch-action: none; font-size: 22px; color: rgba(167,139,250,0.7); -webkit-tap-highlight-color: transparent; }
    @media (max-width: 768px), (pointer: coarse) { #_m_controls { display: block; } canvas { max-height: calc(100vh - 140px); } }
  </style>
</head>
<body>
  ${rawContent}
  <div id="_m_controls">
    <div id="_m_left">◀</div>
    <div id="_m_fire">●</div>
    <div id="_m_right">▶</div>
  </div>
  <script>
    if (window.matchMedia('(pointer:coarse)').matches||'ontouchstart' in window){
      document.getElementById('_m_controls').style.display='block';
      function _mFire(el,type,key,code){el.addEventListener(type,function(e){e.preventDefault();window.dispatchEvent(new KeyboardEvent(type==='touchstart'?'keydown':'keyup',{key,code,bubbles:true}));},{passive:false});}
      _mFire(document.getElementById('_m_left'),'touchstart','ArrowLeft','ArrowLeft');
      _mFire(document.getElementById('_m_left'),'touchend','ArrowLeft','ArrowLeft');
      _mFire(document.getElementById('_m_right'),'touchstart','ArrowRight','ArrowRight');
      _mFire(document.getElementById('_m_right'),'touchend','ArrowRight','ArrowRight');
      _mFire(document.getElementById('_m_fire'),'touchstart',' ','Space');
      _mFire(document.getElementById('_m_fire'),'touchend',' ','Space');
    }
  </script>
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
