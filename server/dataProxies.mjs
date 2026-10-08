/**
 * dataProxies.mjs – Serverseitige Anbindung weiterer offener Datenquellen.
 *
 * Portiert aus "God's Eye View" von Bilawal Sidhu (MIT-Lizenz,
 * https://github.com/bilawalsidhu/gods-eye-view). Dort liegen die
 * entsprechenden Routen als Vite-Plugins in vite.config.js; hier sind
 * sie in eigenständige Handler für unseren schlanken Node-Server
 * umgeschrieben. Die Daten selbst stehen unter den Bedingungen der
 * jeweiligen Anbieter – siehe DATENQUELLEN.md.
 *
 * Warum serverseitig?
 *   • CelesTrak sendet keine CORS-Header
 *   • NASA FIRMS braucht einen geheimen Key
 *   • Launch Library hat ein sehr knappes Kontingent (15 Abrufe/Stunde)
 *   • Die Kamerakataloge (Caltrans, TfL, Austin) sind nicht CORS-freigegeben
 *   • Der GeoServer des Smithsonian GVP sendet keine CORS-Header
 *   • Der NOAA National Hurricane Center sendet keine CORS-Header
 *   • NASA NeoWs (Asteroiden) braucht einen Key, der nicht im Browser landen soll
 *
 * Alle Handler teilen sich denselben Cache mit "Serve-Stale": Ist die
 * Quelle gerade nicht erreichbar, wird die letzte gute Antwort geliefert,
 * statt die Karte leerzuräumen.
 */

import { countryDe, typeDe, displayName } from "./volcanoLabels.mjs";
import { readKmzAsKml, extractConePolygon } from "./kmz.mjs";

const UA = "world-viewer/2.3 (+https://github.com/)";

/* ═══════════ Gemeinsamer Cache mit Serve-Stale ═══════════ */

const cache = new Map();      // key → { at, data, contentType }
const inflight = new Map();   // key → Promise (verhindert Doppelabrufe)

/**
 * Holt eine Ressource mit Cache, Einzelflug-Sperre und Serve-Stale.
 *
 * @param {string} key      Cache-Schlüssel
 * @param {number} ttlMs    Wie lange die Antwort als frisch gilt
 * @param {Function} loader async () => ({ data, contentType })
 */
export async function cachedFetch(key, ttlMs, loader) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) {
        return { ...hit, cacheStatus: "HIT" };
    }
    if (inflight.has(key)) {
        return { ...(await inflight.get(key)), cacheStatus: "INFLIGHT" };
    }

    const task = (async () => {
        try {
            const fresh = await loader();
            const entry = { at: Date.now(), ...fresh };
            cache.set(key, entry);
            return entry;
        } catch (err) {
            // Lieber alte Daten als gar keine
            if (hit) {
                console.warn(`[data] ${key}: ${err.message} – liefere ältere Daten.`);
                return { ...hit, stale: true, warning: err.message };
            }
            throw err;
        } finally {
            inflight.delete(key);
        }
    })();

    inflight.set(key, task);
    const result = await task;
    return { ...result, cacheStatus: result.stale ? "STALE" : "MISS" };
}

/** fetch mit Zeitlimit. */
async function fetchWithTimeout(url, options = {}, timeoutMs = 15_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: { "User-Agent": UA, ...(options.headers ?? {}) }
        });
    } finally {
        clearTimeout(timer);
    }
}

/* ═══════════════════════════════════════════════════════════
   1. CelesTrak – Bahndaten (TLE) für echte Satellitenbahnen
   ═══════════════════════════════════════════════════════════ */

// Gruppen wie im Referenzprojekt. Reihenfolge = Priorität beim
// Entfernen von Dubletten (erster Treffer gewinnt).
export const TLE_GROUPS = [
    { tag: "stations", path: "stations", label: "Raumstationen" },
    { tag: "visual",   path: "visual",   label: "Mit bloßem Auge sichtbar" },
    { tag: "gps",      path: "gps-ops",  label: "GPS" },
    // Achtung: CelesTrak nennt GLONASS "glo-ops"; "glonass-operational" gibt 404
    { tag: "glonass",  path: "glo-ops",  label: "GLONASS" },
    { tag: "galileo",  path: "galileo",  label: "Galileo" },
    { tag: "geo",      path: "geo",      label: "Geostationär" },
    { tag: "starlink", path: "starlink", label: "Starlink" }
];

const TLE_TTL_MS = 6 * 60 * 60 * 1000;   // Bahndaten ändern sich langsam

export async function handleCelestrak(res, group) {
    const known = TLE_GROUPS.find(g => g.path === group);
    if (!known) {
        sendJson(res, 400, { error: `Unbekannte TLE-Gruppe: ${group}` });
        return;
    }

    try {
        const result = await cachedFetch(`tle:${group}`, TLE_TTL_MS, async () => {
            const url = new URL("https://celestrak.org/NORAD/elements/gp.php");
            url.searchParams.set("GROUP", group);
            url.searchParams.set("FORMAT", "tle");

            const upstream = await fetchWithTimeout(url, {}, 20_000);
            if (!upstream.ok) throw new Error(`CelesTrak antwortete mit ${upstream.status}`);

            const body = await upstream.text();
            // CelesTrak liefert bei Fehlern eine HTML-Seite mit Status 200 –
            // ohne diese Prüfung landet Müll im Cache
            if (!/^1 /m.test(body)) throw new Error("Antwort enthält keine TLE-Zeilen");

            return { data: body, contentType: "text/plain; charset=utf-8" };
        });

        res.writeHead(200, {
            "content-type": result.contentType,
            "cache-control": "public, max-age=3600",
            "x-cache": result.cacheStatus
        });
        res.end(result.data);

    } catch (err) {
        sendJson(res, 502, { error: `CelesTrak nicht erreichbar: ${err.message}` });
    }
}

/* ═══════════════════════════════════════════════════════════
   2. Launch Library 2 – Raketenstarts
   ═══════════════════════════════════════════════════════════ */

const LAUNCH_TTL_MS = 15 * 60 * 1000;   // Kontingent: 15 Abrufe/Stunde ohne Token

