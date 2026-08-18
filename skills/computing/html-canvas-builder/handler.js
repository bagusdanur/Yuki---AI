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

  // Helper universal script & styling for mobile responsiveness & precision touch controls
  const universalMobileEngine = `
  <style>
    /* Super-responsive 100% viewport fit for both Mobile and Desktop */
    * {
      box-sizing: border-box !important;
      -webkit-tap-highlight-color: transparent !important;
    }
    html, body {
      width: 100% !important;
      min-height: 100% !important;
      margin: 0 !important;
      padding: 6px !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      background: #08090c !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      touch-action: manipulation !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }
    #game-wrapper, .game-wrapper, .game-container, #container, main {
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      max-width: 100vw !important;
      padding: 6px !important;
      margin: 0 auto !important;
      box-sizing: border-box !important;
    }
    canvas {
      display: block !important;
      margin: 0 auto !important;
      max-width: 95vw !important;
      max-height: 65vh !important;
      width: auto !important;
      height: auto !important;
      object-fit: contain !important;
      touch-action: none !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.8) !important;
    }
    .controls {
      display: flex !important;
      flex-wrap: wrap !important;
      justify-content: center !important;
      gap: 6px !important;
      margin-top: 8px !important;
      max-width: 100vw !important;
    }
    /* Touch Drag Guide Indicator */
    #_yuki_touch_guide {
      position: fixed;
      bottom: 8px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255,255,255,0.45);
      font-family: system-ui, sans-serif;
      font-size: 11px;
      pointer-events: none;
      z-index: 9999;
      background: rgba(0,0,0,0.6);
      padding: 3px 10px;
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      display: none;
    }
    @media (pointer: coarse), (max-width: 768px) {
      #_yuki_touch_guide { display: block; }
    }
  </style>

  <div id="_yuki_touch_guide">👆 Sentuh & geser layar untuk kontrol</div>

  <script>
  (function() {
    // 1. Auto-Start Helper (Otomatis start game jika butuh tombol START)
    function autoStartGame() {
      var startBtns = document.querySelectorAll('#btn-start, #start-btn, #start, .btn-start, button');
      startBtns.forEach(function(btn) {
        var txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (txt === 'start' || txt === 'play' || txt === 'mulai' || txt === 'start game') {
          btn.click();
        }
      });
    }

    setTimeout(autoStartGame, 100);
    setTimeout(autoStartGame, 400);
    window.addEventListener('touchstart', autoStartGame, { once: true });
    window.addEventListener('click', autoStartGame, { once: true });

    // 2. DYNAMIC AUTO-FIT CANVAS RESIZER (Memastikan canvas 100% pas di layar HP/PC tanpa terpotong)
    function autoScaleCanvas() {
      var canvases = document.querySelectorAll('canvas');
      canvases.forEach(function(canvas) {
        if (!canvas.dataset.nativeW) {
          canvas.dataset.nativeW = canvas.width || 300;
          canvas.dataset.nativeH = canvas.height || 500;
        }
        var nw = parseFloat(canvas.dataset.nativeW);
        var nh = parseFloat(canvas.dataset.nativeH);
        var ratio = nw / nh;

        var maxW = Math.min(window.innerWidth - 16, 480);
        var maxH = window.innerHeight * 0.65;

        var targetW = maxW;
        var targetH = targetW / ratio;

        if (targetH > maxH) {
          targetH = maxH;
          targetW = targetH * ratio;
        }

        canvas.style.width = Math.floor(targetW) + 'px';
        canvas.style.height = Math.floor(targetH) + 'px';
      });
    }

    window.addEventListener('resize', autoScaleCanvas);
    window.addEventListener('orientationchange', autoScaleCanvas);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', autoScaleCanvas);
    } else {
      autoScaleCanvas();
    }
    setTimeout(autoScaleCanvas, 50);
    setTimeout(autoScaleCanvas, 250);

    // 3. PRECISION TOUCH-TO-DRAG & SWIPE ENGINE
    var startTouchX = null;
    var startTouchY = null;
    var lastTouchX = null;
    var lastTouchY = null;
    var touchMoved = false;

    function dispatchMouseEventToAll(type, clientX, clientY) {
      var canvases = document.querySelectorAll('canvas');
      canvases.forEach(function(canvas) {
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width / (rect.width || 1);
        var scaleY = canvas.height / (rect.height || 1);
        var localX = (clientX - rect.left) * scaleX;
        var localY = (clientY - rect.top) * scaleY;

        var evt = new MouseEvent(type, {
          clientX: clientX,
          clientY: clientY,
          screenX: clientX,
          screenY: clientY,
          bubbles: true,
          cancelable: true,
          view: window
        });

        try {
          Object.defineProperty(evt, 'offsetX', { value: localX });
          Object.defineProperty(evt, 'offsetY', { value: localY });
          Object.defineProperty(evt, 'layerX', { value: localX });
          Object.defineProperty(evt, 'layerY', { value: localY });
        } catch(e) {}

        canvas.dispatchEvent(evt);
      });

      var docEvt = new MouseEvent(type, {
        clientX: clientX,
        clientY: clientY,
        bubbles: true,
        cancelable: true,
        view: window
      });
      document.dispatchEvent(docEvt);
      window.dispatchEvent(docEvt);
    }

    function triggerKey(keyName, keyCodeVal) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, code: keyName, keyCode: keyCodeVal, which: keyCodeVal, bubbles: true }));
      setTimeout(function() {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: keyName, code: keyName, keyCode: keyCodeVal, which: keyCodeVal, bubbles: true }));
      }, 35);
    }

    function handleTouchMove(e) {
      if (!e.touches || e.touches.length === 0) return;
      var touch = e.touches[0];
      var currentX = touch.clientX;
      var currentY = touch.clientY;

      dispatchMouseEventToAll('mousemove', currentX, currentY);

      if (lastTouchX !== null && lastTouchY !== null) {
        var deltaX = currentX - lastTouchX;
        var deltaY = currentY - lastTouchY;

        if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
          touchMoved = true;
        }

        // Horizontal Swipe: Left / Right
        if (deltaX < -3) {
          triggerKey('ArrowLeft', 37);
        } else if (deltaX > 3) {
          triggerKey('ArrowRight', 39);
        }

        // Vertical Swipe Down: Drop / Fast Fall
        if (deltaY > 6) {
          triggerKey('ArrowDown', 40);
        }
      }

      lastTouchX = currentX;
      lastTouchY = currentY;
    }

    function handleTouchStart(e) {
      if (!e.touches || e.touches.length === 0) return;
      var touch = e.touches[0];
      startTouchX = touch.clientX;
      startTouchY = touch.clientY;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      touchMoved = false;

      var guide = document.getElementById('_yuki_touch_guide');
      if (guide) guide.style.opacity = '0';

      dispatchMouseEventToAll('mousedown', touch.clientX, touch.clientY);
      dispatchMouseEventToAll('mousemove', touch.clientX, touch.clientY);

      var clickEvt = new MouseEvent('click', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        bubbles: true,
        cancelable: true
      });
      e.target.dispatchEvent(clickEvt);
    }

    function handleTouchEnd(e) {
      dispatchMouseEventToAll('mouseup', 0, 0);

      // Tap = Rotate / Jump / Action
      if (!touchMoved && startTouchX !== null) {
        triggerKey('ArrowUp', 38);
        triggerKey('w', 87);
        triggerKey(' ', 32);
        triggerKey('Enter', 13);
      }

      startTouchX = null;
      startTouchY = null;
      lastTouchX = null;
      lastTouchY = null;
      touchMoved = false;
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: false });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    // 4. ERROR BOUNDARY VISUAL (Jika game ada error, tampilkan pesan pemulihan ramah pengguna)
    window.addEventListener('error', function(e) {
      console.warn('[Yuki Sandbox] Runtime script warning:', e.message);
    });
  })();
  </script>
  `



  let finalCode
  if (rawContent.toLowerCase().includes('<!doctype') || rawContent.toLowerCase().includes('<html')) {
    // Inject mobile engine tepat sebelum </body> atau di akhir dokumen
    if (/<\/body>/i.test(rawContent)) {
      finalCode = rawContent.replace(/<\/body>/i, universalMobileEngine + '\n</body>')
    } else {
      finalCode = rawContent + '\n' + universalMobileEngine
    }
  } else {
    // Bungkus dokumen baru dengan HTML5 lengkap dan universal mobile engine
    finalCode = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>${cleanTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; background: #09090b; color: #f4f4f5; font-family: system-ui, sans-serif; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  </style>
</head>
<body>
  ${rawContent}
  ${universalMobileEngine}
</body>
</html>`
  }



  const artifactId = String(params.id || `art_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)

  // Simpan file ke public/artifacts di server agar bisa langsung diakses / diunduh
  const rawUsername = context?.username || 'user'
  const cleanUsername = String(rawUsername).toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
  const cleanTitleSlug = cleanTitle.toLowerCase().replace(/[^a-z0-9_-]+/g, '_') || 'app'
  const namedFile = `${cleanUsername}_${cleanTitleSlug}.html`

  try {
    const artifactsDir = path.resolve('public/artifacts')
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true })
    }
    fs.writeFileSync(path.join(artifactsDir, `${artifactId}.html`), finalCode, 'utf8')
    fs.writeFileSync(path.join(artifactsDir, namedFile), finalCode, 'utf8')
  } catch (err) {
    console.warn('[artifact] Gagal menyimpan file ke disk:', err.message)
  }

  // Simpan ke SQLite persistent workspace jika ada userId di context
  let savedRecord = { id: artifactId, title: cleanTitle, type: cleanType, content: finalCode, version: 1 }
  if (context?.userId) {
    try {
      const { saveUserArtifact } = await import('../../../lib/memory.js')
      savedRecord = saveUserArtifact(context.userId, {
        id: artifactId,
        title: cleanTitle,
        type: cleanType,
        content: finalCode,
        patch_note: 'Initial build'
      }) || savedRecord
    } catch (err) {
      console.warn('[artifact] Gagal simpan ke database:', err.message)
    }
  }

  return {
    success: true,
    message: `Artifact "${cleanTitle}" (v${savedRecord.version || 1}) berhasil dirakit dan siap dirender di Live Preview.`,
    artifact: {
      id: savedRecord.id || artifactId,
      title: savedRecord.title || cleanTitle,
      type: cleanType,
      content: finalCode,
      version: savedRecord.version || 1,
      url: `/artifacts/${artifactId}.html`
    }
  }
}

