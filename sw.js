/* Service-Worker: zeigt Benachrichtigungen an (Tor, Anpfiff, Abpfiff, „gleich seid ihr dran“).
   Bewusst ohne Zwischenspeicher – die Seite soll immer den aktuellen Stand laden. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Oberstufen-Turnier', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Oberstufen-Turnier', {
    body: d.body || '', icon: '/img/icon-180.png', badge: '/img/favicon.png', tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || '/' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