export async function handleLaunches(res) {
    try {
        const result = await cachedFetch("launches", LAUNCH_TTL_MS, async () => {
            const end = new Date();
            const start = new Date(end.getTime() - 30 * 86_400_000);

            const url = new URL("https://ll.thespacedevs.com/2.3.0/launches/");
            url.searchParams.set("net__gte", start.toISOString());
            url.searchParams.set("net__lte", end.toISOString());
            url.searchParams.set("limit", "100");
            url.searchParams.set("mode", "detailed");

            const token = process.env.LL2_API_TOKEN;
            const upstream = await fetchWithTimeout(url, {
                headers: {
                    Accept: "application/json",
                    ...(token ? { Authorization: `Token ${token}` } : {})
                }
            }, 20_000);

            if (!upstream.ok) {
                throw new Error(upstream.status === 429
                    ? "Kontingent erschöpft (15 Abrufe/Stunde ohne Token)"
                    : `Launch Library antwortete mit ${upstream.status}`);
            }

            const json = await upstream.json();
            return { data: JSON.stringify(normalizeLaunches(json)), contentType: "application/json" };
        });

        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "x-cache": result.cacheStatus
        });
        res.end(result.data);

    } catch (err) {
        sendJson(res, 502, { error: `Raketenstarts nicht abrufbar: ${err.message}` });
    }
}

/** Wandelt die LL2-Antwort in unser schlankes Format. */
function normalizeLaunches(json) {
    const rows = Array.isArray(json?.results) ? json.results : [];
    const launches = [];

    for (const launch of rows) {
        const pad = launch.pad ?? {};
        let lat = Number(pad.latitude);
        let lon = Number(pad.longitude);

        // Fallback: pad.location.coordinates ist ein "lon,lat"-String
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
            const coords = pad.location?.coordinates;
            if (coords) {
                const [cLon, cLat] = String(coords).split(",").map(Number);
                lon = cLon; lat = cLat;
            }
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        launches.push({
            id: String(launch.id ?? launch.slug ?? launch.name),
            name: launch.name ?? "Unbenannter Start",
            net: launch.net ?? launch.window_start ?? null,
            status: launch.status?.name ?? "",
            statusAbbrev: launch.status?.abbrev ?? "",
            provider: launch.launch_service_provider?.name ?? "",
            rocket: launch.rocket?.configuration?.full_name
                ?? launch.rocket?.configuration?.name ?? "",
            padName: pad.name ?? "",
            padLocation: pad.location?.name ?? "",
            missionName: launch.mission?.name ?? "",
            missionDescription: launch.mission?.description ?? "",
            orbit: launch.mission?.orbit?.name ?? "",
            imageUrl: launch.image?.image_url ?? launch.image ?? "",
            latitude: lat,
            longitude: lon
        });
    }
    return { fetchedAt: Date.now(), count: launches.length, launches };
}

/* ═══════════════════════════════════════════════════════════
   2b. Launch Library 2 – vergangene Starts (für das Zeitleisten-Replay)
   ═══════════════════════════════════════════════════════════ */

const LAUNCH_HISTORY_TTL_MS = 30 * 60 * 1000;

export async function handleLaunchesHistory(res, days) {
    const span = Math.min(Math.max(Number(days) || 30, 1), 90);

    try {
        const result = await cachedFetch(`launches:history:${span}`, LAUNCH_HISTORY_TTL_MS, async () => {
            const end = new Date();
            const start = new Date(end.getTime() - span * 86_400_000);

            // "previous" liefert bereits erfolgte Starts (net in der Vergangenheit)
            const url = new URL("https://ll.thespacedevs.com/2.3.0/launches/previous/");
            url.searchParams.set("net__gte", start.toISOString());
            url.searchParams.set("net__lte", end.toISOString());
            url.searchParams.set("limit", "100");
            url.searchParams.set("mode", "detailed");

            const token = process.env.LL2_API_TOKEN;
            const upstream = await fetchWithTimeout(url, {
                headers: {
                    Accept: "application/json",
                    ...(token ? { Authorization: `Token ${token}` } : {})
                }
            }, 20_000);

            if (!upstream.ok) {
                throw new Error(upstream.status === 429
                    ? "Kontingent erschöpft (15 Abrufe/Stunde ohne Token)"
                    : `Launch Library antwortete mit ${upstream.status}`);
            }

            const json = await upstream.json();
            return { data: JSON.stringify(normalizeLaunches(json)), contentType: "application/json" };
        });

        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "x-cache": result.cacheStatus
        });
        res.end(result.data);

    } catch (err) {
        sendJson(res, 502, { error: `Vergangene Starts nicht abrufbar: ${err.message}` });
    }
}

/* ═══════════════════════════════════════════════════════════
   2c. NASA NeoWs – Asteroiden mit Erdannäherung (WEB-75)
   ═══════════════════════════════════════════════════════════ */

const ASTEROID_TTL_MS = 6 * 60 * 60 * 1000;   // DEMO_KEY: nur 30 Abrufe/Stunde

function isoDate(d) { return d.toISOString().slice(0, 10); }

export async function handleAsteroids(res) {
    try {
        const result = await cachedFetch("asteroids", ASTEROID_TTL_MS, async () => {
            const start = new Date();
            const end = new Date(start.getTime() + 6 * 86_400_000); // Feed erlaubt max. 7 Tage

            const url = new URL("https://api.nasa.gov/neo/rest/v1/feed");
            url.searchParams.set("start_date", isoDate(start));
            url.searchParams.set("end_date", isoDate(end));
            url.searchParams.set("api_key", process.env.NASA_API_KEY || "DEMO_KEY");

            const upstream = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 20_000);

            if (!upstream.ok) {
                throw new Error(upstream.status === 429
                    ? "Kontingent erschöpft (NASA DEMO_KEY: 30 Abrufe/Stunde)"
                    : `NASA NeoWs antwortete mit ${upstream.status}`);
            }

            const json = await upstream.json();
            return { data: JSON.stringify(normalizeAsteroids(json)), contentType: "application/json" };
        });

        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "x-cache": result.cacheStatus
        });
        res.end(result.data);

    } catch (err) {
        sendJson(res, 502, { error: `Asteroiden nicht abrufbar: ${err.message}` });
    }
}