export async function executeGetActiveArtifact(params = {}, context = {}) {
  const userId = context?.userId || params?.userId
  if (!userId) {
    return { success: false, error: 'User ID tidak ditemukan dalam konteks.' }
  }

  try {
    const { getLatestUserArtifact } = await import('../../../lib/memory.js')
    const active = getLatestUserArtifact(userId)
    if (!active) {
      return {
        success: true,
        has_active_artifact: false,
        message: 'Belum ada file artifact yang dibuat oleh user dalam sesi ini.'
      }
    }

    return {
      success: true,
      has_active_artifact: true,
      artifact: {
        id: active.id,
        title: active.title,
        type: active.type,
        version: active.version,
        patch_note: active.patch_note,
        updated_at: active.updated_at,
        content: active.content
      },
      message: `Artifact aktif ditemukan: "${active.title}" (Versi ${active.version}). Gunakan kode ini sebagai basis modifikasi/penambahan level.`
    }
  } catch (err) {
    return { success: false, error: `Gagal membaca artifact aktif: ${err.message}` }
  }
}

export async function executeReadArtifactFile(params = {}, context = {}) {
  const userId = context?.userId || params?.userId
  const artifactId = params?.id
  if (!userId || !artifactId) {
    return { success: false, error: 'Parameter "id" dan user ID harus disertakan.' }
  }

  try {
    const { getUserArtifactById } = await import('../../../lib/memory.js')
    const art = getUserArtifactById(userId, artifactId)
    if (!art) {
      return { success: false, error: `Artifact dengan ID "${artifactId}" tidak ditemukan.` }
    }

    return {
      success: true,
      artifact: art,
      message: `File artifact "${art.title}" (v${art.version}) berhasil dibaca.`
    }
  } catch (err) {
    return { success: false, error: `Gagal membaca file artifact: ${err.message}` }
  }
}

