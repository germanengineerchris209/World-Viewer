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
 *
 * Alle Handler teilen sich denselben Cache mit "Serve-Stale": Ist die
 * Quelle gerade nicht erreichbar, wird die letzte gute Antwort geliefert,
 * statt die Karte leerzuräumen.
 */

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

/* ═══════════ Hilfsfunktion ═══════════ */

function sendJson(res, status, data) {
    res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
    });
    res.end(JSON.stringify(data));
}
