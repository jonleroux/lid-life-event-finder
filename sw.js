/* =========================================================
   Lid Life Event Finder v2 — Service Worker
   Cache-first for app shell · Network-first for event data
   ========================================================= */

var CACHE = "lidlife-v2-5";

var SHELL = [
  "/",
  "/index.html",
  "/css/styles.css?v=4",
  "/js/app.js?v=4",
  "/lib/leaflet.js",
  "/lib/leaflet.css",
  "/lib/marker-icon.png",
  "/lib/marker-icon-2x.png",
  "/lib/marker-shadow.png",
  "/assets/logo.png",
  "/assets/icons/icon-apple.png",
  "/assets/icons/icon-192.png",
  "/assets/icons/icon-512.png",
  "/manifest.json"
];

// Install — pre-cache the app shell
self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL);
    })
  );
  self.skipWaiting();
});

// Activate — delete old caches
self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k)   { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// Fetch
self.addEventListener("fetch", function (e) {
  var url = e.request.url;

  // Event data — network first, fall back to cache
  if (url.indexOf("events.json") !== -1) {
    e.respondWith(
      fetch(e.request).catch(function () {
        return caches.match(e.request);
      })
    );
    return;
  }

  // External APIs (geocoding, tiles) — network only, fail silently
  if (url.indexOf("postcodes.io") !== -1 ||
      url.indexOf("nominatim")    !== -1 ||
      url.indexOf("cartocdn.com") !== -1 ||
      url.indexOf("wa.me")        !== -1) {
    e.respondWith(fetch(e.request).catch(function () {
      return new Response("", { status: 503 });
    }));
    return;
  }

  // App shell — cache first, network fallback
  e.respondWith(
    caches.match(e.request).then(function (cached) {
      return cached || fetch(e.request).then(function (response) {
        if (response && response.status === 200 && response.type === "basic") {
          var clone = response.clone();
          caches.open(CACHE).then(function (c) { c.put(e.request, clone); });
        }
        return response;
      });
    })
  );
});