export async function executeUpdateInteractiveArtifact(params = {}, context = {}) {
  const userId = context?.userId || params?.userId
  const { getLatestUserArtifact, getUserArtifactById } = await import('../../../lib/memory.js')
  
  let targetId = params.id || context?.activeArtifactId
  let activeArt = null
  if (userId) {
    activeArt = targetId ? getUserArtifactById(userId, targetId) : getLatestUserArtifact(userId)
    if (activeArt) {
      targetId = activeArt.id
    }
  }

  const { title, html_content, code, content, patch_note, summary } = params
  const rawCode = html_content || code || content
  if (!rawCode) {
    return { success: false, error: 'Parameter "html_content" atau "code" yang diperbarui tidak boleh kosong.' }
  }

  const finalTitle = title || activeArt?.title || 'Updated Canvas App'

  // Gunakan executeBuildInteractiveArtifact untuk memproses injeksi engine & penyimpanan
  const buildResult = await executeBuildInteractiveArtifact({
    id: targetId,
    title: finalTitle,
    html_content: rawCode,
    patch_note: patch_note || summary || 'Incremental update / level extension'
  }, context)

  return buildResult
}

export default {
  build_interactive_artifact: executeBuildInteractiveArtifact,
  get_active_artifact: executeGetActiveArtifact,
  read_artifact_file: executeReadArtifactFile,
  update_interactive_artifact: executeUpdateInteractiveArtifact
}

