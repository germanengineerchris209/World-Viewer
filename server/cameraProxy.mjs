/**
 * cameraProxy.mjs – Holt Kamerabilder und -streams serverseitig.
 *
 * WOZU?
 * Viele Webcam-Betreiber verhindern, dass ihre Bilder auf fremden Seiten
 * erscheinen:
 *   • kein CORS-Header       → der Browser darf das Bild nicht auslesen
 *   • Hotlink-Schutz         → ohne passenden Referer kommt ein 403
 *   • X-Frame-Options        → die Seite lässt sich nicht als iframe einbetten
 *
 * Dieser Proxy holt die Ressource stattdessen vom Server aus, setzt einen
 * passenden Referer und liefert sie mit CORS-Headern an die WebApp aus.
 * Damit lassen sich Kameras einbinden, die sonst nur auf der Originalseite
 * funktionieren.
 *
 * SICHERHEIT – wichtig, sonst wäre das ein offener Proxy:
 *   1. Nur Hosts aus einer Erlaubnisliste (wird beim Start aus
 *      data/cameras.json gebildet, erweiterbar über CAMERA_HOSTS).
 *   2. Keine privaten oder lokalen IP-Adressen (Schutz vor SSRF, also vor
 *      Zugriffen ins eigene Netz).
 *   3. Nur Bilder und Streamformate, begrenzte Größe, kurze Zwischenspeicherung.
 */

import dns from "node:dns/promises";
import net from "node:net";

/* ═══════════ Erlaubte Inhaltstypen ═══════════ */

const IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp|gif|avif)/i;
const HLS_TYPES = /^(application\/(vnd\.apple\.mpegurl|x-mpegurl)|audio\/mpegurl|text\/plain)/i;
const SEGMENT_TYPES = /^(video\/mp2t|application\/octet-stream|video\/mp4)/i;

const MAX_BYTES = 12 * 1024 * 1024;      // 12 MB Obergrenze pro Antwort
const FETCH_TIMEOUT_MS = 12_000;
const CACHE_MS = 2_000;                  // Quelle nicht unnötig oft anfragen

/* ═══════════ Erlaubnisliste ═══════════ */

const allowedHosts = new Set();

/**
 * Baut die Erlaubnisliste aus den Kameradaten.
 * Nur Hosts, die dort vorkommen, dürfen später abgerufen werden.
 *
 * @param {Array} cameras  Inhalt von data/cameras.json
 * @param {string} extra   zusätzliche Hosts, kommagetrennt (CAMERA_HOSTS)
 */
export function buildAllowlist(cameras = [], extra = "") {
    allowedHosts.clear();

    const addUrl = (value) => {
        if (typeof value !== "string" || !value.startsWith("http")) return;
        try { allowedHosts.add(new URL(value).hostname.toLowerCase()); }
        catch { /* ungültige URL ignorieren */ }
    };

    const scanStream = (stream) => {
        if (!stream || typeof stream !== "object") return;
        addUrl(stream.url);
        addUrl(stream.pageUrl);
        addUrl(stream.referer);
    };

    for (const cam of cameras) {
        scanStream(cam.stream);
        if (Array.isArray(cam.streams)) cam.streams.forEach(scanStream);
    }

    for (const host of String(extra).split(",")) {
        const clean = host.trim().toLowerCase();
        if (clean) allowedHosts.add(clean);
    }

    return [...allowedHosts];
}

export function getAllowlist() { return [...allowedHosts]; }

/** Ist der Host erlaubt? Subdomains eines erlaubten Hosts zählen mit. */
function isAllowedHost(hostname) {
    const host = hostname.toLowerCase();
    if (allowedHosts.has(host)) return true;
    for (const allowed of allowedHosts) {
        if (host.endsWith("." + allowed)) return true;
    }
    return false;
}

/* ═══════════ Schutz vor Zugriffen ins lokale Netz ═══════════ */

