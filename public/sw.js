const CACHE = 'yuki-shell-v3.9'
// Avatar kini WebP (~40-55 KB/gambar). Dulu precache 6 PNG ≈ 4 MB sekali install —
// boros kuota di HP. Versi cache dinaikkan supaya cache PNG lama dibuang.
const CORE = [
  '/', '/manifest.webmanifest', '/yuki-icon.svg',
  '/expressions/tenang.webp', '/expressions/senang.webp', '/expressions/malu.webp',
  '/expressions/sedih.webp', '/expressions/kesal.webp', '/expressions/lesu.webp'
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
    event.respondWith(fetch(request).then(response => {
      const copy = response.clone()
      caches.open(CACHE).then(cache => cache.put(request, copy))
      return response
    }).catch(() => caches.match(request)))
  }
})

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data?.json() || {} } catch { data = { body: event.data?.text() || 'Yuki punya pengingat untukmu.' } }
  event.waitUntil(self.registration.showNotification(data.title || '⏰ Pengingat Yuki', {
    body: data.body || 'Hmph, waktunya melakukan hal yang sudah kamu jadwalkan.',
    icon: '/yuki-icon.svg', badge: '/yuki-icon.svg', tag: data.tag || 'yuki-reminder',
    renotify: true, data: { url: data.url || '/' }, actions: [{ action: 'open', title: 'Buka Yuki' }]
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).toString()
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const client = clients.find(item => item.url.startsWith(self.location.origin))
    if (client) { client.navigate(target); return client.focus() }
    return self.clients.openWindow(target)
  }))
})