/** Wandelt die NeoWs-Feed-Antwort in unser schlankes Format. */
function normalizeAsteroids(json) {
    const byDate = json?.near_earth_objects ?? {};
    const asteroids = [];

    for (const neos of Object.values(byDate)) {
        for (const neo of neos) {
            const approach = neo.close_approach_data?.[0];
            if (!approach) continue;

            const diameterM = neo.estimated_diameter?.meters;

            asteroids.push({
                id: String(neo.id),
                name: String(neo.name ?? "").replace(/[()]/g, ""),
                hazardous: !!neo.is_potentially_hazardous_asteroid,
                diameterMinM: diameterM?.estimated_diameter_min ?? null,
                diameterMaxM: diameterM?.estimated_diameter_max ?? null,
                absoluteMagnitude: neo.absolute_magnitude_h ?? null,
                missDistanceKm: Number(approach.miss_distance?.kilometers) || null,
                missDistanceLunar: Number(approach.miss_distance?.lunar) || null,
                relativeVelocityKmh: Number(approach.relative_velocity?.kilometers_per_hour) || null,
                closeApproachDate: approach.close_approach_date_full ?? approach.close_approach_date ?? null,
                orbitingBody: approach.orbiting_body ?? null,
                jplUrl: neo.nasa_jpl_url ?? null
            });
        }
    }

    // Nächste Annäherung zuerst
    asteroids.sort((a, b) => (a.missDistanceKm ?? Infinity) - (b.missDistanceKm ?? Infinity));
    return { asteroids };
}

/* ═══════════════════════════════════════════════════════════
   3. NASA FIRMS – aktive Brände
   ═══════════════════════════════════════════════════════════ */

const FIRMS_TTL_MS = 30 * 60 * 1000;    // Kontingent schonen
const FIRMS_SOURCES = ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"];

export async function handleFires(res) {
    const key = process.env.FIRMS_MAP_KEY;
    if (!key) {
        sendJson(res, 503, {
            error: "no_key",
            message: "FIRMS_MAP_KEY ist nicht gesetzt. Kostenlos anfordern: "
                + "https://firms.modaps.eosdis.nasa.gov/api/map_key/"
        });
        return;
    }

    try {
        const result = await cachedFetch("fires", FIRMS_TTL_MS, async () => {
            const fires = [];
            let anySuccess = false;

            // Bewusst NACHEINANDER – das gemeinsame Kontingent gilt pro Key
            for (const source of FIRMS_SOURCES) {
                try {
                    // "2" = zwei Tage. days=1 meint den laufenden UTC-Tag und
                    // wäre kurz nach Mitternacht fast leer.
                    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/`
                        + `${encodeURIComponent(key)}/${source}/world/2`;
                    const upstream = await fetchWithTimeout(url, {}, 60_000);
                    if (!upstream.ok) continue;

                    const text = await upstream.text();
                    const parsed = parseFirmsCsv(text);
                    if (parsed) { fires.push(...parsed); anySuccess = true; }
                } catch (err) {
                    console.warn(`[firms] ${source}: ${err.message}`);
                }
            }
            if (!anySuccess) throw new Error("Keine FIRMS-Quelle erreichbar");

            const recent = filterTrailing24h(fires);
            return {
                data: JSON.stringify({ fetchedAt: Date.now(), count: recent.length, fires: recent }),
                contentType: "application/json"
            };
        });

        // Auch aus dem Cache nie älter als 24 Stunden ausliefern
        const payload = JSON.parse(result.data);
        payload.fires = filterTrailing24h(payload.fires);
        payload.count = payload.fires.length;

        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "x-cache": result.cacheStatus
        });
        res.end(JSON.stringify(payload));

    } catch (err) {
        sendJson(res, 502, { error: `Branddaten nicht abrufbar: ${err.message}` });
    }
}

/* ═══════════════════════════════════════════════════════════
   3b. NASA FIRMS – historische Brände (für das Zeitleisten-Replay)
   ═══════════════════════════════════════════════════════════ */

const FIRMS_HISTORY_TTL_MS = 60 * 60 * 1000;
// Die NRT-Flächenabfrage erlaubt maximal 10 Tage pro Anfrage (API-Limit)
const FIRMS_HISTORY_MAX_DAYS = 10;

export async function handleFiresHistory(res, days) {
    const key = process.env.FIRMS_MAP_KEY;
    if (!key) {
        sendJson(res, 503, {
            error: "no_key",
            message: "FIRMS_MAP_KEY ist nicht gesetzt. Kostenlos anfordern: "
                + "https://firms.modaps.eosdis.nasa.gov/api/map_key/"
        });
        return;
    }

    const span = Math.min(Math.max(Number(days) || 7, 1), FIRMS_HISTORY_MAX_DAYS);

    try {
        const result = await cachedFetch(`fires:history:${span}`, FIRMS_HISTORY_TTL_MS, async () => {
            const fires = [];
            let anySuccess = false;

            for (const source of FIRMS_SOURCES) {
                try {
                    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/`
                        + `${encodeURIComponent(key)}/${source}/world/${span}`;
                    const upstream = await fetchWithTimeout(url, {}, 60_000);
                    if (!upstream.ok) continue;

                    const text = await upstream.text();
                    const parsed = parseFirmsCsv(text);
                    if (parsed) { fires.push(...parsed); anySuccess = true; }
                } catch (err) {
                    console.warn(`[firms:history] ${source}: ${err.message}`);
                }
            }
            if (!anySuccess) throw new Error("Keine FIRMS-Quelle erreichbar");

            return {
                data: JSON.stringify({
                    fetchedAt: Date.now(),
                    days: span,
                    maxDays: FIRMS_HISTORY_MAX_DAYS,
                    count: fires.length,
                    fires
                }),
                contentType: "application/json"
            };
        });

        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "x-cache": result.cacheStatus
        });
        res.end(result.data);

    } catch (err) {
        sendJson(res, 502, { error: `Historische Branddaten nicht abrufbar: ${err.message}` });
    }
}

/**
 * FIRMS-CSV auswerten.
 * Gibt null zurück, wenn die Antwort kein CSV ist (FIRMS meldet Fehler
 * als HTML oder Klartext) – der Unterschied zwischen "Fehler" und
 * "keine Brände" trägt die ganze Fehlerlogik.
 */
function parseFirmsCsv(text) {
    if (!text || text.trimStart().startsWith("<")) return null;

    const lines = text.trim().split("\n");
    if (lines.length < 1) return null;

    const header = lines[0].split(",").map(h => h.trim());
    const col = new Map(header.map((name, i) => [name, i]));
    for (const required of ["latitude", "longitude", "acq_date", "acq_time"]) {
        if (!col.has(required)) return null;
    }

    const out = [];
    for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",");
        if (parts.length < header.length) continue;

        const lat = Number(parts[col.get("latitude")]);
        const lon = Number(parts[col.get("longitude")]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        out.push({
            latitude: lat,
            longitude: lon,
            brightness: Number(parts[col.get("bright_ti4") ?? col.get("brightness")]) || 0,
            frp: Number(parts[col.get("frp")]) || 0,
            confidence: normalizeConfidence(parts[col.get("confidence")]),
            dayNight: parts[col.get("daynight")]?.trim() ?? "",
            satellite: parts[col.get("satellite")]?.trim() ?? "",
            acquiredAt: firmsTimestamp(parts[col.get("acq_date")], parts[col.get("acq_time")])
        });
    }
    return out;
}

