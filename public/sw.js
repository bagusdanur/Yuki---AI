const CACHE = 'yuki-shell-v3.3'
const CORE = [
  '/', '/manifest.webmanifest', '/yuki-icon.svg',
  '/expressions/tenang.png', '/expressions/senang.png', '/expressions/malu.png',
  '/expressions/sedih.png', '/expressions/kesal.png', '/expressions/lesu.png'
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone()
      caches.open(CACHE).then(cache => cache.put('/', copy))
      return response
    }).catch(() => caches.match('/')))
    return
  }

  if (url.pathname.startsWith('/expressions/') || url.pathname === '/yuki-icon.svg') {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone()
      caches.open(CACHE).then(cache => cache.put(request, copy))
      return response
    })))
    return
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
      const copy = response.clone()
      caches.open(CACHE).then(cache => cache.put(request, copy))
      return response
    })))
  }
})
