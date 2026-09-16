#!/usr/bin/env node
/**
 * server.mjs – Server für den World Viewer.
 *
 * Er erledigt drei Dinge:
 *   1. liefert die statischen Dateien der WebApp aus
 *   2. /api/flights  – Live-Flugdaten von Flightradar24 oder OpenSky
 *   3. /api/camera   – holt Webcam-Bilder und -Streams von den Originalseiten
 *   4. /api/chat     – Claude API für den KI-Assistenten
 *   5. weitere offene Datenquellen (aus "God's Eye View", MIT):
 *      /api/celestrak/:group  Bahndaten (TLE) für echte Satellitenbahnen
 *      /api/launches          Raketenstarts der letzten 30 Tage
 *      /api/fires             Aktive Brände (NASA FIRMS, Key nötig)
 *      /api/cctv              Katalog öffentlicher Verkehrskameras
 *   6. /api/ships    – echte Schiffspositionen (AIS) über AISStream.io,
 *      per dauerhafter Server-WebSocket-Verbindung mit Wachhund
 *      (server/aisStream.mjs) empfangen und zwischengespeichert
 *
 * Warum überhaupt ein Server? Weil weder Flightradar24 noch OpenSky noch
 * die Claude API CORS-Header senden – ein Browser darf sie also nicht
 * direkt aufrufen. Außerdem bleiben alle Zugangsdaten hier auf dem Server
 * und landen nie im Browser.
 *
 * ── Starten ────────────────────────────────────────────────────────
 *   Schlüssel kommen aus der Datei .env im Projektordner (nicht ins
 *   Git-Repository!) oder aus Umgebungsvariablen. Gesetzte Variablen
 *   haben Vorrang vor der .env-Datei.
 *
 *   # Live-Flugdaten von Flightradar24 (kostenpflichtiges Abo)
 *   export FR24_API_TOKEN="…"
 *
 *   # ODER kostenlos über OpenSky (Zugangsdaten optional)
 *   export OPENSKY_CLIENT_ID="…"
 *   export OPENSKY_CLIENT_SECRET="…"
 *
 *   # Optional: KI-Assistent
 *   export ANTHROPIC_API_KEY="sk-ant-…"
 *
 *   node server/server.mjs      → http://localhost:8000
 *
 * Benötigt Node.js 18+. Keine npm-Pakete nötig.
 */

// MUSS als Erstes stehen: liest .env, bevor unten process.env gelesen wird
import { loadedFromEnvFile } from "./loadEnv.mjs";

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFlights, parseBounds } from "./flightProviders.mjs";
import { handleCameraProxy, buildAllowlist, getAllowlist } from "./cameraProxy.mjs";
import {
    handleCelestrak, handleLaunches, handleFires, handleCctvCatalog, TLE_GROUPS
} from "./dataProxies.mjs";
import { startAisStream, getShips, getAisStatus } from "./aisStream.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PORT = Number(process.env.PORT ?? 8000);

/* ═══════════ Konfiguration aus Umgebungsvariablen ═══════════ */

const FR24_TOKEN = process.env.FR24_API_TOKEN ?? "";
const OPENSKY_ID = process.env.OPENSKY_CLIENT_ID ?? "";
const OPENSKY_SECRET = process.env.OPENSKY_CLIENT_SECRET ?? "";

// Anbieter: explizit gesetzt, sonst automatisch der beste verfügbare
const FLIGHT_PROVIDER = process.env.FLIGHT_PROVIDER
    ?? (FR24_TOKEN ? "fr24" : "opensky");

// Schutz vor zu vielen Abrufen: gleiche Anfrage wird für diese Zeit
// aus dem Cache beantwortet. Bei Flightradar24 kostet JEDER Abruf
// Guthaben – deshalb hier bewusst großzügig.
const MIN_FETCH_INTERVAL_MS = Number(process.env.FLIGHT_CACHE_MS
    ?? (FLIGHT_PROVIDER === "fr24" ? 30_000 : 12_000));

const MAX_AIRCRAFT = Number(process.env.FLIGHT_MAX ?? 400);