/** VIIRS meldet die Konfidenz als l/n/h, MODIS numerisch 0–100. */
function normalizeConfidence(raw) {
    const value = String(raw ?? "").trim().toLowerCase();
    if (value === "l") return 0.3;
    if (value === "n") return 0.6;
    if (value === "h") return 0.9;
    const num = Number(value);
    return Number.isFinite(num) ? num / 100 : 0.5;
}

/** acq_time ist NICHT mit Nullen aufgefüllt: "45" bedeutet 00:45 UTC. */
function firmsTimestamp(date, time) {
    const hhmm = String(time ?? "").trim().padStart(4, "0");
    const iso = `${String(date ?? "").trim()}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`;
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? ms : Date.now();
}

/** Nur die letzten 24 Stunden (mit 2 h Vorlauf gegen Uhrendrift). */
function filterTrailing24h(fires) {
    const now = Date.now();
    const from = now - 24 * 3600_000;
    const to = now + 2 * 3600_000;
    return (fires ?? []).filter(f => f.acquiredAt >= from && f.acquiredAt <= to);
}

/* ═══════════════════════════════════════════════════════════
   4. Öffentliche Verkehrskameras (TfL London, Caltrans, Austin)
   ═══════════════════════════════════════════════════════════ */

const CCTV_TTL_MS = 15 * 60 * 1000;
const CALTRANS_DISTRICTS = (process.env.CCTV_CALTRANS_DISTRICTS ?? "4,7,11,3")
    .split(",").map(d => d.trim()).filter(Boolean);
const CCTV_MAX_PER_SOURCE = Number(process.env.CCTV_MAX_PER_SOURCE ?? 150);

export async function handleCctvCatalog(res) {
    try {
        const result = await cachedFetch("cctv", CCTV_TTL_MS, async () => {
            const packs = await Promise.allSettled([
                loadTflCameras(),
                loadCaltransCameras(),
                loadAustinCameras()
            ]);

            const cameras = [];
            const sources = [];
            for (const pack of packs) {
                if (pack.status === "fulfilled" && pack.value.cameras.length) {
                    cameras.push(...pack.value.cameras);
                    sources.push({ name: pack.value.source, count: pack.value.cameras.length });
                } else if (pack.status === "rejected") {
                    console.warn("[cctv]", pack.reason?.message ?? pack.reason);
                }
            }
            if (!cameras.length) throw new Error("Keine Kameraquelle erreichbar");

            return {
                data: JSON.stringify({ fetchedAt: Date.now(), count: cameras.length, sources, cameras }),
                contentType: "application/json"
            };
        });

        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "x-cache": result.cacheStatus
        });
        res.end(result.data);

    } catch (err) {
        sendJson(res, 502, { error: `Kamerakatalog nicht abrufbar: ${err.message}` });
    }
}

/** TfL London JamCams – Attribution ist hier VERPFLICHTEND. */
async function loadTflCameras() {
    const appKey = process.env.TFL_APP_KEY;
    const url = "https://api.tfl.gov.uk/Place/Type/JamCam"
        + (appKey ? `?app_key=${encodeURIComponent(appKey)}` : "");

    const upstream = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
    if (!upstream.ok) throw new Error(`TfL antwortete mit ${upstream.status}`);

    const places = await upstream.json();
    const cameras = [];

    for (const place of Array.isArray(places) ? places : []) {
        const props = new Map(
            (place.additionalProperties ?? []).map(p => [p.key, p.value]));
        if (props.get("available") !== "true") continue;

        const imageUrl = props.get("imageUrl");
        // Nur die offizielle Bildquelle zulassen
        if (!imageUrl?.startsWith("https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/")) continue;
        if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) continue;

        cameras.push({
            id: `tfl-${String(place.id).replace(/^JamCams_/, "")}`,
            name: place.commonName ?? "London JamCam",
            city: "London",
            provider: "Transport for London",
            attribution: "Powered by TfL Open Data. "
                + "Contains OS data © Crown copyright and database rights",
            latitude: place.lat,
            longitude: place.lon,
            imageUrl,
            refreshSeconds: 180,
            pageUrl: "https://www.tfl.gov.uk/traffic/status"
        });
        if (cameras.length >= CCTV_MAX_PER_SOURCE) break;
    }
    return { source: "Transport for London (JamCams)", cameras };
}

/** Caltrans – Verkehrskameras kalifornischer Distrikte. */
async function loadCaltransCameras() {
    const cameras = [];

    for (const district of CALTRANS_DISTRICTS) {
        if (cameras.length >= CCTV_MAX_PER_SOURCE) break;
        try {
            const padded = String(district).padStart(2, "0");
            const url = `https://cwwp2.dot.ca.gov/data/d${district}/cctv/cctvStatusD${padded}.json`;
            const upstream = await fetchWithTimeout(url, { headers: { Accept: "application/json" } });
            if (!upstream.ok) continue;

            const json = await upstream.json();
            for (const row of json?.data ?? []) {
                const cctv = row?.cctv;
                if (!cctv || String(cctv.inService) !== "true") continue;

                const loc = cctv.location ?? {};
                const lat = Number(loc.latitude);
                const lon = Number(loc.longitude);
                const imageUrl = cctv.imageData?.static?.currentImageURL;
                if (!Number.isFinite(lat) || !Number.isFinite(lon) || !imageUrl) continue;
                // Nur die offizielle Bildquelle zulassen
                if (!imageUrl.startsWith("https://cwwp2.dot.ca.gov/")) continue;

                const code = String(loc.locationName ?? "").match(/^([A-Za-z0-9_-]+)\s*--/)?.[1];
                cameras.push({
                    id: `ca-d${district}-${code ?? cameras.length}`,
                    name: loc.locationName ?? `Caltrans D${district}`,
                    city: loc.nearbyPlace ?? "Kalifornien",
                    provider: "Caltrans",
                    attribution: "Caltrans — cwwp2.dot.ca.gov",
                    latitude: lat,
                    longitude: lon,
                    imageUrl,
                    refreshSeconds: 180,
                    pageUrl: "https://cwwp2.dot.ca.gov/vm/streamlist.htm"
                });
                if (cameras.length >= CCTV_MAX_PER_SOURCE) break;
            }
        } catch (err) {
            console.warn(`[cctv] Caltrans D${district}: ${err.message}`);
        }
    }
    return { source: "Caltrans (Kalifornien)", cameras };
}

