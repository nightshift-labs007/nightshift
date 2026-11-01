// Nightshift Signals service worker: shows push alerts and opens their link on tap.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "Nightshift Signals", body: "", url: "/" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {
    /* not JSON */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, { body: data.body, tag: data.tag, icon: "/icon.svg", badge: "/icon.svg", data: { url: data.url } }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => w.url === url);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
