/**
 * sw.js – Service Worker für Offline-Shell-Caching (WEB-60, Phase 1 PWA).
 *
 * Strategie: "stale-while-revalidate" für alle gleichen-Origin-Assets
 * (HTML/CSS/JS/Icons/Daten-JSON). Das reicht für eine installierbare
 * PWA mit Offline-Start, ohne eine Liste aller js/-Module von Hand
 * pflegen zu müssen – neue Dateien landen beim ersten Online-Besuch
 * automatisch im Cache.
 *
 * Ausgenommen: /api/* (Live-Daten – nie aus dem Cache beantworten) und
 * alles, was nicht von diesem Origin kommt (Cesium-/vis-network-CDN,
 * Kamera-/Flugdaten-Proxys) – dort mischt sich der Browser-HTTP-Cache
 * nicht mit unserer Strategie.
 */

const CACHE_NAME = "argus-shell-v1";

// Kern-Shell, die beim Installieren sofort vorab geladen wird, damit die
// App auch offline startet. Einzeln statt per addAll() cachen, damit eine
// fehlende Datei (z. B. config.js, das lokal angelegt werden muss) die
// restliche Installation nicht abbricht.
const PRECACHE_URLS = [
    "./",
    "./index.html",
    "./style.css",
    "./manifest.json",
    "./config.example.js",
    "./assets/icons/icon-192.png",
    "./assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) =>
            Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
        ).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((names) => Promise.all(
                names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith("/api/")) return;

    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(request);
            const network = fetch(request)
                .then((response) => {
                    if (response.ok) cache.put(request, response.clone());
                    return response;
                })
                .catch(() => null);

            return cached ?? (await network) ?? Response.error();
        })
    );
});
