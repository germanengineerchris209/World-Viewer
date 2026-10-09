/**
 * deepSpace.mjs – Positionen aktiver Raumsonden über NASA JPL Horizons.
 *
 * Quelle: https://ssd.jpl.nasa.gov/api/horizons.api – liefert echte
 * Ephemeriden (Positions- und Geschwindigkeitsvektoren) für jeden Körper
 * im Sonnensystem, inklusive der aktiven Raumsonden, ohne Schlüssel.
 *
 * Warum serverseitig?
 *   • Horizons sendet keine CORS-Header
 *   • Die Antwort ist kein sauberes JSON, sondern ein JSON-Umschlag mit
 *     einem Klartext-Ephemeridenblock im Feld "result" – der muss
 *     geparst werden (siehe parseVectorTable())
 *   • Je Abruf sind 7 Anfragen nötig (6 Sonden + Erde als Bezugspunkt);
 *     das soll nicht jeder Browser einzeln machen
 *
 * Maßstab: Voyager 1 ist rund 25 Mrd. km entfernt – etwa 170 AE. Eine
 * maßstabsgetreue Darstellung auf dem Erdglobus ist damit sinnlos
 * (die Erde wäre ein unsichtbarer Punkt). Dieses Modul liefert deshalb
 * reine Kennzahlen (Distanz zu Sonne/Erde, Signallaufzeit, Tempo) plus
 * die ekliptikale Länge für die schematische Draufsicht im Frontend,
 * nicht Geokoordinaten – siehe js/deepSpace.js.
 *
 * Alle Abfragen gehen an denselben Zeitraster (siehe ephemerisWindow()),
 * damit die Vektoren von Sonde und Erde zur selben Epoche gehören und
 * die Differenz physikalisch sinnvoll ist.
 */

import { cachedFetch } from "./dataProxies.mjs";

const HORIZONS_API = "https://ssd.jpl.nasa.gov/api/horizons.api";
const UA = "world-viewer/2.7 (+https://github.com/)";

/** Lichtgeschwindigkeit im Vakuum (km/s), exakt per SI-Definition. */
const C_KM_S = 299_792.458;

/** Astronomische Einheit in km (IAU 2012, exakt). */
const AU_KM = 149_597_870.7;

/**
 * Positionen auf dieser Skala ändern sich langsam – 6 Stunden Cache.
 * Abgefragt wird trotzdem ein 12-Stunden-Fenster im Stundenraster
 * (siehe ephemerisWindow()), damit auch gegen Ende der Cache-Laufzeit
 * noch ein Stützpunkt in der Nähe der aktuellen Uhrzeit vorliegt.
 * Wichtig für die Parker Solar Probe, die im Perihel über 190 km/s
 * erreicht und binnen Stunden merklich weiterzieht.
 */
const DEEP_SPACE_TTL_MS = 6 * 60 * 60 * 1000;

/** Sonnenmittelpunkt als Bezugspunkt (Horizons-Schreibweise). */
const CENTER_SUN = "500@10";

/**
 * Die Ziele. "horizons" ist die NAIF/Horizons-Körper-ID; negative IDs
 * bezeichnen Raumfahrzeuge. Reihenfolge = Anzeigereihenfolge im Panel
 * (von der Sonne nach außen, wie sie typischerweise stehen).
 */
export const DEEP_SPACE_TARGETS = [
    {
        id: "parker-solar-probe",
        horizons: "-96",
        name: "Parker Solar Probe",
        agency: "NASA",
        launched: "2018-08-12",
        goal: "Sonnenkorona",
        note: "Schnellstes von Menschen gebautes Objekt – im Perihel über 190 km/s.",
        color: "#fbbf24"
    },
    {
        id: "jwst",
        horizons: "-170",
        name: "James-Webb-Weltraumteleskop",
        agency: "NASA/ESA/CSA",
        launched: "2021-12-25",
        goal: "Lagrange-Punkt L2",
        note: "Halo-Umlaufbahn um den Sonne-Erde-Punkt L2, rund 1,5 Mio. km hinter der Erde.",
        color: "#f472b6"
    },
    {
        id: "juno",
        horizons: "-61",
        name: "Juno",
        agency: "NASA",
        launched: "2011-08-05",
        goal: "Jupiter",
        note: "Polare Umlaufbahn um Jupiter, Magnetfeld- und Atmosphärenforschung.",
        color: "#fb923c"
    },
    {
        id: "new-horizons",
        horizons: "-98",
        name: "New Horizons",
        agency: "NASA",
        launched: "2006-01-19",
        goal: "Kuipergürtel",
        note: "Pluto-Vorbeiflug 2015, Arrokoth 2019 – jetzt im äußeren Kuipergürtel.",
        color: "#38bdf8"
    },
    {
        id: "voyager-2",
        horizons: "-32",
        name: "Voyager 2",
        agency: "NASA",
        launched: "1977-08-20",
        goal: "Interstellarer Raum",
        note: "Einzige Sonde bei Uranus und Neptun; seit 2018 im interstellaren Raum.",
        color: "#a78bfa"
    },
    {
        id: "voyager-1",
        horizons: "-31",
        name: "Voyager 1",
        agency: "NASA",
        launched: "1977-09-05",
        goal: "Interstellarer Raum",
        note: "Entferntestes von Menschen gebautes Objekt, seit 2012 im interstellaren Raum.",
        color: "#c084fc"
    }
];