/** City of Austin – Verkehrskameras. */
async function loadAustinCameras() {
    const url = "https://data.austintexas.gov/api/views/b4k4-adkb/rows.json?accessType=DOWNLOAD";
    const upstream = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 20_000);
    if (!upstream.ok) throw new Error(`Austin antwortete mit ${upstream.status}`);

    const payload = await upstream.json();
    const columns = (payload?.meta?.view?.columns ?? []).map(c => c.fieldName);
    const rows = payload?.data ?? [];
    const cameras = [];

    for (const row of rows) {
        const rec = {};
        columns.forEach((name, i) => { rec[name] = row[i]; });

        const id = String(rec.camera_id ?? "").trim();
        if (!/^\d+$/.test(id)) continue;
        if (rec.camera_status && rec.camera_status !== "TURNED_ON") continue;

        // Socrata liefert die Position als verschachteltes Array
        const point = rec.location;
        const lat = Number(Array.isArray(point) ? point[1] : rec.latitude);
        const lon = Number(Array.isArray(point) ? point[2] : rec.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        if (lat < 30.02 || lat > 30.58 || lon < -98.12 || lon > -97.40) continue;

        cameras.push({
            id: `austin-${id}`,
            name: rec.location_name ?? rec.camera_name ?? `Austin Kamera ${id}`,
            city: "Austin, Texas",
            provider: "City of Austin",
            attribution: "City of Austin, TX — data.austintexas.gov",
            latitude: lat,
            longitude: lon,
            imageUrl: `https://cctv.austinmobility.io/image/${encodeURIComponent(id)}.jpg`,
            refreshSeconds: 300,
            pageUrl: "https://data.austintexas.gov/d/b4k4-adkb"
        });
        if (cameras.length >= CCTV_MAX_PER_SOURCE) break;
    }
    return { source: "City of Austin", cameras };
}

/* ═══════════════════════════════════════════════════════════
   5. Vulkane – Smithsonian GVP + USGS Volcano Hazards Program
   ═══════════════════════════════════════════════════════════

   Drei Quellen werden zu einer Ampel zusammengeführt:

   a) GVP "Holocene Volcanoes" – der weltweite Katalog (1214 Vulkane).
      Wir nehmen alle mit einem Ausbruch seit 1900 als Grundgesamtheit
      der "aktiven/überwachten" Vulkane. Ändert sich fast nie → 24 h TTL.

   b) GVP "Eruptions since 1960" mit ContinuingEruption='True' – die
      global laufenden Ausbrüche. Deckt auch Länder ohne eigenes
      Observatorium ab.

   c) USGS HANS "getCapElevated" – amtliche Warnstufen mit offiziellem
      Aviation Color Code. Gilt nur für US-Vulkane, ist dort aber die
      verlässlichste Quelle und hat daher Vorrang.

   Warum serverseitig? Das GVP-GeoServer sendet KEINE CORS-Header, der
   Browser darf ihn also nicht direkt abfragen. (USGS sendet welche –
   siehe den Direktabruf-Fallback in js/layers/VolcanoLayer.js.)

   Reine Naturphänomene, kein Personenbezug, kein API-Schlüssel. */

const GVP_WFS = "https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows";
const USGS_ELEVATED = "https://volcanoes.usgs.gov/hans-public/api/volcano/getCapElevated";

const VOLCANO_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;   // Katalog ist quasi statisch
const VOLCANO_STATUS_TTL_MS = 15 * 60 * 1000;         // Warnstufen ändern sich täglich

// Nur Vulkane mit Ausbruch ab diesem Jahr gelten als "aktiv/überwacht".
// 1900 ergibt 438 von 1214 – genug für eine Weltkarte, ohne sie zuzumüllen.
const VOLCANO_MIN_ERUPTION_YEAR = 1900;

// Ein laufender Ausbruch, der innerhalb dieser Frist begann, zählt als
// "Ausbruch im Gange" (rot). Ältere Dauerausbrüche wie Stromboli (seit
// 1934) sind zwar aktiv, aber kein akutes Ereignis → orange.
const VOLCANO_FRESH_ERUPTION_MS = 365 * 86_400_000;

/** GVP-WFS-Abfrage als GeoJSON. */
async function fetchGvp(typeName, { properties, cqlFilter } = {}) {
    const url = new URL(GVP_WFS);
    url.searchParams.set("service", "WFS");
    url.searchParams.set("version", "1.0.0");
    url.searchParams.set("request", "GetFeature");
    url.searchParams.set("typeName", `GVP-VOTW:${typeName}`);
    url.searchParams.set("outputFormat", "application/json");
    if (properties) url.searchParams.set("propertyName", properties.join(","));
    if (cqlFilter) url.searchParams.set("CQL_FILTER", cqlFilter);

    const upstream = await fetchWithTimeout(url, { headers: { Accept: "application/json" } }, 45_000);
    if (!upstream.ok) throw new Error(`GVP antwortete mit ${upstream.status}`);

    // Der GeoServer meldet Fehler als XML-ServiceExceptionReport mit
    // Status 200 – ohne diese Prüfung landet eine Fehlerseite im Cache
    const text = await upstream.text();
    if (text.trimStart().startsWith("<")) {
        throw new Error(`GVP meldet einen Fehler für ${typeName}`);
    }

    const json = JSON.parse(text);
    if (!Array.isArray(json?.features)) throw new Error("GVP-Antwort ohne features");
    return json.features;
}

