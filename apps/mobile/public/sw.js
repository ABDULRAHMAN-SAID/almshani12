// عامل الخدمة لإشعارات المتصفح (Web Push) — يُنسخ إلى جذر حزمة الويب عند expo export ويُسجَّل من src/lib/push.ts
// الخادم يرسل { title, body, data, url } (services/push.ts) — نعرض الإشعار ونفتح/نركّز التطبيق على الرابط عند النقر
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let p = {};
  try { p = e.data ? e.data.json() : {}; } catch { p = { body: e.data ? e.data.text() : '' }; }
  const data = Object.assign({}, p.data || {}, p.url ? { url: p.url } : {});
  e.waitUntil(self.registration.showNotification(p.title || 'منصّة', {
    body: p.body || '', data, icon: '/favicon.ico', badge: '/favicon.ico', dir: 'rtl', lang: 'ar', tag: data.tag || undefined,
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (!('focus' in c)) continue;
      if ('navigate' in c) c.navigate(url).catch(() => {});
      return c.focus();
    }
    return self.clients.openWindow(url);
  }));
});
