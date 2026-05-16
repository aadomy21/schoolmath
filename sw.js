self.addEventListener('push', event => {
  let data = { title: 'New message', body: 'You have a new message', url: '/' };
  try { if (event.data) data = event.data.json(); } catch (e) { }
  const options = {
    body: data.body,
    icon: data.icon || '/avatar.png',
    data: { url: data.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(data.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.matchAll({ type: 'window' }).then(clientList => {
    for (const c of clientList) {
      if (c.url === url && 'focus' in c) return c.focus();
    }
    if (clients.openWindow) return clients.openWindow(url);
  }));
});