/** Liegt die IP in einem privaten/reservierten Bereich? */
function isPrivateAddress(ip) {
    if (net.isIPv4(ip)) {
        const [a, b] = ip.split(".").map(Number);
        return a === 10
            || a === 127
            || a === 0
            || (a === 172 && b >= 16 && b <= 31)
            || (a === 192 && b === 168)
            || (a === 169 && b === 254)        // Link-Local / Cloud-Metadaten
            || (a === 100 && b >= 64 && b <= 127);
    }
    if (net.isIPv6(ip)) {
        const v = ip.toLowerCase();
        if (v === "::1" || v === "::") return true;
        if (v.startsWith("fc") || v.startsWith("fd")) return true;   // unique local
        if (v.startsWith("fe80")) return true;                        // link local
        // IPv4-gemappte Adressen mitprüfen
        const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
        if (mapped) return isPrivateAddress(mapped[1]);
    }
    return false;
}

/** Löst den Host auf und lehnt private Ziele ab. */
async function assertPublicHost(rawHostname) {
    // URL-Parsing liefert IPv6-Adressen in eckigen Klammern ("[::1]")
    const hostname = rawHostname.replace(/^\[|\]$/g, "");

    if (net.isIP(hostname)) {
        if (isPrivateAddress(hostname)) {
            throw Object.assign(new Error("Zieladresse ist nicht öffentlich."), { status: 403 });
        }
        return;
    }

    let records;
    try {
        records = await dns.lookup(hostname, { all: true });
    } catch {
        throw Object.assign(new Error("Host nicht auflösbar."), { status: 502 });
    }
    if (records.some(r => isPrivateAddress(r.address))) {
        throw Object.assign(new Error("Zieladresse ist nicht öffentlich."), { status: 403 });
    }
}

/* ═══════════ Prüfung und Abruf ═══════════ */

/** Prüft die angeforderte URL vollständig. */
async function validateTarget(raw) {
    let url;
    try {
        url = new URL(raw);
    } catch {
        throw Object.assign(new Error("Ungültige URL."), { status: 400 });
    }

    if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw Object.assign(new Error("Nur http(s) erlaubt."), { status: 400 });
    }
    if (!isAllowedHost(url.hostname)) {
        throw Object.assign(
            new Error(`Host '${url.hostname}' steht nicht in der Erlaubnisliste. `
                + "Kamera in data/cameras.json eintragen oder CAMERA_HOSTS erweitern."),
            { status: 403 }
        );
    }
    await assertPublicHost(url.hostname);
    return url;
}

/** Kleiner Zwischenspeicher, damit die Quelle nicht überlastet wird. */
const cache = new Map();   // url → { at, status, type, body }

function pruneCache() {
    const cutoff = Date.now() - 60_000;
    for (const [key, entry] of cache) if (entry.at < cutoff) cache.delete(key);
}

/**
 * Holt die Ressource von der Kameraseite.
 * @param {URL} url
 * @param {string} referer  Referer-Header (überlistet Hotlink-Sperren)
 */
