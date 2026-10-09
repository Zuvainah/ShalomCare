const VERSION = "shalomcare-pwa-v1";
const SHELL = VERSION + "-shell";
const ARTICLES = VERSION + "-articles";
const STATIC = ["/", "/offline.html", "/manifest.webmanifest", "/css/style.css", "/js/app.js", "/js/backend.js", "/icons/icon-192.png", "/icons/icon-512.png"];
const ARTICLE_CACHE_PREFIX = "/__approved_article__/";

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(STATIC);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("shalomcare-pwa-") && key !== SHELL && key !== ARTICLES).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data?.type === "CLEAR_APPROVED_CONTENT") {
    event.waitUntil((async () => { await caches.delete(ARTICLES); event.ports?.[0]?.postMessage({ ok: true }); })());
  }
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Only this explicit public-article refresh route is handled for offline reading.
  // Every other API, admin path, AI, clinic and symptom request remains network-only.
  const approvedArticleRequest = url.pathname === "/api/articles" && url.searchParams.get("offline") === "approved";
  if ((url.pathname.startsWith("/api/") && !approvedArticleRequest) || url.pathname.startsWith("/admin") || url.pathname.startsWith("/__approved_article__/")) return;
  if (url.pathname === "/" || url.pathname === "/index.html") {
    event.respondWith((async () => {
      try { const response = await fetch(request); if (response.ok) (await caches.open(SHELL)).put("/", response.clone()); return response; }
      catch { return (await caches.match("/")) || (await caches.match("/offline.html")); }
    })());
    return;
  }
  if (STATIC.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL), cached = await cache.match(url.pathname);
      const update = fetch(request).then(response => { if (response.ok) cache.put(url.pathname, response.clone()); return response; });
      if (cached) { event.waitUntil(update.catch(() => {})); return cached; }
      try { return await update; } catch { return new Response("Offline content is not available.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }); }
    })());
    return;
  }
  if (approvedArticleRequest) {
    event.respondWith((async () => {
      const cache = await caches.open(ARTICLES);
      try {
        const liveUrl = new URL("/api/articles?limit=50", self.location.origin);
        const response = await fetch(new Request(liveUrl, { credentials: "same-origin", cache: "no-store" }));
        if (!response.ok) throw new Error("Refresh failed");
        const payload = await response.clone().json();
        const safe = Array.isArray(payload.data) ? payload.data.filter(article => article && typeof article.id === "string" && typeof article.title === "string" && typeof article.summary === "string" && typeof article.body === "string" && article.is_demo !== 1 && article.status !== "draft") : [];
        const timestamp = new Date().toISOString();
        for (const key of await cache.keys()) await cache.delete(key);
        for (const article of safe) {
          const responseArticle = new Response(JSON.stringify({ data: { ...article, offlineCachedAt: timestamp, stale: false } }), { headers: { "content-type": "application/json; charset=utf-8" } });
          await cache.put(ARTICLE_CACHE_PREFIX + encodeURIComponent(article.id), responseArticle);
        }
        return new Response(JSON.stringify({ data: safe.map(article => ({ ...article, offlineCachedAt: timestamp, stale: false })) }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-shalomcare-content-state": "fresh" } });
      } catch {
        const cached = (await cache.keys()).filter(key => new URL(key.url).pathname.startsWith(ARTICLE_CACHE_PREFIX));
        const data = [];
        for (const key of cached) { const item = await (await cache.match(key)).json(); data.push({ ...item.data, stale: true }); }
        if (!data.length) return new Response(JSON.stringify({ error: { code: "offline_content_missing", message: "Approved articles could not be refreshed and no offline copy is available. Reconnect to load approved information." } }), { status: 503, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-shalomcare-content-state": "missing" } });
        return new Response(JSON.stringify({ data, stale: true, refreshFailed: true }), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-shalomcare-content-state": "stale" } });
      }
    })());
  }
});
