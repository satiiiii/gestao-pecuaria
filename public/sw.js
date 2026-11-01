const CACHE = "pecuaria-shell-v1";
const FILES = ["/", "/index.html", "/styles.css", "/app.mjs", "/db.mjs", "/domain.mjs", "/sync-core.mjs", "/icon.svg", "/manifest.webmanifest"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES))));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith("pecuaria-shell-") && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Dados autenticados nunca entram no cache HTTP do aplicativo.
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/index.html")));
  } else if (FILES.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});
