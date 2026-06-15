// public/widget.js — sematkan Yuki sebagai bubble chat melayang di situs mana pun.
(function () {
  var me = document.currentScript
  // host server Node tempat Yuki berjalan (default: origin file widget ini)
  var HOST = (me && me.getAttribute('data-host'))
    || (me && me.src ? new URL(me.src).origin : '')
  var POS = (me && me.getAttribute('data-position')) || 'right'

  var css = ''
    + '.yuki-fab{position:fixed;bottom:88px;' + POS + ':24px;width:44px;height:44px;border-radius:50%;'
    + 'border:none;cursor:pointer;z-index:2147483000;color:#f7f7fb;font-size:20px;line-height:1;'
    + 'background:linear-gradient(135deg,#8b5cf6,#22d3ee);box-shadow:0 8px 22px rgba(139,92,246,.5),0 4px 10px rgba(0,0,0,.35);'
    + 'display:grid;place-items:center;transition:transform .2s,box-shadow .2s}'
    + '.yuki-fab:hover{transform:scale(1.08)}'
    + '.yuki-fab svg{width:20px;height:20px;stroke:#f7f7fb}'
    + '.yuki-box{position:fixed;bottom:160px;' + POS + ':24px;width:374px;max-width:calc(100vw - 28px);'
    + 'height:560px;max-height:calc(100vh - 196px);z-index:2147483000;border-radius:20px;overflow:hidden;'
    + 'box-shadow:0 24px 70px rgba(0,0,0,.55);border:1px solid #232b3a;background:#0a0e16;'
    + 'display:none;opacity:0;transform:translateY(16px) scale(.98);transform-origin:bottom ' + POS + ';'
    + 'transition:opacity .22s ease,transform .22s ease}'
    + '.yuki-box.open{display:block;opacity:1;transform:translateY(0) scale(1)}'
    + '.yuki-box iframe{width:100%;height:100%;border:0;display:block}'
  var style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  var ICON_OPEN = '🌸'
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>'
  var fab = document.createElement('button')
  fab.className = 'yuki-fab'
  fab.setAttribute('aria-label', 'Chat dengan Yuki')
  fab.innerHTML = ICON_OPEN
  document.body.appendChild(fab)

  var box = document.createElement('div')
  box.className = 'yuki-box'
  var iframe = document.createElement('iframe')
  iframe.title = 'Yuki'
  iframe.loading = 'lazy'
  box.appendChild(iframe)
  document.body.appendChild(box)

  var loaded = false
  fab.addEventListener('click', function () {
    if (!loaded) {
      iframe.src = HOST + '/embed.html?api=' + encodeURIComponent(HOST)
      loaded = true
    }
    var open = box.classList.toggle('open')
    fab.innerHTML = open ? ICON_CLOSE : ICON_OPEN
    fab.setAttribute('aria-label', open ? 'Tutup chat' : 'Chat dengan Yuki')
  })
})()