async function fetchUpstream(url, referer) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const res = await fetch(url, {
            signal: controller.signal,
            redirect: "follow",
            headers: {
                // Ohne passenden Referer liefern viele Webcams ein 403
                "Referer": referer || url.origin + "/",
                "User-Agent": "Mozilla/5.0 (compatible; WorldViewer/2.2; +local)",
                "Accept": "image/avif,image/webp,image/jpeg,image/png,*/*;q=0.8"
            }
        });

        if (!res.ok) {
            throw Object.assign(
                new Error(`Kameraquelle antwortete mit ${res.status}.`),
                { status: res.status === 404 ? 404 : 502 }
            );
        }

        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
        const buffer = Buffer.from(await res.arrayBuffer());

        if (buffer.byteLength > MAX_BYTES) {
            throw Object.assign(new Error("Antwort zu groß."), { status: 413 });
        }
        return { type, buffer, finalUrl: new URL(res.url || url) };

    } catch (err) {
        if (err.name === "AbortError") {
            throw Object.assign(new Error("Zeitüberschreitung bei der Kameraquelle."),
                { status: 504 });
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Schreibt die Segment-URLs einer HLS-Playlist so um, dass auch sie
 * über diesen Proxy laufen – sonst blockiert der Browser sie wieder.
 */
function rewritePlaylist(text, baseUrl, proxyPath, referer) {
    const toProxy = (target) => {
        let abs;
        try { abs = new URL(target, baseUrl).toString(); }
        catch { return target; }
        const params = new URLSearchParams({ url: abs });
        if (referer) params.set("referer", referer);
        return `${proxyPath}?${params.toString()}`;
    };

    return text.split("\n").map(line => {
        const trimmed = line.trim();
        if (!trimmed) return line;

        // Attribut-URIs (z.B. bei Verschlüsselung oder Untertiteln)
        if (trimmed.startsWith("#")) {
            return line.replace(/URI="([^"]+)"/g, (_m, uri) => `URI="${toProxy(uri)}"`);
        }
        // Normale Zeilen sind Segment- oder Playlist-Adressen
        return toProxy(trimmed);
    }).join("\n");
}

/* ═══════════ Einstiegspunkt ═══════════ */

/**
 * Behandelt eine Anfrage an /api/camera.
 *
 * @param {http.ServerResponse} res
 * @param {URLSearchParams} query  url= (Pflicht), referer= (optional)
 * @param {string} proxyPath       eigener Pfad, für Playlist-Umschreibung
 */
export async function handleCameraProxy(res, query, proxyPath = "/api/camera") {
    const raw = query.get("url");
    if (!raw) {
        res.writeHead(400, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: "Parameter 'url' fehlt." }));
        return;
    }

    try {
        const url = await validateTarget(raw);

        // Referer nur übernehmen, wenn er auf einen erlaubten Host zeigt
        let referer = query.get("referer") || "";
        if (referer) {
            try {
                const refHost = new URL(referer).hostname;
                if (!isAllowedHost(refHost)) referer = "";
            } catch { referer = ""; }
        }
        if (!referer) referer = url.origin + "/";

        const cacheKey = `${url.toString()}|${referer}`;
        const cached = cache.get(cacheKey);

        let type, buffer, finalUrl;
        if (cached && Date.now() - cached.at < CACHE_MS) {
            ({ type, buffer, finalUrl } = cached);
        } else {
            ({ type, buffer, finalUrl } = await fetchUpstream(url, referer));
            cache.set(cacheKey, { at: Date.now(), type, buffer, finalUrl });
            pruneCache();
        }

        const isHls = HLS_TYPES.test(type) || /\.m3u8($|\?)/i.test(url.pathname);

        if (isHls) {
            const rewritten = rewritePlaylist(
                buffer.toString("utf8"), finalUrl, proxyPath, referer);
            res.writeHead(200, {
                "content-type": "application/vnd.apple.mpegurl",
                "access-control-allow-origin": "*",
                "cache-control": "no-store"
            });
            res.end(rewritten);
            return;
        }

        if (!IMAGE_TYPES.test(type) && !SEGMENT_TYPES.test(type)) {
            throw Object.assign(
                new Error(`Nicht unterstützter Inhaltstyp: ${type || "unbekannt"}. `
                    + "Der Proxy liefert nur Bilder und Streams."),
                { status: 415 }
            );
        }

        res.writeHead(200, {
            "content-type": type,
            "content-length": buffer.byteLength,
            "access-control-allow-origin": "*",
            // Kamerabilder sollen nicht im Browser-Cache hängenbleiben
            "cache-control": "no-store, max-age=0"
        });
        res.end(buffer);

    } catch (err) {
        const status = err.status ?? 502;
        res.writeHead(status, {
            "content-type": "application/json; charset=utf-8",
            "access-control-allow-origin": "*"
        });
        res.end(JSON.stringify({ error: err.message }));
    }
}