// Schiffsdaten (AIS) über AISStream.io – kostenloser Key, siehe .env.example
const AISSTREAM_API_KEY = process.env.AISSTREAM_API_KEY ?? "";
const AISSTREAM_BBOX = parseAisBbox(process.env.AISSTREAM_BBOX);
const MAX_SHIPS = Number(process.env.AISSTREAM_MAX_SHIPS ?? 1000);

function parseAisBbox(raw) {
    if (!raw) return null;
    const parts = raw.split(",").map(Number);
    if (parts.length !== 4 || parts.some(Number.isNaN)) return null;
    const [south, west, north, east] = parts;
    return { north, south, west, east };
}

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

const ALLOWED_MODELS = new Set([
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-haiku-4-5-20251001"
]);

/* Erlaubnisliste für den Kamera-Proxy aus data/cameras.json aufbauen */
function initCameraAllowlist() {
    try {
        const file = path.join(ROOT, "data", "cameras.json");
        const cameras = JSON.parse(fs.readFileSync(file, "utf8"));
        const hosts = buildAllowlist(cameras, process.env.CAMERA_HOSTS ?? "");
        return hosts;
    } catch (err) {
        console.warn("[camera] cameras.json konnte nicht gelesen werden:", err.message);
        return buildAllowlist([], process.env.CAMERA_HOSTS ?? "");
    }
}

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".ico": "image/x-icon",
    ".md": "text/markdown; charset=utf-8"
};

/* ═══════════ Hilfsfunktionen ═══════════ */

function sendJson(res, status, data) {
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
    });
    res.end(JSON.stringify(data));
}

async function readBody(req, limit = 200_000) {
    let body = "";
    for await (const chunk of req) {
        body += chunk;
        if (body.length > limit) throw Object.assign(
            new Error("Anfrage zu groß."), { status: 413 });
    }
    return body;
}

/* ═══════════ Flugdaten ═══════════ */

/**
 * Server-Cache. Schützt das Guthaben bei Flightradar24 und das
 * Tageskontingent bei OpenSky: Mehrere Browser-Tabs oder schnelle
 * Kameraschwenks lösen nicht jedes Mal einen echten Abruf aus.
 */
const flightCache = new Map();   // key → { at, payload }

/** Bounding-Box grob runden, damit kleine Kamerabewegungen den Cache treffen. */
function cacheKey(bounds) {
    const r = (v) => Math.round(v * 2) / 2;   // halbes Grad
    return `${r(bounds.north)},${r(bounds.south)},${r(bounds.west)},${r(bounds.east)}`;
}

/** Alte Cache-Einträge aufräumen, damit der Speicher nicht wächst. */
function pruneCache() {
    const cutoff = Date.now() - 10 * 60_000;
    for (const [key, entry] of flightCache) {
        if (entry.at < cutoff) flightCache.delete(key);
    }
}

async function handleFlights(req, res, query) {
    const bounds = parseBounds(query);
    if (!bounds) {
        sendJson(res, 400, {
            error: "Ungültige Bounding-Box. Erwartet: north, south, west, east."
        });
        return;
    }

    const key = cacheKey(bounds);
    const cached = flightCache.get(key);

    if (cached && Date.now() - cached.at < MIN_FETCH_INTERVAL_MS) {
        sendJson(res, 200, { ...cached.payload, cached: true });
        return;
    }

    try {
        const limit = Math.min(
            Number(query.get("limit")) || MAX_AIRCRAFT, MAX_AIRCRAFT);

        const { source, aircraft } = await fetchFlights(FLIGHT_PROVIDER, bounds, {
            token: FR24_TOKEN,
            clientId: OPENSKY_ID,
            clientSecret: OPENSKY_SECRET,
            limit
        });

        // Die interessantesten Flugzeuge zuerst: höher fliegende zuerst,
        // damit beim Abschneiden nicht nur Rollverkehr übrig bleibt.
        const trimmed = aircraft
            .filter(a => !a.onGround)
            .sort((a, b) => b.altitude - a.altitude)
            .slice(0, limit);

        const payload = {
            provider: FLIGHT_PROVIDER,
            source,
            fetchedAt: Date.now(),
            count: trimmed.length,
            totalReceived: aircraft.length,
            aircraft: trimmed,
            cached: false
        };

        flightCache.set(key, { at: Date.now(), payload });
        pruneCache();
        sendJson(res, 200, payload);

    } catch (err) {
        console.error("[flights]", err.message);
        // Bei einem Fehler notfalls die letzten bekannten Daten ausliefern,
        // damit die Karte nicht schlagartig leer wird.
        if (cached) {
            sendJson(res, 200, {
                ...cached.payload, cached: true, stale: true, warning: err.message
            });
            return;
        }
        sendJson(res, err.status ?? 502, { error: err.message, provider: FLIGHT_PROVIDER });
    }
}

