/**
 * flightProviders.mjs – Live-Flugdaten von externen Diensten holen.
 *
 * WARUM SERVERSEITIG?
 * Weder Flightradar24 noch OpenSky senden CORS-Header. Ein Browser kann
 * diese APIs deshalb NICHT direkt aufrufen. Außerdem gehören die
 * Zugangsdaten nicht in den Browser. Beides löst dieser Server.
 *
 * Unterstützte Anbieter:
 *
 *   fr24     Flightradar24 (offizielle API, kostenpflichtig)
 *            → https://fr24api.flightradar24.com
 *            → Token als ANTHROPIC-artige Umgebungsvariable FR24_API_TOKEN
 *            → beste Datenqualität: Route, Registrierung, Flugnummer, ETA
 *
 *   adsb.lol ADS-B-Daten einer offenen Empfängergemeinschaft (kostenlos,
 *            kein Konto). Regional um einen Punkt statt weltweit.
 *            Übernommen aus "God's Eye View" (MIT, Bilawal Sidhu).
 *
 *   opensky  OpenSky Network (kostenlos, auch ohne Anmeldung nutzbar)
 *            → https://opensky-network.org/api/states/all
 *            → optional OAuth2 (OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET)
 *              für ein deutlich höheres Tageskontingent
 *            → liefert Position, Höhe, Speed, Kurs – aber keine Route
 *
 * Beide Anbieter liefern hier dasselbe einheitliche Format zurück,
 * damit die WebApp nichts über den Anbieter wissen muss.
 */

/* ═════════════ Hilfsfunktionen ═════════════ */

const KNOTS_TO_KMH = 1.852;
const FEET_TO_M = 0.3048;

/** Begrenzt einen Wert auf einen gültigen Bereich. */
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

/**
 * Prüft und normalisiert eine Bounding-Box aus der Anfrage.
 * Erwartet: north, south, west, east (Grad)
 */
export function parseBounds(query) {
    const n = clamp(parseFloat(query.get("north")), -90, 90);
    const s = clamp(parseFloat(query.get("south")), -90, 90);
    const w = clamp(parseFloat(query.get("west")), -180, 180);
    const e = clamp(parseFloat(query.get("east")), -180, 180);

    if ([n, s, w, e].some(Number.isNaN)) return null;
    if (n <= s) return null;

    return { north: n, south: s, west: w, east: e };
}

/**
 * Einheitliches Ausgabeformat für ein Flugzeug.
 * Alle Einheiten metrisch: Höhe in Metern, Geschwindigkeit in km/h.
 */
function makeAircraft(fields) {
    return {
        id: fields.id,
        callsign: fields.callsign || fields.id,
        latitude: fields.latitude,
        longitude: fields.longitude,
        altitude: fields.altitude ?? 0,        // Meter
        speed: fields.speed ?? 0,              // km/h
        heading: fields.heading ?? 0,          // Grad
        verticalRate: fields.verticalRate ?? 0,// m/s
        onGround: !!fields.onGround,
        registration: fields.registration || "",
        aircraftType: fields.aircraftType || "",
        airline: fields.airline || "",
        flightNumber: fields.flightNumber || "",
        origin: fields.origin || "",
        destination: fields.destination || "",
        squawk: fields.squawk || "",
        country: fields.country || "",
        timestamp: fields.timestamp || Date.now()
    };
}

/* ═════════════ Flightradar24 ═════════════ */

const FR24_BASE = "https://fr24api.flightradar24.com";

/**
 * Holt Live-Positionen von der offiziellen Flightradar24-API.
 *
 * @param {object} bounds  {north, south, west, east}
 * @param {object} opts    { token, limit }
 */
