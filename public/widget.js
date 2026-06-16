// public/widget.js — sematkan Yuki sebagai bubble chat melayang di situs mana pun.
(function () {
  var me = document.currentScript
  // host server Node tempat Yuki berjalan (default: origin file widget ini)
  var HOST = (me && me.getAttribute('data-host'))
    || (me && me.src ? new URL(me.src).origin : '')
  var POS = (me && me.getAttribute('data-position')) || 'right'

  var tooltipPos = POS === 'right' ? 'right:86px;' : 'left:86px;'
  var css = ''
    + '@keyframes yuki-pulse{0%{box-shadow:0 0 0 0 rgba(34,211,238,0.6),0 4px 10px rgba(0,0,0,0.3)}70%{box-shadow:0 0 0 12px rgba(34,211,238,0),0 4px 10px rgba(0,0,0,0.3)}100%{box-shadow:0 0 0 0 rgba(34,211,238,0),0 4px 10px rgba(0,0,0,0.3)}}'
    + '.yuki-fab{position:fixed;bottom:24px;' + POS + ':24px;width:50px;height:50px;border-radius:50%;'
    + 'border:none;cursor:pointer;z-index:2147483001;color:#080c14;line-height:1;'
    + 'background:linear-gradient(135deg,#22d3ee,#38bdf8);box-shadow:0 8px 24px rgba(34,211,238,.4),0 4px 10px rgba(0,0,0,.3);'
    + 'display:grid;place-items:center;transition:transform .2s,background .2s;animation:yuki-pulse 2s infinite}'
    + '.yuki-fab:hover{transform:scale(1.08);background:linear-gradient(135deg,#38bdf8,#22d3ee)}'
    + '.yuki-fab svg{width:24px;height:24px;stroke:#080c14}'
    + '.yuki-tooltip{position:fixed;bottom:31px;' + tooltipPos + 'background:rgba(18,24,38,0.95);color:#e7ebf3;border:1px solid #232b3a;padding:6px 12px;border-radius:8px;font-size:12.5px;font-family:system-ui,-apple-system,sans-serif;box-shadow:0 6px 16px rgba(0,0,0,.35);pointer-events:none;opacity:0;transform:translateX(' + (POS === 'right' ? '10px' : '-10px') + ');transition:opacity .3s,transform .3s;z-index:2147483000}'
    + '.yuki-tooltip.visible{opacity:1;transform:translateX(0)}'
    + '.yuki-box{position:fixed;bottom:88px;' + POS + ':24px;width:380px;max-width:calc(100vw - 48px);'
    + 'height:580px;max-height:calc(100vh - 120px);z-index:2147483000;border-radius:18px;overflow:hidden;'
    + 'box-shadow:0 24px 60px rgba(0,0,0,.5);border:1px solid #232b3a;background:#0a0e16;'
    + 'display:none;opacity:0;transform:translateY(16px) scale(.98);transform-origin:bottom ' + POS + ';'
    + 'transition:opacity .22s ease,transform .22s ease}'
    + '.yuki-box.open{display:block;opacity:1;transform:translateY(0) scale(1)}'
    + '.yuki-box iframe{width:100%;height:100%;border:0;display:block}'
    + '@media (max-width:600px){'
    + '.yuki-box{bottom:0!important;' + POS + ':0!important;left:0!important;width:100%!important;max-width:100%!important;height:100%!important;max-height:100%!important;border-radius:0!important;border:none!important}'
    + '}'
  var style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  var ICON_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path><circle cx="9" cy="10" r="1.2" fill="currentColor"></circle><circle cx="15" cy="10" r="1.2" fill="currentColor"></circle><path d="M10 14c.5.5 1.5.5 2 0"></path></svg>'
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
  
  var fab = document.createElement('button')
  fab.className = 'yuki-fab'
  fab.setAttribute('aria-label', 'Chat dengan Yuki')
  fab.innerHTML = ICON_OPEN
  document.body.appendChild(fab)

  var tooltip = document.createElement('div')
  tooltip.className = 'yuki-tooltip'
  tooltip.textContent = 'Tanya Yuki! 🌸'
  document.body.appendChild(tooltip)

  var box = document.createElement('div')
  box.className = 'yuki-box'
  var iframe = document.createElement('iframe')
  iframe.title = 'Yuki'
  iframe.loading = 'lazy'
  box.appendChild(iframe)
  document.body.appendChild(box)

  var loaded = false

  function setWidgetOpen(isOpen) {
    if (isOpen) {
      box.classList.add('open')
      fab.innerHTML = ICON_CLOSE
      fab.setAttribute('aria-label', 'Tutup chat')
      tooltip.classList.remove('visible')
      if (window.innerWidth <= 600) {
        fab.style.display = 'none'
      }
    } else {
      box.classList.remove('open')
      fab.innerHTML = ICON_OPEN
      fab.setAttribute('aria-label', 'Chat dengan Yuki')
      fab.style.display = 'grid'
    }
  }

  fab.addEventListener('click', function () {
    if (!loaded) {
      iframe.src = HOST + '/embed.html?api=' + encodeURIComponent(HOST)
      loaded = true
    }
    var isOpen = !box.classList.contains('open')
    setWidgetOpen(isOpen)
  })

  // Listen for close signal from inside the iframe (embed.html Close button)
  window.addEventListener('message', function (e) {
    if (e.data === 'yuki-close') {
      setWidgetOpen(false)
    }
  })

  // Show tooltip after 2.5 seconds, hide after 9.5 seconds
  setTimeout(function () {
    if (!box.classList.contains('open')) {
      tooltip.classList.add('visible')
    }
  }, 2500)
  setTimeout(function () {
    tooltip.classList.remove('visible')
  }, 9500)
})()