/** Was ist konfiguriert? (kostet kein Guthaben) */
function handleFlightStatus(res) {
    sendJson(res, 200, {
        provider: FLIGHT_PROVIDER,
        configured: FLIGHT_PROVIDER === "fr24"
            ? !!FR24_TOKEN
            : true,                       // OpenSky geht auch ohne Konto
        authenticated: FLIGHT_PROVIDER === "fr24"
            ? !!FR24_TOKEN
            : !!(OPENSKY_ID && OPENSKY_SECRET),
        minIntervalMs: MIN_FETCH_INTERVAL_MS,
        maxAircraft: MAX_AIRCRAFT
    });
}

/* ═══════════ Schiffsdaten (AIS) ═══════════ */

function handleShips(req, res, query) {
    // Bounding-Box ist optional – ohne sie kommen alle bekannten Schiffe
    // (bis MAX_SHIPS) zurück, mit ihr nur die im Kartenausschnitt.
    const hasBoundsParams = ["north", "south", "west", "east"].some(k => query.has(k));
    const bounds = hasBoundsParams ? parseBounds(query) : null;
    if (hasBoundsParams && !bounds) {
        sendJson(res, 400, {
            error: "Ungültige Bounding-Box. Erwartet: north, south, west, east."
        });
        return;
    }

    const limit = Math.min(Number(query.get("limit")) || MAX_SHIPS, MAX_SHIPS);
    const ships = getShips(bounds, limit);

    sendJson(res, 200, {
        fetchedAt: Date.now(),
        count: ships.length,
        ships
    });
}

function handleShipsStatus(res) {
    sendJson(res, 200, getAisStatus());
}

/* ═══════════ Claude-Chat ═══════════ */

async function handleChat(req, res) {
    if (!ANTHROPIC_KEY) {
        sendJson(res, 500, {
            error: { message: "ANTHROPIC_API_KEY ist auf dem Server nicht gesetzt." }
        });
        return;
    }

    let payload;
    try {
        payload = JSON.parse(await readBody(req));
    } catch (err) {
        sendJson(res, err.status ?? 400, {
            error: { message: err.status ? err.message : "Ungültiges JSON." }
        });
        return;
    }

    const request = {
        model: ALLOWED_MODELS.has(payload.model) ? payload.model : "claude-sonnet-5",
        max_tokens: Math.min(Number(payload.max_tokens) || 1024, 4096),
        system: typeof payload.system === "string" ? payload.system.slice(0, 40_000) : undefined,
        messages: Array.isArray(payload.messages) ? payload.messages.slice(-20) : [],
        stream: true
    };

    try {
        const upstream = await fetch(ANTHROPIC_URL, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-api-key": ANTHROPIC_KEY,
                "anthropic-version": ANTHROPIC_VERSION
            },
            body: JSON.stringify(request)
        });

        if (!upstream.ok) {
            const text = await upstream.text();
            res.writeHead(upstream.status, { "content-type": "application/json" });
            res.end(text);
            return;
        }

        res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            "connection": "keep-alive",
            "x-accel-buffering": "no"
        });

        const reader = upstream.body.getReader();
        req.on("close", () => reader.cancel().catch(() => {}));

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
        }
        res.end();

    } catch (err) {
        console.error("[chat]", err);
        if (!res.headersSent) {
            sendJson(res, 502, {
                error: { message: "Claude API nicht erreichbar: " + err.message }
            });
        } else {
            res.end();
        }
    }
}