/** a) Weltweiter Katalog, auf die seit 1900 aktiven Vulkane reduziert. */
async function loadVolcanoCatalog() {
    const features = await fetchGvp("Smithsonian_VOTW_Holocene_Volcanoes", {
        properties: [
            "Volcano_Number", "Volcano_Name", "Country", "Region",
            "Primary_Volcano_Type", "Elevation", "Latitude", "Longitude",
            "Last_Eruption_Year", "Tectonic_Setting"
        ]
    });

    const volcanoes = [];
    for (const feature of features) {
        const p = feature.properties ?? {};
        const lastEruptionYear = Number(p.Last_Eruption_Year);
        if (!Number.isFinite(lastEruptionYear) || lastEruptionYear < VOLCANO_MIN_ERUPTION_YEAR) continue;

        const lat = Number(p.Latitude);
        const lon = Number(p.Longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const vnum = String(p.Volcano_Number);
        volcanoes.push({
            id: `volc-${vnum}`,
            vnum,
            name: displayName(p.Volcano_Name),
            country: countryDe(p.Country),
            region: p.Region ?? "",
            volcanoType: typeDe(p.Primary_Volcano_Type),
            elevation: Number(p.Elevation) || 0,
            tectonicSetting: p.Tectonic_Setting ?? "",
            lastEruptionYear,
            latitude: lat,
            longitude: lon,
            altitude: Number(p.Elevation) || 0,
            // Grundzustand: im Katalog, aber ohne aktuelles Ereignis
            status: "green",
            statusSource: "catalog",
            gvpUrl: `https://volcano.si.edu/volcano.cfm?vn=${vnum}`
        });
    }
    if (!volcanoes.length) throw new Error("GVP-Katalog lieferte keine Vulkane");
    return volcanoes;
}

/** b) Weltweit laufende Ausbrüche (GVP). */
async function loadContinuingEruptions() {
    const features = await fetchGvp("E3WebApp_Eruptions1960", {
        cqlFilter: "ContinuingEruption='True'"
    });

    // Pro Vulkan den jüngsten laufenden Ausbruch behalten
    const byVnum = new Map();
    for (const feature of features) {
        const p = feature.properties ?? {};
        const vnum = String(p.VolcanoNumber ?? "");
        if (!vnum) continue;

        const startedAt = parseGvpDate(p.StartDate);
        const previous = byVnum.get(vnum);
        if (previous && previous.startedAt >= startedAt) continue;

        byVnum.set(vnum, {
            vnum,
            name: displayName(p.VolcanoName),
            startedAt,
            startYear: Number(p.StartDateYear) || null,
            vei: Number.isFinite(Number(p.ExplosivityIndexMax)) ? Number(p.ExplosivityIndexMax) : null,
            latitude: Number(p.LatitudeDecimal),
            longitude: Number(p.LongitudeDecimal)
        });
    }
    return byVnum;
}

/** GVP liefert Datumsangaben als "JJJJMMTT"-String. */
function parseGvpDate(raw) {
    const text = String(raw ?? "").trim();
    const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
    if (!match) return 0;
    const ms = Date.parse(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    return Number.isFinite(ms) ? ms : 0;
}

/** c) Amtliche USGS-Warnstufen (nur US-Vulkane, aber maßgeblich). */
async function loadUsgsAlerts() {
    const upstream = await fetchWithTimeout(USGS_ELEVATED,
        { headers: { Accept: "application/json" } }, 20_000);
    if (!upstream.ok) throw new Error(`USGS antwortete mit ${upstream.status}`);

    const rows = await upstream.json();
    const byVnum = new Map();

    for (const row of Array.isArray(rows) ? rows : []) {
        const vnum = String(row?.vnum ?? "");
        const color = String(row?.color_code ?? "").toLowerCase();
        if (!vnum || !["green", "yellow", "orange", "red"].includes(color)) continue;

        byVnum.set(vnum, {
            vnum,
            status: color,
            alertLevel: row.alert_level ?? "",
            observatory: row.obs_fullname ?? "",
            synopsis: row.synopsis ?? "",
            noticeUrl: row.notice_url ?? "",
            sentAt: Date.parse(row.sent_date_cap ?? "") || null,
            latitude: Number(row.latitude),
            longitude: Number(row.longitude),
            elevation: Number(row.elevation_meters) || 0,
            name: row.volcano_name_appended ?? ""
        });
    }
    return byVnum;
}

/**
 * Führt Katalog, laufende Ausbrüche und USGS-Warnstufen zusammen.
 * Vorrang: USGS-Warnstufe > laufender GVP-Ausbruch > Katalog-Grundzustand.
 */
function mergeVolcanoes(catalog, eruptions, alerts) {
    const byVnum = new Map(catalog.map(v => [v.vnum, { ...v }]));
    const now = Date.now();

    // b) laufende Ausbrüche
    for (const [vnum, eruption] of eruptions) {
        const fresh = eruption.startedAt > 0 && now - eruption.startedAt < VOLCANO_FRESH_ERUPTION_MS;
        const entry = byVnum.get(vnum) ?? volcanoStub(vnum, eruption);
        if (!entry) continue;

        entry.status = fresh ? "red" : "orange";
        entry.statusSource = "gvp";
        entry.eruptionStartedAt = eruption.startedAt || null;
        entry.eruptionStartYear = eruption.startYear;
        entry.vei = eruption.vei;
        byVnum.set(vnum, entry);
    }

    // c) amtliche USGS-Warnstufen überschreiben alles
    for (const [vnum, alert] of alerts) {
        const entry = byVnum.get(vnum) ?? volcanoStub(vnum, alert);
        if (!entry) continue;

        entry.status = alert.status;
        entry.statusSource = "usgs";
        entry.alertLevel = alert.alertLevel;
        entry.observatory = alert.observatory;
        entry.synopsis = alert.synopsis;
        entry.noticeUrl = alert.noticeUrl;
        entry.alertSentAt = alert.sentAt;
        byVnum.set(vnum, entry);
    }

    // Auffällige Vulkane zuerst – der Client kappt ggf. die Liste
    const rank = { red: 0, orange: 1, yellow: 2, green: 3 };
    return [...byVnum.values()].sort((a, b) =>
        (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.name.localeCompare(b.name, "de"));
}

/**
 * Minimaleintrag für einen Vulkan, der nicht im gefilterten Katalog steht
 * (z.B. letzter Ausbruch vor 1900, aber jetzt wieder aktiv).
 * Ohne brauchbare Koordinaten lassen wir ihn weg.
 */
function volcanoStub(vnum, source) {
    const lat = Number(source.latitude);
    const lon = Number(source.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    return {
        id: `volc-${vnum}`,
        vnum,
        name: displayName(source.name) || `Vulkan ${vnum}`,
        country: "",
        region: "",
        volcanoType: "",
        elevation: Number(source.elevation) || 0,
        lastEruptionYear: null,
        latitude: lat,
        longitude: lon,
        altitude: Number(source.elevation) || 0,
        status: "green",
        statusSource: "catalog",
        gvpUrl: `https://volcano.si.edu/volcano.cfm?vn=${vnum}`
    };
}

/**
 * Baut die fertige Nutzlast. Exportiert, damit
 * scripts/build-volcano-fallback.mjs denselben Weg nutzt.
 */
export async function buildVolcanoPayload() {
    // Der Katalog ist Pflicht, die beiden Statusquellen sind optional:
    // fällt eine aus, zeigt die Karte lieber Vulkane ohne aktuelle
    // Warnstufe als gar keine.
    const catalog = await cachedFetch("volcanoes:catalog", VOLCANO_CATALOG_TTL_MS,
        async () => ({ data: await loadVolcanoCatalog() })).then(r => r.data);

    const [eruptionResult, alertResult] = await Promise.allSettled([
        loadContinuingEruptions(),
        loadUsgsAlerts()
    ]);

    const sources = [{ name: "Smithsonian GVP (Katalog)", count: catalog.length }];
    const warnings = [];

    const eruptions = eruptionResult.status === "fulfilled" ? eruptionResult.value : new Map();
    if (eruptionResult.status === "fulfilled") {
        sources.push({ name: "Smithsonian GVP (laufende Ausbrüche)", count: eruptions.size });
    } else {
        warnings.push(`Laufende Ausbrüche (GVP): ${eruptionResult.reason?.message ?? "Abruf fehlgeschlagen"}`);
    }

    const alerts = alertResult.status === "fulfilled" ? alertResult.value : new Map();
    if (alertResult.status === "fulfilled") {
        sources.push({ name: "USGS Volcano Hazards (Warnstufen)", count: alerts.size });
    } else {
        warnings.push(`USGS-Warnstufen: ${alertResult.reason?.message ?? "Abruf fehlgeschlagen"}`);
    }

    const volcanoes = mergeVolcanoes(catalog, eruptions, alerts);

    return {
        fetchedAt: Date.now(),
        count: volcanoes.length,
        minEruptionYear: VOLCANO_MIN_ERUPTION_YEAR,
        sources,
        ...(warnings.length ? { warnings } : {}),
        volcanoes
    };
}

export async function handleVolcanoes(res) {
    try {
        const result = await cachedFetch("volcanoes", VOLCANO_STATUS_TTL_MS, async () => ({
            data: JSON.stringify(await buildVolcanoPayload()),
            contentType: "application/json"
        }));

        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "x-cache": result.cacheStatus
        });
        res.end(result.data);

    } catch (err) {
        sendJson(res, 502, { error: `Vulkandaten nicht abrufbar: ${err.message}` });
    }
}

/* ═══════════════════════════════════════════════════════════
   6. NOAA NHC – Tropische Wirbelstürme (Atlantik/Ost-/Zentralpazifik)
   ═══════════════════════════════════════════════════════════

   Quelle: National Hurricane Center, öffentliche US-Regierungsdaten,
   kein Key nötig. Serverseitig nur wegen fehlender CORS-Header.

   CurrentStorms.json nennt pro aktivem System auch eine KMZ-Datei mit
   dem Vorhersagekegel ("Cone of Uncertainty"). KMZ = gezipptes KML;
   /api/storms/cone lädt und entpackt das bei Bedarf (siehe kmz.mjs). */

const NHC_CURRENT_STORMS = "https://www.nhc.noaa.gov/CurrentStorms.json";
const STORMS_TTL_MS = 15 * 60 * 1000;
const STORM_CONE_TTL_MS = 30 * 60 * 1000;

/** NHC-Beckenkürzel aus der Sturm-ID (z.B. "al062026" → "AL"). */
function basinFromStormId(id) {
    const code = String(id ?? "").slice(0, 2).toUpperCase();
    if (code === "AL") return "Atlantik";
    if (code === "EP") return "Ost-/Zentralpazifik";
    if (code === "CP") return "Zentralpazifik";
    return "–";
}

const CLASSIFICATION_LABELS = {
    TD: "Tropisches Tiefdruckgebiet",
    TS: "Tropischer Sturm",
    HU: "Hurrikan",
    STD: "Subtropisches Tiefdruckgebiet",
    STS: "Subtropischer Sturm",
    PTC: "Möglicher tropischer Wirbelsturm",
    EX: "Außertropisches System",
    LO: "Tiefdruckgebiet"
};

/** Saffir-Simpson-Kategorie, nur für Hurrikane relevant. */
function hurricaneCategory(classification, intensityKt) {
    if (classification !== "HU" || !Number.isFinite(intensityKt)) return null;
    if (intensityKt >= 137) return 5;
    if (intensityKt >= 113) return 4;
    if (intensityKt >= 96) return 3;
    if (intensityKt >= 83) return 2;
    if (intensityKt >= 64) return 1;
    return null;
}

export async function handleStorms(res) {
    try {
        const result = await cachedFetch("storms", STORMS_TTL_MS, async () => {
            const upstream = await fetchWithTimeout(NHC_CURRENT_STORMS, {
                headers: { Accept: "application/json" }
            }, 20_000);
            if (!upstream.ok) throw new Error(`NHC antwortete mit ${upstream.status}`);

            const json = await upstream.json();
            const storms = normalizeStorms(json?.activeStorms ?? []);
            return {
                data: JSON.stringify({ fetchedAt: Date.now(), count: storms.length, storms }),
                contentType: "application/json"
            };
        });

        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "x-cache": result.cacheStatus
        });
        res.end(result.data);

    } catch (err) {
        sendJson(res, 502, { error: `Sturmdaten nicht abrufbar: ${err.message}` });
    }
}