export async function fetchFlightradar24(bounds, opts) {
    if (!opts.token) {
        throw Object.assign(
            new Error("FR24_API_TOKEN ist nicht gesetzt. " +
                "Token unter https://fr24api.flightradar24.com anlegen " +
                "oder in config.js auf den Anbieter 'opensky' wechseln."),
            { status: 401 }
        );
    }

    // Flightradar24 erwartet die Reihenfolge: nord, süd, west, ost
    const box = [bounds.north, bounds.south, bounds.west, bounds.east]
        .map(v => v.toFixed(4)).join(",");

    const url = new URL(`${FR24_BASE}/api/live/flight-positions/full`);
    url.searchParams.set("bounds", box);
    if (opts.limit) url.searchParams.set("limit", String(opts.limit));

    const res = await fetch(url, {
        headers: {
            "Accept": "application/json",
            "Accept-Version": "v1",
            "Authorization": `Bearer ${opts.token}`
        }
    });

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw Object.assign(
            new Error(describeFr24Error(res.status, body)),
            { status: res.status }
        );
    }

    const json = await res.json();
    // Die API antwortet mit { data: [...] }; ältere/andere Varianten
    // liefern direkt ein Array – beides wird akzeptiert.
    const rows = Array.isArray(json) ? json : (json.data ?? []);

    return rows.map(normalizeFr24Row).filter(Boolean);
}

function describeFr24Error(status, body) {
    const detail = body ? ` – ${body.slice(0, 300)}` : "";
    switch (status) {
        case 401: return "Flightradar24: Token ungültig oder abgelaufen (401)." + detail;
        case 402: return "Flightradar24: Guthaben (Credits) aufgebraucht (402)." + detail;
        case 403: return "Flightradar24: Dieser Endpunkt ist im Abo nicht enthalten (403)." + detail;
        case 429: return "Flightradar24: Zu viele Anfragen (429). Abrufintervall erhöhen." + detail;
        default:  return `Flightradar24: Fehler ${status}.` + detail;
    }
}

/**
 * Wandelt einen FR24-Datensatz ins einheitliche Format.
 * Feldnamen werden defensiv gelesen, damit kleinere API-Änderungen
 * nicht sofort alles lahmlegen.
 */
function normalizeFr24Row(row) {
    const lat = row.lat ?? row.latitude;
    const lon = row.lon ?? row.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") return null;

    // FR24 liefert Höhe in Fuß und Geschwindigkeit in Knoten
    const altFt = row.alt ?? row.altitude ?? 0;
    const gspeedKt = row.gspeed ?? row.ground_speed ?? row.speed ?? 0;
    const vspeedFpm = row.vspeed ?? row.vertical_speed ?? 0;

    const origin = row.orig_iata || row.orig_icao || "";
    const dest = row.dest_iata || row.dest_icao || "";

    return makeAircraft({
        id: String(row.fr24_id ?? row.id ?? row.hex ?? row.callsign),
        callsign: (row.callsign ?? row.flight ?? "").trim(),
        latitude: lat,
        longitude: lon,
        altitude: altFt * FEET_TO_M,
        speed: gspeedKt * KNOTS_TO_KMH,
        heading: row.track ?? row.heading ?? 0,
        verticalRate: (vspeedFpm * FEET_TO_M) / 60,
        onGround: altFt < 50,
        registration: row.reg ?? row.registration ?? "",
        aircraftType: row.type ?? row.aircraft_type ?? "",
        airline: row.painted_as ?? row.operating_as ?? "",
        flightNumber: row.flight ?? "",
        origin,
        destination: dest,
        squawk: row.squawk ? String(row.squawk) : "",
        timestamp: row.timestamp ? Date.parse(row.timestamp) || Date.now() : Date.now()
    });
}

/* ═════════════ OpenSky Network ═════════════ */

const OPENSKY_API = "https://opensky-network.org/api/states/all";
const OPENSKY_TOKEN_URL =
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";

// Zugriffstoken zwischenspeichern – es ist rund 30 Minuten gültig
let openskyToken = { value: null, expiresAt: 0 };

/** Holt (und cacht) ein OAuth2-Token für OpenSky. */
async function getOpenskyToken(clientId, clientSecret) {
    if (openskyToken.value && Date.now() < openskyToken.expiresAt) {
        return openskyToken.value;
    }

    const body = new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret
    });

    const res = await fetch(OPENSKY_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw Object.assign(
            new Error(`OpenSky-Anmeldung fehlgeschlagen (${res.status}). ${text.slice(0, 200)}`),
            { status: 401 }
        );
    }

    const json = await res.json();
    openskyToken = {
        value: json.access_token,
        // 60 Sekunden Sicherheitsabstand vor dem Ablauf
        expiresAt: Date.now() + ((json.expires_in ?? 1800) - 60) * 1000
    };
    return openskyToken.value;
}