/** Die Erde als Bezugspunkt für Distanz und Signallaufzeit. */
const EARTH_TARGET = { id: "earth", horizons: "399", name: "Erde" };

/* ═══════════ Abruf ═══════════ */

async function fetchWithTimeout(url, timeoutMs = 25_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, {
            signal: controller.signal,
            headers: { "User-Agent": UA, Accept: "application/json" }
        });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Das abgefragte Zeitfenster: von der aktuellen Stunde 12 Stunden
 * voraus, im Stundenraster. Alle Ziele nutzen exakt dieselben Werte,
 * damit die Stützpunkte vergleichbar sind.
 */
function ephemerisWindow(nowMs = Date.now()) {
    const start = new Date(Math.floor(nowMs / 3_600_000) * 3_600_000);
    const stop = new Date(start.getTime() + 12 * 3_600_000);
    return {
        start: horizonsTime(start),
        stop: horizonsTime(stop),
        step: "1h"
    };
}

/** Horizons erwartet "JJJJ-MM-TT hh:mm" (hier durchgehend UTC). */
function horizonsTime(date) {
    return date.toISOString().slice(0, 16).replace("T", " ");
}

/**
 * Horizons will seine Parameterwerte in einfachen Anführungszeichen –
 * die URL-Kodierung übernimmt URLSearchParams.
 */
function horizonsUrl(bodyId, { start, stop, step }) {
    const url = new URL(HORIZONS_API);
    const params = {
        format: "json",
        COMMAND: `'${bodyId}'`,
        OBJ_DATA: "'NO'",
        MAKE_EPHEM: "'YES'",
        EPHEM_TYPE: "'VECTORS'",
        CENTER: `'${CENTER_SUN}'`,
        START_TIME: `'${start}'`,
        STOP_TIME: `'${stop}'`,
        STEP_SIZE: `'${step}'`
    };
    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }
    return url;
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Pause zwischen zwei Horizons-Anfragen. Der Dienst drosselt parallele
 * Zugriffe mit HTTP 503 (bei sieben gleichzeitigen Anfragen kamen fünf
 * davon zurück), deshalb werden die Ziele streng nacheinander und mit
 * kleinem Abstand abgefragt – bei 6 Stunden Cache ist das unkritisch.
 */
const REQUEST_GAP_MS = 400;

/** So oft wird eine gedrosselte Anfrage (5xx) erneut versucht. */
const MAX_ATTEMPTS = 3;

/** Fehler, bei dem ein zweiter Versuch nichts bringen würde. */
function permanentError(message) {
    const err = new Error(message);
    err.permanent = true;
    return err;
}

/**
 * Holt die Vektortabelle eines Körpers, mit Geduld bei Drosselung.
 * Wiederholt wird alles Vorübergehende: 5xx, Zeitüberschreitung,
 * Netzfehler und auch ein unlesbarer Block – Letzteres, weil Horizons
 * im Störungsfall schon mal eine Fehlerseite statt Ephemeriden schickt
 * und der neue Abruf dann durchaus gelingt. Nicht wiederholt werden
 * 4xx und gemeldete Eingabefehler: daran ändert ein zweiter Versuch nichts.
 */
async function fetchVectorTable(bodyId, window) {
    let lastError;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            return await requestVectorTable(bodyId, window);
        } catch (err) {
            lastError = err;
            if (err.permanent || attempt === MAX_ATTEMPTS) break;
            await sleep(attempt * 1_000);
        }
    }

    throw lastError;
}

