import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

const root = resolve(new URL("..", import.meta.url).pathname);
const source = await readFile(resolve(root, "web/sw.js"), "utf8");

function workerHarness(fetcher) {
  const listeners = {}, stores = new Map();
  const cacheFor = name => {
    if (!stores.has(name)) stores.set(name, new Map());
    const data = stores.get(name);
    return {
      async addAll(urls) { for (const url of urls) data.set(new URL(url, "https://app.test").href, new Response("shell")); },
      async put(key, response) { data.set(typeof key === "string" ? new URL(key, "https://app.test").href : key.url, response.clone()); },
      async match(key) { return data.get(typeof key === "string" ? new URL(key, "https://app.test").href : key.url)?.clone(); },
      async keys() { return [...data.keys()].map(url => new Request(url)); },
      async delete(key) { return data.delete(typeof key === "string" ? new URL(key, "https://app.test").href : key.url); },
    };
  };
  const caches = { async open(name) { return cacheFor(name); }, async keys() { return [...stores.keys()]; }, async delete(name) { return stores.delete(name); }, async match(key) { for (const name of stores.keys()) { const hit = await cacheFor(name).match(key); if (hit) return hit; } } };
  const self = { location: new URL("https://app.test/"), clients: { claim: async () => {} }, skipWaiting: async () => {}, addEventListener(type, fn) { listeners[type] = fn; } };
  runInNewContext(source, { self, caches, fetch: (...args) => fetcher(...args), URL, Request, Response, Date, Promise, setTimeout, clearTimeout, encodeURIComponent, console });
  return { listeners, stores, caches, self };
}
function eventFor(request) { return { request, respondWith(promise) { this.response = promise; }, waitUntil(promise) { this.wait = promise; } }; }

test("PWA caches only approved public articles and returns visibly stale content offline", async () => {
  const h = workerHarness(async () => Response.json({ data: [
    { id: "approved", title: "Approved", summary: "Public", body: "Reviewed", status: "approved", is_demo: 0 },
    { id: "draft", title: "Draft", summary: "private draft", body: "draft", status: "draft", is_demo: 0 },
    { id: "demo", title: "Demo", summary: "placeholder", body: "demo", status: "approved", is_demo: 1 },
  ] }));
  const event = eventFor(new Request("https://app.test/api/articles?offline=approved"));
  h.listeners.fetch(event);
  const response = await event.response;
  const body = await response.json();
  assert.equal(response.headers.get("x-shalomcare-content-state"), "fresh");
  assert.deepEqual(body.data.map(a => a.id), ["approved"]);
  assert.ok(body.data[0].offlineCachedAt);
  const articleKeys = await (await h.caches.open("shalomcare-pwa-v1-articles")).keys();
  assert.equal(articleKeys.length, 1);

  const offline = workerHarness(async () => { throw new Error("offline"); });
  offline.stores.set("shalomcare-pwa-v1-articles", h.stores.get("shalomcare-pwa-v1-articles"));
  const retry = eventFor(new Request("https://app.test/api/articles?offline=approved"));
  offline.listeners.fetch(retry);
  const staleResponse = await retry.response, stale = await staleResponse.json();
  assert.equal(staleResponse.headers.get("x-shalomcare-content-state"), "stale");
  assert.equal(stale.data[0].stale, true);
  assert.ok(stale.data[0].offlineCachedAt);
});

test("missing cached content reports failure, private APIs are never intercepted, and user can clear article cache", async () => {
  const h = workerHarness(async () => { throw new Error("offline"); });
  const missing = eventFor(new Request("https://app.test/api/articles?offline=approved"));
  h.listeners.fetch(missing);
  assert.equal((await missing.response).status, 503);
  for (const path of ["/api/assistant", "/api/admin/articles", "/api/symptoms/questions", "/api/facilities"]) {
    const request = eventFor(new Request("https://app.test" + path));
    h.listeners.fetch(request);
    assert.equal(request.response, undefined, path + " must remain network-only");
  }
  h.stores.set("shalomcare-pwa-v1-articles", new Map([["https://app.test/__approved_article__/x", new Response("cached")]]));
  let cleared = false;
  const message = { data: { type: "CLEAR_APPROVED_CONTENT" }, ports: [{ postMessage(value) { cleared = value.ok; } }], waitUntil(promise) { this.wait = promise; } };
  h.listeners.message(message); await message.wait;
  assert.equal(cleared, true);
  assert.equal(h.stores.has("shalomcare-pwa-v1-articles"), false);
});

test("app update removes old cache versions but retains current version", async () => {
  const h = workerHarness(async () => new Response("unused"));
  h.stores.set("shalomcare-pwa-v0-shell", new Map());
  h.stores.set("shalomcare-pwa-v0-articles", new Map());
  h.stores.set("unrelated-cache", new Map());
  const event = { waitUntil(promise) { this.wait = promise; } };
  h.listeners.activate(event); await event.wait;
  assert.equal(h.stores.has("shalomcare-pwa-v0-shell"), false);
  assert.equal(h.stores.has("shalomcare-pwa-v0-articles"), false);
  assert.equal(h.stores.has("unrelated-cache"), true);
});
