// ZENO service worker: Web Push for the order board + a conservative offline shell.
const CACHE = 'zeno-v1'
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/favicon.svg', '/icon-192.png', '/site.webmanifest']

// Caching stays off on localhost so it never interferes with Vite dev / HMR.
const CACHING_ENABLED = !['localhost', '127.0.0.1'].includes(self.location.hostname)

self.addEventListener('install', (event) => {
  if (!CACHING_ENABLED) return self.skipWaiting()
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

function isImmutableAsset(url) {
  // Content-hashed build output and self-hosted fonts are safe to cache forever.
  return url.pathname.startsWith('/_nuxt/') || url.pathname.startsWith('/_fonts/')
}

self.addEventListener('fetch', (event) => {
  if (!CACHING_ENABLED) return
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)
  // Only handle same-origin GETs. Never touch the API, guest tracking links, or anything marked no-store.
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/o/')) return

  if (isImmutableAsset(url)) {
    // Cache-first: hashed assets never change under the same URL.
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
        return res
      })),
    )
    return
  }

  if (req.mode === 'navigate') {
    // Network-first for pages; fall back to the offline shell when the network is unreachable.
    event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)))
  }
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  }
  catch {
    data = {}
  }
  const title = data.title || 'Đơn mới'
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag,
    renotify: Boolean(data.tag),
    data: { url: data.url || '/app/orders' },
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/app/orders'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (client.url.includes('/app/orders') && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(target)
    }),
  )
})