/**
 * Holt Live-Positionen vom OpenSky Network.
 * Funktioniert auch ohne Zugangsdaten (dann kleineres Tageskontingent).
 */
export async function fetchOpenSky(bounds, opts) {
    const url = new URL(OPENSKY_API);
    url.searchParams.set("lamin", bounds.south.toFixed(4));
    url.searchParams.set("lamax", bounds.north.toFixed(4));
    url.searchParams.set("lomin", bounds.west.toFixed(4));
    url.searchParams.set("lomax", bounds.east.toFixed(4));

    const headers = { Accept: "application/json" };

    if (opts.clientId && opts.clientSecret) {
        const token = await getOpenskyToken(opts.clientId, opts.clientSecret);
        headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        const message = res.status === 429
            ? "OpenSky: Tageskontingent erschöpft oder zu viele Anfragen (429). " +
              "Mit einem kostenlosen Konto (OPENSKY_CLIENT_ID/SECRET) gibt es deutlich mehr Kontingent."
            : `OpenSky: Fehler ${res.status}. ${text.slice(0, 200)}`;
        throw Object.assign(new Error(message), { status: res.status });
    }

    const json = await res.json();
    const states = json.states ?? [];
    const stamp = (json.time ?? Math.floor(Date.now() / 1000)) * 1000;

    return states.map(s => normalizeOpenskyState(s, stamp)).filter(Boolean);
}

/**
 * Wandelt einen OpenSky-"State Vector" ins einheitliche Format.
 * Feldreihenfolge laut OpenSky-Doku:
 * 0 icao24, 1 callsign, 2 origin_country, 3 time_position, 4 last_contact,
 * 5 longitude, 6 latitude, 7 baro_altitude, 8 on_ground, 9 velocity,
 * 10 true_track, 11 vertical_rate, 12 sensors, 13 geo_altitude,
 * 14 squawk, 15 spi, 16 position_source, 17 category
 */
function normalizeOpenskyState(s, fallbackStamp) {
    const lon = s[5], lat = s[6];
    if (typeof lat !== "number" || typeof lon !== "number") return null;

    // OpenSky liefert SI-Einheiten: Höhe in Metern, Speed in m/s
    const altitude = s[13] ?? s[7] ?? 0;
    const velocityMs = s[9] ?? 0;

    return makeAircraft({
        id: s[0],                                   // icao24 – eindeutig
        callsign: (s[1] ?? "").trim(),
        latitude: lat,
        longitude: lon,
        altitude,
        speed: velocityMs * 3.6,
        heading: s[10] ?? 0,
        verticalRate: s[11] ?? 0,
        onGround: !!s[8],
        squawk: s[14] ?? "",
        country: s[2] ?? "",
        registration: "",
        aircraftType: "",
        timestamp: (s[4] ? s[4] * 1000 : fallbackStamp)
    });
}

/* ═════════════ adsb.lol ═════════════ */

const ADSBLOL_BASE = "https://api.adsb.lol/v2";

/**
 * Holt Live-Positionen von adsb.lol.
 *
 * Die API arbeitet mit Mittelpunkt und Radius statt mit einem Rechteck.
 * Aus der Bounding-Box wird deshalb der Mittelpunkt gebildet und der
 * Radius so gewählt, dass die Ecken abgedeckt sind (max. 250 nm).
 */
