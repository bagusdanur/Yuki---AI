// public/widget.js — sematkan Yuki sebagai bubble chat melayang di situs mana pun.
(function () {
  var me = document.currentScript
  // host server Node tempat Yuki berjalan (default: origin file widget ini)
  var HOST = (me && me.getAttribute('data-host'))
    || (me && me.src ? new URL(me.src).origin : '')
  var POS = (me && me.getAttribute('data-position')) || 'right'

  var css = ''
    + '.yuki-fab{position:fixed;bottom:20px;' + POS + ':20px;width:60px;height:60px;border-radius:50%;'
    + 'border:none;cursor:pointer;z-index:2147483000;color:#06121a;font-size:26px;'
    + 'background:linear-gradient(135deg,#22d3ee,#38bdf8);box-shadow:0 10px 28px rgba(0,0,0,.35);'
    + 'display:grid;place-items:center;transition:transform .15s}'
    + '.yuki-fab:hover{transform:scale(1.08)}'
    + '.yuki-box{position:fixed;bottom:90px;' + POS + ':20px;width:360px;max-width:calc(100vw - 32px);'
    + 'height:520px;max-height:calc(100vh - 120px);z-index:2147483000;border-radius:18px;overflow:hidden;'
    + 'box-shadow:0 18px 60px rgba(0,0,0,.5);border:1px solid #232b3a;background:#0a0e16;'
    + 'display:none;opacity:0;transform:translateY(12px);transition:opacity .2s,transform .2s}'
    + '.yuki-box.open{display:block;opacity:1;transform:translateY(0)}'
    + '.yuki-box iframe{width:100%;height:100%;border:0}'
  var style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)

  var fab = document.createElement('button')
  fab.className = 'yuki-fab'
  fab.setAttribute('aria-label', 'Chat dengan Yuki')
  fab.textContent = '🌸'
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
    fab.textContent = open ? '✕' : '🌸'
  })
})()