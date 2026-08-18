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
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }
    html, body {
      width: 100vw !important;
      height: 100vh !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: hidden !important;
      background: #08090c !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      touch-action: none !important;
      user-select: none !important;
      -webkit-user-select: none !important;
    }
    canvas {
      display: block !important;
      margin: auto !important;
      touch-action: none !important;
      box-shadow: 0 10px 40px rgba(0,0,0,0.8) !important;
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
    // 1. DYNAMIC AUTO-FIT CANVAS RESIZER (Memastikan canvas 100% pas di layar HP/PC tanpa terpotong)
    function autoScaleCanvas() {
      const canvases = document.querySelectorAll('canvas');
      canvases.forEach(function(canvas) {
        if (!canvas.dataset.nativeW) {
          canvas.dataset.nativeW = canvas.width || 400;
          canvas.dataset.nativeH = canvas.height || 600;
        }
        var nw = parseFloat(canvas.dataset.nativeW);
        var nh = parseFloat(canvas.dataset.nativeH);
        var ratio = nw / nh;

        var maxW = window.innerWidth;
        var maxH = window.innerHeight;

        var targetW = maxW;
        var targetH = targetW / ratio;

        if (targetH > maxH) {
          targetH = maxH;
          targetW = targetH * ratio;
        }

        canvas.style.width = Math.floor(targetW) + 'px';
        canvas.style.height = Math.floor(targetH) + 'px';
        canvas.style.maxWidth = '100vw';
        canvas.style.maxHeight = '100vh';
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
    setTimeout(autoScaleCanvas, 300);
    setInterval(autoScaleCanvas, 1500);

    // 2. PRECISION TOUCH-TO-DRAG & SWIPE ENGINE
    var lastTouchX = null;
    var lastTouchY = null;
    var touchActive = false;

    function dispatchMouseEventToAll(type, clientX, clientY) {
      var canvases = document.querySelectorAll('canvas');
      canvases.forEach(function(canvas) {
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
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

        // Set offsetX & offsetY if writable
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

    function handleTouchMove(e) {
      if (!e.touches || e.touches.length === 0) return;
      e.preventDefault(); // Prevent browser scroll
      var touch = e.touches[0];
      var currentX = touch.clientX;
      var currentY = touch.clientY;

      // A. Kirim event mousemove presisi tinggi
      dispatchMouseEventToAll('mousemove', currentX, currentY);

      // B. Emulasi Keyboard Panah saat jari digeser (Swipe-to-Key)
      if (lastTouchX !== null) {
        var deltaX = currentX - lastTouchX;
        if (deltaX < -2) {
          // Geser ke kiri
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, bubbles: true }));
          setTimeout(function() {
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, bubbles: true }));
          }, 30);
        } else if (deltaX > 2) {
          // Geser ke kanan
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true }));
          setTimeout(function() {
            window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true }));
          }, 30);
        }
      }

      lastTouchX = currentX;
      lastTouchY = currentY;
    }

    function handleTouchStart(e) {
      if (!e.touches || e.touches.length === 0) return;
      var touch = e.touches[0];
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      touchActive = true;

      // Sembunyikan panduan sentuh setelah sentuhan pertama
      var guide = document.getElementById('_yuki_touch_guide');
      if (guide) guide.style.opacity = '0';

      dispatchMouseEventToAll('mousedown', touch.clientX, touch.clientY);
      dispatchMouseEventToAll('mousemove', touch.clientX, touch.clientY);

      // Trigger Click & Space/Enter untuk Start Game
      var clickEvt = new MouseEvent('click', {
        clientX: touch.clientX,
        clientY: touch.clientY,
        bubbles: true,
        cancelable: true
      });
      e.target.dispatchEvent(clickEvt);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }

    function handleTouchEnd(e) {
      touchActive = false;
      lastTouchX = null;
      lastTouchY = null;
      dispatchMouseEventToAll('mouseup', 0, 0);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 37, which: 37, bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39, which: 39, bubbles: true }));
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: false });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: false });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: false });
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
