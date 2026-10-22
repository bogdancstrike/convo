/*
 * Convo service worker: Web Push wake-ups only (no caching, no fetch handling).
 * The push carries no payload; the server only knows that this device has encrypted mail
 * waiting. Opening Convo connects, downloads and decrypts it.
 */
const ro = () => (self.navigator.language || '').toLowerCase().startsWith('ro');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('Convo', {
    body: ro() ? 'Mesaj nou sau apel' : 'New message or call',
    tag: 'convo-wake',
    renotify: true,
    icon: '/logo.svg',
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) return open.focus();
    return self.clients.openWindow('/');
  })());
});