/* ═══════════ Statische Dateien ═══════════ */

function serveStatic(req, res) {
    const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let filePath = path.join(ROOT, urlPath === "/" ? "index.html" : urlPath);

    // Verzeichnis-Ausbruch verhindern (z.B. /../../etc/passwd)
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end("Forbidden");
        return;
    }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, "index.html");
    }

    // config.js steht bewusst in .gitignore (sie kann persönliche Token
    // enthalten). Damit ein frisch geklontes Projekt trotzdem sofort läuft,
    // wird ersatzweise config.example.js ausgeliefert.
    if (urlPath === "/config.js" && !fs.existsSync(filePath)) {
        filePath = path.join(ROOT, "config.example.js");
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("404 – nicht gefunden");
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        let body = data;

        // Beim Hosting sollen Token nicht in der Datei stehen, sondern als
        // Umgebungsvariable gesetzt werden. Sind sie gesetzt, werden sie hier
        // nachträglich in die ausgelieferte Konfiguration geschrieben.
        if (urlPath === "/config.js") {
            body = Buffer.concat([data, Buffer.from(configOverrideSnippet(), "utf8")]);
        }

        res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
        res.end(body);
    });
}

/**
 * Baut ein kleines JS-Schnipsel, das Werte aus Umgebungsvariablen in
 * window.WORLD_VIEWER_CONFIG nachträgt. Leere Variablen werden ignoriert,
 * damit eine lokal gepflegte config.js nicht überschrieben wird.
 */
function configOverrideSnippet() {
    const ion = (process.env.CESIUM_ION_TOKEN ?? "").trim();
    const gmaps = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
    const lines = [];

    if (ion) lines.push(`c.cesiumIonToken = ${JSON.stringify(ion)};`);
    if (gmaps) lines.push(`c.googleMapsApiKey = ${JSON.stringify(gmaps)};`);
    if (!lines.length) return "";

    return `\n/* vom Server aus Umgebungsvariablen ergänzt */\n`
        + `(function () { const c = window.WORLD_VIEWER_CONFIG; if (!c) return;\n`
        + lines.map(l => "  " + l).join("\n")
        + `\n})();\n`;
}

/* ═══════════ Server ═══════════ */

export function createServer() {
    return http.createServer((req, res) => {
        const url = new URL(req.url, "http://localhost");
        const { pathname, searchParams } = url;

        if (req.method === "OPTIONS" && pathname.startsWith("/api/")) {
            res.writeHead(204, {
                "access-control-allow-origin": "*",
                "access-control-allow-headers": "content-type",
                "access-control-allow-methods": "GET, POST, OPTIONS"
            });
            res.end();
            return;
        }

        // Bahndaten: /api/celestrak/<gruppe>
        if (pathname.startsWith("/api/celestrak/")) {
            if (req.method !== "GET") return res.writeHead(405).end();
            return handleCelestrak(res, pathname.slice("/api/celestrak/".length));
        }

        switch (pathname) {
            case "/api/flights":
                if (req.method !== "GET") return res.writeHead(405).end();
                return handleFlights(req, res, searchParams);

            case "/api/flights/status":
                return handleFlightStatus(res);

            case "/api/ships":
                if (req.method !== "GET") return res.writeHead(405).end();
                return handleShips(req, res, searchParams);

            case "/api/ships/status":
                return handleShipsStatus(res);

            case "/api/camera":
                if (req.method !== "GET") return res.writeHead(405).end();
                return handleCameraProxy(res, searchParams, "/api/camera");

            case "/api/camera/status":
                return sendJson(res, 200, { available: true, hosts: getAllowlist() });

            case "/api/launches":
                if (req.method !== "GET") return res.writeHead(405).end();
                return handleLaunches(res);

            case "/api/fires":
                if (req.method !== "GET") return res.writeHead(405).end();
                return handleFires(res);

            case "/api/cctv":
                if (req.method !== "GET") return res.writeHead(405).end();
                return handleCctvCatalog(res);

            case "/api/sources":
                // Welche Zusatzquellen sind einsatzbereit?
                return sendJson(res, 200, {
                    celestrak: true,
                    launches: true,
                    cctv: true,
                    fires: !!process.env.FIRMS_MAP_KEY,
                    ships: !!AISSTREAM_API_KEY,
                    tleGroups: TLE_GROUPS
                });

            case "/api/chat":
                if (req.method !== "POST") return res.writeHead(405).end();
                return handleChat(req, res);

            case "/api/health":
                return sendJson(res, 200, {
                    ok: true,
                    keyConfigured: !!ANTHROPIC_KEY,
                    flightProvider: FLIGHT_PROVIDER,
                    cameraProxy: true,
                    aisConfigured: !!AISSTREAM_API_KEY
                });

            default:
                return serveStatic(req, res);
        }
    });
}

