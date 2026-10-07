// Service worker of "אווירה צ'אט" (stage 1ב, 2026-10-05) — notifications ONLY.
// It caches nothing and intercepts no request, so it can never serve a stale page (the
// "old version after an update" problem stays impossible). Scope: /chat.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "אווירה צ'אט", body: event.data && event.data.text() }; }
  const title = data.title || "אווירה צ'אט";
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    // Meeting reminders: stay on screen until tapped (where the platform supports it).
    requireInteraction: !!data.requireInteraction,
    icon: '/logo-192.png',
    badge: '/logo-192.png',
    dir: 'rtl',
    lang: 'he',
    data: { url: data.url || '/chat' },
  };
  const tasks = [self.registration.showNotification(title, options)];
  if (typeof data.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
    tasks.push((data.badge > 0 ? self.navigator.setAppBadge(data.badge) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  event.waitUntil(Promise.all(tasks));
});

// Tap → open (or focus) the app on that conversation.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/chat', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if (new URL(client.url).pathname.startsWith('/chat')) {
        await client.focus();
        if ('navigate' in client) return client.navigate(url);
        return undefined;
      }
    }
    return self.clients.openWindow(url);
  })());
});
