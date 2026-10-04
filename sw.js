const CACHE_NAME = "magic-kids-network-only-v2";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    const u = new URL(req.url);
    u.searchParams.set("_mknav", Date.now());
    event.respondWith(
      fetch(u.toString(), { cache: "no-store" }).catch(() => fetch(req))
    );
    return;
  }

  event.respondWith(
    fetch(req, { cache: "no-store" }).catch(() => caches.match(req))
  );
});