/* Nur starten, wenn direkt aufgerufen (nicht beim Import in Tests) */
const isMain = process.argv[1] &&
    path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
    const cameraHosts = initCameraAllowlist();
    startAisStream({ apiKey: AISSTREAM_API_KEY, bbox: AISSTREAM_BBOX });

    createServer().listen(PORT, () => {
        console.log(`\n  🌍 World Viewer läuft auf http://localhost:${PORT}\n`);
        if (loadedFromEnvFile.length) {
            // Nur die NAMEN ausgeben, niemals die Werte
            console.log(`  🔑 .env geladen: ${loadedFromEnvFile.join(", ")}`);
        }
        console.log(`  📷 Kamera-Proxy aktiv für ${cameraHosts.length} Hosts`);

        if (FLIGHT_PROVIDER === "fr24") {
            console.log(FR24_TOKEN
                ? "  ✈️  Flugdaten: Flightradar24 (Token erkannt)"
                : "  ⚠️  Flugdaten: Flightradar24 gewählt, aber FR24_API_TOKEN fehlt.\n"
                + "     → export FR24_API_TOKEN=\"…\"  oder  FLIGHT_PROVIDER=opensky");
        } else {
            console.log(OPENSKY_ID && OPENSKY_SECRET
                ? "  ✈️  Flugdaten: OpenSky Network (angemeldet, hohes Kontingent)"
                : "  ✈️  Flugdaten: OpenSky Network (anonym – 400 Abrufe/Tag)\n"
                + "     Mehr Kontingent: kostenloses Konto anlegen und\n"
                + "     OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET setzen.");
        }
        console.log(`     Abrufintervall mind. ${MIN_FETCH_INTERVAL_MS / 1000}s, max. ${MAX_AIRCRAFT} Flugzeuge`);

        console.log("  🛰️  Bahndaten (CelesTrak) und Raketenstarts: bereit");
        console.log(process.env.FIRMS_MAP_KEY
            ? "  🔥 Brände (NASA FIRMS): bereit"
            : "  ℹ️  Brände (NASA FIRMS): kein FIRMS_MAP_KEY – Layer bleibt leer\n"
            + "     Kostenlos: https://firms.modaps.eosdis.nasa.gov/api/map_key/");
        console.log("  📹 Verkehrskameras (TfL, Caltrans, Austin): bereit");

        console.log(AISSTREAM_API_KEY
            ? "  🚢 Schiffsdaten (AISStream): Key erkannt, verbinde per WebSocket …"
            : "  ℹ️  Schiffsdaten (AISStream): kein AISSTREAM_API_KEY – Layer bleibt bei Demo-Daten\n"
            + "     Kostenlos: https://aisstream.io");

        console.log(ANTHROPIC_KEY
            ? "  ✨ KI-Assistent: bereit"
            : "  ⚠️  KI-Assistent: kein ANTHROPIC_API_KEY gesetzt");
        console.log("");
    });
}
