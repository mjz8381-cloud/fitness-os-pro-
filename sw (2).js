// sw.js — Service Worker لـ Fitness OS Pro
// ده الملف اللي كان ناقص وهو سبب رئيسي في إن الإشعارات (خصوصًا لما التطبيق مقفول) مش شغالة.
// لازم يترفع على السيرفر في نفس مكان index.html بالظبط (نفس الدومين، المسار الجذر /sw.js)
// جرّب تفتح https://YOUR-DOMAIN/sw.js في المتصفح بعد الرفع — لازم تشوف الكود ده نفسه، مش صفحة 404.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// لما السيرفر يبعت push حقيقي (عن طريق edge function باستخدام VAPID)
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (e) {
    payload = { title: 'Fitness OS Pro', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Fitness OS Pro';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icon-192.png',
    badge: payload.badge || '/icon-192.png',
    tag: payload.tag || title,
    data: { url: payload.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// لما المستخدم يدوس على الإشعار — يفتح/يركّز على التطبيق
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      const existing = clientsArr.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow(targetUrl);
    })
  );
});