export async function fetchAdsbLol(bounds, opts = {}) {
    const lat = (bounds.north + bounds.south) / 2;
    const lon = (bounds.east + bounds.west) / 2;

    // Halbe Diagonale in nautischen Meilen, gedeckelt auf 250
    const latSpanNm = (bounds.north - bounds.south) * 60;
    const lonSpanNm = (bounds.east - bounds.west) * 60 * Math.cos(lat * Math.PI / 180);
    const radiusNm = Math.min(250,
        Math.max(20, Math.ceil(Math.hypot(latSpanNm, lonSpanNm) / 2)));

    // Auf 0,25° runden – das verbessert die Trefferquote im Cache
    const roundedLat = Math.round(lat * 4) / 4;
    const roundedLon = Math.round(lon * 4) / 4;

    const url = `${ADSBLOL_BASE}/lat/${roundedLat}/lon/${roundedLon}/dist/${radiusNm}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    let res;
    try {
        res = await fetch(url, {
            signal: controller.signal,
            headers: { Accept: "application/json", "User-Agent": "world-viewer/2.3" }
        });
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        throw Object.assign(new Error(`adsb.lol antwortete mit ${res.status}`),
            { status: res.status });
    }

    const json = await res.json();
    // "now" kommt mal in Sekunden, mal in Millisekunden
    const nowRaw = Number(json?.now);
    const nowMs = Number.isFinite(nowRaw)
        ? (nowRaw > 10_000_000_000 ? nowRaw : nowRaw * 1000)
        : Date.now();

    return (json?.ac ?? []).map(r => normalizeAdsbLolRow(r, nowMs)).filter(Boolean);
}

/** Militärflugzeuge weltweit – eigener Endpunkt ohne Parameter. */
export async function fetchAdsbLolMilitary() {
    const res = await fetch(`${ADSBLOL_BASE}/mil`, {
        headers: { Accept: "application/json", "User-Agent": "world-viewer/2.3" }
    });
    if (!res.ok) throw new Error(`adsb.lol antwortete mit ${res.status}`);

    const json = await res.json();
    const nowRaw = Number(json?.now);
    const nowMs = Number.isFinite(nowRaw)
        ? (nowRaw > 10_000_000_000 ? nowRaw : nowRaw * 1000)
        : Date.now();

    return (json?.ac ?? [])
        .map(r => normalizeAdsbLolRow(r, nowMs))
        .filter(Boolean)
        .map(a => ({ ...a, military: true }));
}

/**
 * Wandelt einen adsb.lol-Datensatz (readsb-Format) ins einheitliche Format.
 * Rohwerte: Höhe in Fuß, Speed in Knoten, Steigrate in Fuß/Minute.
 */
function normalizeAdsbLolRow(row, nowMs) {
    const lat = Number(row?.lat);
    const lon = Number(row?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (!row.hex) return null;

    // Bodenverkehr hat keinen Boolean: readsb setzt alt_baro auf "ground"
    const onGround = row.alt_baro === "ground";
    const altFt = onGround ? 0
        : Number(row.alt_geom ?? row.alt_baro ?? 0) || 0;
    const gspeedKt = Number(row.gs ?? 0) || 0;
    const vspeedFpm = Number(row.baro_rate ?? row.geom_rate ?? 0) || 0;

    return makeAircraft({
        id: String(row.hex).toLowerCase(),
        callsign: String(row.flight ?? "").trim(),
        latitude: lat,
        longitude: lon,
        altitude: altFt * FEET_TO_M,
        speed: gspeedKt * KNOTS_TO_KMH,
        heading: Number(row.track ?? 0) || 0,
        verticalRate: (vspeedFpm * FEET_TO_M) / 60,
        onGround,
        registration: row.r ?? "",
        aircraftType: row.t ?? "",
        airline: row.ownOp ?? "",
        squawk: row.squawk ? String(row.squawk) : "",
        timestamp: Number.isFinite(row.seen_pos) ? nowMs - row.seen_pos * 1000 : nowMs
    });
}

/* ═════════════ Anbieter-Auswahl ═════════════ */

/**
 * Ruft den konfigurierten Anbieter auf.
 * @param {string} provider "fr24" | "opensky"
 */
export async function fetchFlights(provider, bounds, opts) {
    switch (provider) {
        case "fr24":
            return { source: "Flightradar24", aircraft: await fetchFlightradar24(bounds, opts) };
        case "opensky":
            return {
                source: opts.clientId ? "OpenSky Network (angemeldet)" : "OpenSky Network",
                aircraft: await fetchOpenSky(bounds, opts)
            };
        case "adsblol":
            return { source: "adsb.lol", aircraft: await fetchAdsbLol(bounds, opts) };
        default:
            throw Object.assign(
                new Error(`Unbekannter Flugdaten-Anbieter: ${provider}`),
                { status: 400 }
            );
    }
}