function normalizeStorms(activeStorms) {
    const storms = [];
    for (const s of activeStorms) {
        const lat = Number(s.latitudeNumeric);
        const lon = Number(s.longitudeNumeric);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const classification = String(s.classification ?? "").toUpperCase();
        const intensityKt = Number(s.intensity);

        storms.push({
            id: String(s.id),
            name: s.name ?? "Unbenannt",
            basin: basinFromStormId(s.id),
            classification,
            classificationLabel: CLASSIFICATION_LABELS[classification] ?? classification ?? "–",
            category: hurricaneCategory(classification, intensityKt),
            intensityKt: Number.isFinite(intensityKt) ? intensityKt : null,
            pressureMb: Number.isFinite(Number(s.pressure)) ? Number(s.pressure) : null,
            movementDir: Number.isFinite(Number(s.movementDir)) ? Number(s.movementDir) : null,
            movementSpeedKt: Number.isFinite(Number(s.movementSpeed)) ? Number(s.movementSpeed) : null,
            lastUpdate: s.lastUpdate ?? null,
            advisoryNum: s.publicAdvisory?.advNum ?? s.forecastAdvisory?.advNum ?? "",
            publicAdvisoryUrl: s.publicAdvisory?.url ?? "",
            coneUrl: s.trackCone?.kmzFile ?? null,
            latitude: lat,
            longitude: lon
        });
    }
    return storms;
}

