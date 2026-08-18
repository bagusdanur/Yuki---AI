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

  // Helper universal script & styling for mobile responsiveness & touch controls
  const universalMobileEngine = `
  <style>
    /* Auto-responsive & mobile touch optimization */
    * { -webkit-tap-highlight-color: transparent; }
    html, body {
      width: 100% !important;
      height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      touch-action: none !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }
    canvas {
      display: block !important;
      margin: 0 auto !important;
      max-width: 100vw !important;
      max-height: calc(100vh - 90px) !important;
      width: auto !important;
      height: auto !important;
      object-fit: contain !important;
      touch-action: none !important;
    }
    /* Virtual Mobile Touch Controls Bar */
    #_yuki_m_pad {
      position: fixed;
      bottom: 0; left: 0; right: 0;
      height: 84px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px 8px;
      background: linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.5) 75%, transparent 100%);
      pointer-events: none;
      z-index: 999999;
    }
    ._yuki_btn_grp {
      display: flex;
      gap: 12px;
      pointer-events: auto;
    }
    ._yuki_ctrl_btn {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      border: 1.5px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.12);
      backdrop-filter: blur(8px);
      color: #ffffff;
      font-size: 22px;
      font-weight: bold;
      display: grid;
      place-items: center;
      cursor: pointer;
      user-select: none;
      -webkit-user-select: none;
      touch-action: none;
      transition: background 0.1s, transform 0.1s;
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
    }
    ._yuki_ctrl_btn:active, ._yuki_ctrl_btn.active {
      background: rgba(255, 255, 255, 0.35);
      transform: scale(0.92);
      border-color: #ffffff;
    }
    ._yuki_btn_action {
      background: rgba(167, 139, 250, 0.25);
      border-color: rgba(167, 139, 250, 0.5);
      color: #d8b4fe;
      font-size: 15px;
      width: 62px;
      height: 62px;
    }
    ._yuki_btn_action:active {
      background: rgba(167, 139, 250, 0.5);
    }
    @media (min-width: 900px) and (pointer: fine) {
      #_yuki_m_pad { display: none !important; }
      canvas { max-height: 98vh !important; }
    }
  </style>

  <!-- Virtual Mobile D-Pad -->
  <div id="_yuki_m_pad">
    <div class="_yuki_btn_grp">
      <button type="button" class="_yuki_ctrl_btn" id="_btn_left" aria-label="Kiri">◀</button>
      <button type="button" class="_yuki_ctrl_btn" id="_btn_right" aria-label="Kanan">▶</button>
    </div>
    <div class="_yuki_btn_grp">
      <button type="button" class="_yuki_ctrl_btn _yuki_btn_action" id="_btn_act" aria-label="Aksi / Start">● TAP</button>
    </div>
  </div>

  <script>
  (function() {
    // 1. Universal Direct Touch-to-Mouse & Touch-to-Canvas Drag Bridge
    function relayTouchToMouse(e) {
      if (!e.touches || e.touches.length === 0) return;
      const touch = e.touches[0];
      const target = document.elementFromPoint(touch.clientX, touch.clientY) || e.target;
      
      const mouseMoveEvt = new MouseEvent('mousemove', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        screenX: touch.screenX,
        screenY: touch.screenY,
        bubbles: true,
        cancelable: true,
        view: window
      });
      target.dispatchEvent(mouseMoveEvt);
      window.dispatchEvent(mouseMoveEvt);
      document.dispatchEvent(mouseMoveEvt);
    }

    window.addEventListener('touchstart', function(e) {
      if (e.target.closest('#_yuki_m_pad')) return;
      relayTouchToMouse(e);
      // Dispatch click for Start / Restart buttons inside canvas/DOM
      const touch = e.touches[0];
      const clickEvt = new MouseEvent('click', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        bubbles: true,
        cancelable: true
      });
      const target = document.elementFromPoint(touch.clientX, touch.clientY) || e.target;
      target.dispatchEvent(clickEvt);

      // Trigger standard Game Start keys
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }, { passive: false });

    window.addEventListener('touchmove', function(e) {
      if (e.target.closest('#_yuki_m_pad')) return;
      e.preventDefault(); // Prevent page pull/scroll inside game
      relayTouchToMouse(e);
    }, { passive: false });

    window.addEventListener('touchend', function(e) {
      if (e.target.closest('#_yuki_m_pad')) return;
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
    }, { passive: false });

    // 2. Virtual D-Pad Continuous Press Bridge
    function bindContinuousButton(btnId, keyName, keyCodeVal) {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      let intervalId = null;

      function startPress(e) {
        e.preventDefault();
        e.stopPropagation();
        btn.classList.add('active');
        const trigger = () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, code: keyName, keyCode: keyCodeVal, which: keyCodeVal, bubbles: true }));
        };
        trigger();
        if (!intervalId) {
          intervalId = setInterval(trigger, 35);
        }
      }

      function stopPress(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        btn.classList.remove('active');
        if (intervalId) {
          clearInterval(intervalId);
          intervalId = null;
        }
        window.dispatchEvent(new KeyboardEvent('keyup', { key: keyName, code: keyName, keyCode: keyCodeVal, which: keyCodeVal, bubbles: true }));
      }

      btn.addEventListener('touchstart', startPress, { passive: false });
      btn.addEventListener('touchend', stopPress, { passive: false });
      btn.addEventListener('touchcancel', stopPress, { passive: false });
      btn.addEventListener('mousedown', startPress);
      btn.addEventListener('mouseup', stopPress);
      btn.addEventListener('mouseleave', stopPress);
    }

    bindContinuousButton('_btn_left', 'ArrowLeft', 37);
    bindContinuousButton('_btn_right', 'ArrowRight', 39);

    // Action button (Space / Jump / Shoot / Start)
    const actBtn = document.getElementById('_btn_act');
    if (actBtn) {
      function triggerAction(e) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        
        // Also trigger click in center of screen
        const midX = window.innerWidth / 2;
        const midY = window.innerHeight / 2;
        const centerElem = document.elementFromPoint(midX, midY) || document.body;
        centerElem.dispatchEvent(new MouseEvent('click', { clientX: midX, clientY: midY, bubbles: true }));
      }

      function releaseAction(e) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38, bubbles: true }));
      }

      actBtn.addEventListener('touchstart', triggerAction, { passive: false });
      actBtn.addEventListener('touchend', releaseAction, { passive: false });
      actBtn.addEventListener('mousedown', triggerAction);
      actBtn.addEventListener('mouseup', releaseAction);
    }
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