/** Ein einzelner Horizons-Abruf samt Auswertung. */
async function requestVectorTable(bodyId, window) {
    const upstream = await fetchWithTimeout(horizonsUrl(bodyId, window));

    if (!upstream.ok) {
        const message = `Horizons antwortete mit ${upstream.status}`;
        // 5xx = meist Drosselung oder Wartung, lohnt einen zweiten Versuch.
        // 4xx = unsere Anfrage ist falsch, da hilft kein Wiederholen.
        throw upstream.status >= 500 ? new Error(message) : permanentError(message);
    }

    const json = await upstream.json();
    // Horizons meldet fachliche Fehler im Feld "error", nicht per HTTP-Status
    if (json?.error) throw permanentError(String(json.error).trim().split("\n")[0]);
    if (typeof json?.result !== "string") {
        throw permanentError("Horizons-Antwort ohne Feld \"result\"");
    }

    return parseVectorTable(json.result);
}

/* ═══════════ Parsen des Klartextblocks ═══════════ */

/**
 * Der Nutzdatenblock steht zwischen den Marken $$SOE und $$EOE und sieht
 * je Zeitpunkt so aus (Ekliptik J2000, Einheiten km und km/s):
 *
 *   2461321.500000000 = A.D. 2026-Oct-08 00:00:00.0000 TDB
 *    X =-4.812771567086832E+09 Y =-2.047690068180120E+10 Z = 1.481542233123134E+10
 *    VX=-2.069852860381195E+00 VY=-1.361129241608261E+01 VZ= 9.831888517994024E+00
 *    LT= 8.582150874221690E+04 RG= 2.572864105509769E+10 RR= 1.688166863252118E+01
 *
 * X/Y/Z  Ortsvektor, VX/VY/VZ Geschwindigkeit, LT Lichtlaufzeit zum
 * Zentrum (s), RG Abstand zum Zentrum (km), RR Radialgeschwindigkeit.
 */
const TOKEN_RE = /\b([A-Z]{1,2})\s*=\s*(-?\d+(?:\.\d*)?(?:[Ee][+-]?\d+)?)/g;

const EPOCH_RE = /^\s*(\d+\.\d+)\s*=\s*A\.D\.\s*(.+?)\s+TDB\s*$/;

/** Pflichtfelder – fehlt eines, ist der Datensatz unbrauchbar. */
const REQUIRED_KEYS = ["X", "Y", "Z", "VX", "VY", "VZ", "RG"];

export function parseVectorTable(text) {
    const soe = text.indexOf("$$SOE");
    const eoe = text.indexOf("$$EOE");
    if (soe < 0 || eoe < soe) {
        throw new Error("Horizons-Antwort enthält keinen Ephemeridenblock ($$SOE/$$EOE)");
    }

    const records = [];
    let current = null;

    for (const line of text.slice(soe + "$$SOE".length, eoe).split("\n")) {
        const epoch = line.match(EPOCH_RE);
        if (epoch) {
            current = { jd: Number(epoch[1]), epoch: epoch[2].trim() };
            records.push(current);
            continue;
        }
        if (!current) continue;
        for (const [, key, value] of line.matchAll(TOKEN_RE)) {
            current[key] = Number(value);
        }
    }

    const usable = records.filter(r =>
        REQUIRED_KEYS.every(k => Number.isFinite(r[k])));

    if (!usable.length) throw new Error("Ephemeridenblock ohne verwertbare Vektoren");
    return usable;
}

/**
 * Julianisches Datum → Unix-Millisekunden. Horizons liefert hier TDB,
 * das gegenüber UTC um gut 69 s vorausläuft; für die Auswahl des
 * nächstgelegenen Stützpunkts im Stundenraster ist das ohne Belang.
 */
function jdToMs(jd) {
    return (jd - 2_440_587.5) * 86_400_000;
}

/** Der Stützpunkt, dessen Epoche am nächsten an `targetMs` liegt. */
function pickNearest(records, targetMs) {
    let best = records[0];
    let bestDelta = Math.abs(jdToMs(best.jd) - targetMs);
    for (const record of records.slice(1)) {
        const delta = Math.abs(jdToMs(record.jd) - targetMs);
        if (delta < bestDelta) {
            best = record;
            bestDelta = delta;
        }
    }
    return best;
}

/* ═══════════ Aufbereiten ═══════════ */

function magnitude(x, y, z) {
    return Math.hypot(x, y, z);
}

/**
 * Rechnet einen Stützpunkt in die Kennzahlen des Panels um.
 * @param {object} target  Eintrag aus DEEP_SPACE_TARGETS
 * @param {object} state   Stützpunkt der Sonde (heliozentrisch)
 * @param {object} earth   Stützpunkt der Erde zur selben Epoche
 */