/** Nur NHC-eigene KMZ-Adressen zulassen (kein offener Proxy). */
function isTrustedNhcConeUrl(raw) {
    try {
        const url = new URL(raw);
        return url.protocol === "https:"
            && url.hostname === "www.nhc.noaa.gov"
            && url.pathname.startsWith("/storm_graphics/api/")
            && url.pathname.toLowerCase().endsWith(".kmz");
    } catch {
        return false;
    }
}

export async function handleStormCone(res, coneUrl) {
    if (!isTrustedNhcConeUrl(coneUrl)) {
        sendJson(res, 400, { error: "Ungültige oder nicht erlaubte Kegel-URL" });
        return;
    }

    try {
        const result = await cachedFetch(`storm-cone:${coneUrl}`, STORM_CONE_TTL_MS, async () => {
            const upstream = await fetchWithTimeout(coneUrl, {}, 20_000);
            if (!upstream.ok) throw new Error(`NHC antwortete mit ${upstream.status}`);

            const buffer = Buffer.from(await upstream.arrayBuffer());
            const kml = readKmzAsKml(buffer);
            const coordinates = extractConePolygon(kml);
            if (!coordinates) throw new Error("Kegel-KML enthält kein Polygon");

            return {
                data: JSON.stringify({ coordinates }),
                contentType: "application/json"
            };
        });

        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "x-cache": result.cacheStatus
        });
        res.end(result.data);

    } catch (err) {
        sendJson(res, 502, { error: `Vorhersagekegel nicht abrufbar: ${err.message}` });
    }
}

/* ═══════════════════════════════════════════════════════════
   7. GDELT GEO 2.0 – globale Ereignis-Lage (Nachrichten-Layer)
   ═══════════════════════════════════════════════════════════

   GDELT durchsucht weltweite Nachrichtenmedien und geokodiert
   erwähnte Orte automatisch, komplett frei nutzbar, kein Key
   (https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/).
   Läuft über den Server, weil die API keine CORS-Header setzt.

   Vier Themen-Suchen statt einer, damit Marker nach Ereignisthema
   gruppiert werden können (Konflikt/Protest/Katastrophe/Krise) –
   nacheinander abgefragt, nicht parallel, um das gemeinsame
   Kontingent zu schonen. Schlägt ein Thema fehl, fließen einfach
   die übrigen ein statt den ganzen Layer zu leeren. */

const GDELT_GEO_BASE = "https://api.gdeltproject.org/api/v2/geo/geo";
const GDELT_TTL_MS = 14 * 60 * 1000;   // knapp unter GDELTs eigenem 15-Minuten-Takt
const GDELT_TIMESPAN_MIN = 360;        // 6 Stunden Rückblick
const GDELT_MAX_POINTS = 250;          // je Thema

const GDELT_THEMES = [
    {
        id: "conflict", label: "Konflikt",
        query: "(war OR conflict OR airstrike OR shelling OR militants OR insurgency OR clashes OR ceasefire)"
    },
    {
        id: "protest", label: "Protest",
        query: "(protest OR riot OR demonstration OR unrest OR strike OR uprising)"
    },
    {
        id: "disaster", label: "Katastrophe",
        query: "(earthquake OR flood OR wildfire OR hurricane OR typhoon OR landslide OR tsunami)"
    },
    {
        id: "crisis", label: "Krise",
        query: "(\"humanitarian crisis\" OR famine OR \"refugee crisis\" OR outbreak OR epidemic OR evacuation OR \"state of emergency\")"
    }
];

export async function handleEvents(res) {
    const collected = [];
    const cacheStatuses = [];
    let anySuccess = false;

    for (const theme of GDELT_THEMES) {
        try {
            const result = await cachedFetch(`gdelt-${theme.id}`, GDELT_TTL_MS, async () => {
                const url = `${GDELT_GEO_BASE}?query=${encodeURIComponent(theme.query)}`
                    + `&format=geojson&timespan=${GDELT_TIMESPAN_MIN}`
                    + `&maxpoints=${GDELT_MAX_POINTS}&sortby=date`;
                const upstream = await fetchWithTimeout(url, {}, 15_000);
                if (!upstream.ok) throw new Error(`GDELT antwortete mit ${upstream.status}`);

                const geojson = await upstream.json();
                const events = parseGdeltTheme(geojson, theme);
                return { data: JSON.stringify(events), contentType: "application/json" };
            });

            collected.push(...JSON.parse(result.data));
            cacheStatuses.push(`${theme.id}:${result.cacheStatus}`);
            anySuccess = true;
        } catch (err) {
            console.warn(`[gdelt] Thema "${theme.id}" nicht verfügbar: ${err.message}`);
        }
    }

    if (!anySuccess) {
        sendJson(res, 502, {
            error: "GDELT GEO 2.0 API derzeit nicht erreichbar (Wartung, Rate-Limit oder Ausfall)."
        });
        return;
    }

    res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "x-cache": cacheStatuses.join(",")
    });
    res.end(JSON.stringify({ fetchedAt: Date.now(), count: collected.length, events: collected }));
}

/** Wandelt die GeoJSON-Antwort eines Themas in unser schlankes Format. */
function parseGdeltTheme(geojson, theme) {
    const features = Array.isArray(geojson?.features) ? geojson.features : [];
    const events = [];

    for (const feature of features) {
        const [lon, lat] = feature.geometry?.coordinates ?? [];
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

        const props = feature.properties ?? {};
        const article = parseGdeltHtml(props.html);

        events.push({
            id: `gdelt-${theme.id}-${events.length}-${lat.toFixed(2)}-${lon.toFixed(2)}`,
            theme: theme.id,
            themeLabel: theme.label,
            name: props.name ?? "",
            latitude: lat,
            longitude: lon,
            count: Number(props.count) || 0,
            articleTitle: article.title,
            articleUrl: article.url,
            articleDomain: article.domain
        });
    }
    return events;
}

/**
 * Extrahiert den ersten Artikel-Link aus dem HTML-Schnipsel, den GDELT
 * pro Ort mitliefert (bis zu 5 passende Artikel als <a>-Tags).
 */
function parseGdeltHtml(html) {
    if (typeof html !== "string" || !html) return { title: "", url: "", domain: "" };

    const match = html.match(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/i);
    if (!match) return { title: "", url: "", domain: "" };

    const url = match[1];
    const title = match[2].trim();
    let domain = "";
    try { domain = new URL(url).hostname.replace(/^www\./, ""); }
    catch { /* ungültige URL ignorieren */ }

    return { title, url, domain };
}

/* ═══════════ Hilfsfunktion ═══════════ */

function sendJson(res, status, data) {
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
    });
    res.end(JSON.stringify(data));
}