function describeTarget(target, state, earth) {
    const sunDistanceKm = state.RG;

    // Beide Vektoren sind heliozentrisch in der Ekliptik J2000 –
    // die Differenz ist damit der geozentrische Ortsvektor.
    const dx = state.X - earth.X;
    const dy = state.Y - earth.Y;
    const dz = state.Z - earth.Z;
    const earthDistanceKm = magnitude(dx, dy, dz);

    const lightSeconds = earthDistanceKm / C_KM_S;

    return {
        id: target.id,
        name: target.name,
        agency: target.agency,
        launched: target.launched,
        goal: target.goal,
        note: target.note,
        color: target.color,
        horizonsId: target.horizons,
        epoch: state.epoch,
        epochMs: Math.round(jdToMs(state.jd)),

        sunDistanceKm,
        sunDistanceAu: sunDistanceKm / AU_KM,
        earthDistanceKm,
        earthDistanceAu: earthDistanceKm / AU_KM,

        // Signallaufzeit: einfach (Telemetrie) und doppelt (Kommando + Antwort)
        lightSeconds,
        roundTripSeconds: lightSeconds * 2,

        // Tempo relativ zur Sonne, plus Radialanteil (RR: +/- = weg/hin)
        speedKmS: magnitude(state.VX, state.VY, state.VZ),
        radialSpeedKmS: Number.isFinite(state.RR) ? state.RR : null,

        // Ekliptikale Länge für die schematische Draufsicht (0-360°)
        eclipticLongitudeDeg: (Math.atan2(state.Y, state.X) * 180 / Math.PI + 360) % 360
    };
}

/**
 * Lädt die Vektortabellen aller Ziele plus Erde.
 * Fällt ein einzelnes Ziel aus, fehlt nur dieses; bricht die Erde weg,
 * schlägt der ganze Abruf fehl (ohne Bezugspunkt keine Kennzahlen) und
 * cachedFetch liefert die vorige Antwort.
 */
async function loadStateTables() {
    const window = ephemerisWindow();

    // Die Erde zuerst: ohne Bezugspunkt ist der Rest wertlos.
    const earth = await fetchVectorTable(EARTH_TARGET.horizons, window);

    const probes = [];
    for (const target of DEEP_SPACE_TARGETS) {
        await sleep(REQUEST_GAP_MS);
        try {
            probes.push({ target, ok: true, records: await fetchVectorTable(target.horizons, window) });
        } catch (err) {
            console.warn(`[deepspace] ${target.name}: ${err.message}`);
            probes.push({ target, ok: false, error: err.message });
        }
    }

    return { window, earth, probes };
}

/**
 * Wählt zu `nowMs` die passenden Stützpunkte aus den gecachten
 * Tabellen – so bleibt die Anzeige auch Stunden nach dem Abruf aktuell.
 */
function buildPayload(tables, nowMs) {
    const earthState = pickNearest(tables.earth, nowMs);

    const missions = [];
    const failed = [];

    for (const entry of tables.probes) {
        if (!entry.ok) {
            failed.push({ id: entry.target.id, name: entry.target.name, error: entry.error });
            continue;
        }
        // Erd- und Sondentabelle teilen dasselbe Raster: nach Epoche wählen,
        // nicht nach Index – falls Horizons für ein Ziel weniger
        // Stützpunkte liefert (etwa am Rand der Ephemeridenabdeckung).
        const state = pickNearest(entry.records, jdToMs(earthState.jd));
        missions.push(describeTarget(entry.target, state, earthState));
    }

    return {
        fetchedAt: nowMs,
        epoch: earthState.epoch,
        epochMs: Math.round(jdToMs(earthState.jd)),
        earthSunDistanceAu: earthState.RG / AU_KM,
        count: missions.length,
        missions,
        failed,
        source: "NASA/JPL Horizons"
    };
}

export async function handleDeepSpace(res) {
    try {
        const result = await cachedFetch("deepspace", DEEP_SPACE_TTL_MS, async () => ({
            // Hier landet das geparste Tabellen-Objekt im Cache, nicht
            // fertiges JSON – die Stützpunktauswahl passiert je Abruf.
            data: await loadStateTables(),
            contentType: "application/json"
        }));

        const payload = buildPayload(result.data, Date.now());
        if (result.warning) payload.warning = result.warning;

        res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "x-cache": result.cacheStatus
        });
        res.end(JSON.stringify(payload));

    } catch (err) {
        res.writeHead(502, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
        });
        res.end(JSON.stringify({ error: `Horizons-Ephemeriden nicht abrufbar: ${err.message}` }));
    }
}
