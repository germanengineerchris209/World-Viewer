/**
 * launchAscent.js – modellhafte Rekonstruktion eines Raketenaufstiegs.
 *
 * Launch Library 2 liefert Startplatz, Zielorbit und (bei manchen Stufen)
 * Bergungsdaten, aber keine Flugbahn. Dieses Modul baut daraus eine
 * PLAUSIBLE, KEINE TELEMETRISCHE Flugbahn:
 *
 *   1. Inklination aus dem Zielorbit-Namen schätzen (ISS/LEO/SSO/…).
 *   2. Flugazimut aus Startplatz-Breite + Inklination über die Standard-
 *      Orbitalmechanik-Formel ableiten (sin(Azimut) = cos(i) / cos(lat)).
 *   3. Entlang dieses Azimuts ein generisches Höhen-/Downrange-Profil
 *      (angelehnt an reale Aufstiegsprofile zweistufiger Trägerraketen)
 *      abtasten, per Großkreis-Zielpunktformel in Lat/Lon umgerechnet.
 *
 * Stufentrennung wird an einem typischen Zeitpunkt markiert; Bergungsorte
 * (falls die API einen Bergungsversuch meldet) nutzen echte Koordinaten aus
 * Launch Library 2 – nur die Aufstiegsbahn selbst ist Rekonstruktion.
 *
 * Vorgehensweise übernommen aus "God's Eye View" von Bilawal Sidhu
 * (MIT-Lizenz, https://github.com/bilawalsidhu/gods-eye-view).
 */

const EARTH_RADIUS_KM = 6371;

/** Grobe Inklinationsschätzung nach Zielorbit-Kürzel (Launch Library 2). */
const ORBIT_INCLINATION_DEG = {
    ISS: 51.6,
    LEO: 51.6,
    SSO: 97.6,
    PO: 97.6,
    MEO: 55,
    HEO: 63.4
};

/** Generisches Aufstiegsprofil: Zeitanteil -> Höhe/Downrange (grobe Näherung). */
const PROFILE_KEYFRAMES = [
    { f: 0.00, altKm: 0, downKm: 0 },
    { f: 0.08, altKm: 18, downKm: 8 },
    { f: 0.27, altKm: 70, downKm: 90 },
    { f: 0.35, altKm: 100, downKm: 180 },
    { f: 0.65, altKm: 160, downKm: 900 },
    { f: 1.00, altKm: 200, downKm: 2200 }
];

export const ASCENT_DURATION_MS = 9 * 60 * 1000;   // ~9 Min. bis Orbit-Einschuss (typischer Mittelwert)
const STAGE_SEP_FRACTION = 0.27;
const SAMPLE_COUNT = 48;

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function inclinationForOrbit(abbrev, padLat) {
    const known = ORBIT_INCLINATION_DEG[String(abbrev || "").toUpperCase()];
    if (known != null) return known;
    // Ohne genauere Angabe: Bahnebene nahe Startplatz-Breite = minimaler Kurswechsel (z.B. GTO/GEO).
    return Math.max(Math.abs(padLat), 28);
}

/** Flugazimut aus Startplatz-Breite + Zielinklination (Standard-Orbitalmechanik). */
function azimuthForInclination(padLat, inclinationDeg) {
    const incl = Math.max(inclinationDeg, Math.abs(padLat));
    const lat = toRad(padLat);

    if (incl <= 90) {
        const sinAz = Math.cos(toRad(incl)) / Math.cos(lat);
        const az = toDeg(Math.asin(clamp(sinAz, -1, 1)));
        return (az + 360) % 360;
    }
    // Retrograde/polare Bahnen: Start führt meist südwärts.
    const suppl = toRad(180 - incl);
    const sinAz = Math.cos(suppl) / Math.cos(lat);
    const az = toDeg(Math.asin(clamp(sinAz, -1, 1)));
    return (180 + az + 360) % 360;
}

/** Zielpunkt auf einer Kugel: Startpunkt + Azimut + Distanz (Großkreis). */
function destinationPoint(lat, lon, bearingDeg, distanceKm) {
    const delta = distanceKm / EARTH_RADIUS_KM;
    const theta = toRad(bearingDeg);
    const phi1 = toRad(lat), lambda1 = toRad(lon);

    const phi2 = Math.asin(
        Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
    const lambda2 = lambda1 + Math.atan2(
        Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
        Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));

    return { lat: toDeg(phi2), lon: ((toDeg(lambda2) + 540) % 360) - 180 };
}

function interpolateKeyframes(f) {
    const kf = PROFILE_KEYFRAMES;
    let i = 0;
    while (i < kf.length - 2 && f > kf[i + 1].f) i++;
    const a = kf[i], b = kf[i + 1];
    const span = Math.max(1e-6, b.f - a.f);
    const t = clamp((f - a.f) / span, 0, 1);
    return {
        altKm: a.altKm + (b.altKm - a.altKm) * t,
        downKm: a.downKm + (b.downKm - a.downKm) * t
    };
}

/**
 * Baut die Aufstiegsrekonstruktion für einen Start.
 * @param {{padLat:number, padLon:number, orbitAbbrev?:string, orbitName?:string, stages?:Array}} launchMeta
 */
export function buildAscentModel(launchMeta) {
    const { padLat, padLon, orbitAbbrev, orbitName, stages = [] } = launchMeta;
    const inclinationDeg = inclinationForOrbit(orbitAbbrev, padLat);
    const azimuthDeg = azimuthForInclination(padLat, inclinationDeg);
    const durationMs = ASCENT_DURATION_MS;

    const samples = [];
    for (let i = 0; i <= SAMPLE_COUNT; i++) {
        const f = i / SAMPLE_COUNT;
        const { altKm, downKm } = interpolateKeyframes(f);
        const { lat, lon } = destinationPoint(padLat, padLon, azimuthDeg, downKm);
        samples.push({ tMs: f * durationMs, lat, lon, altM: altKm * 1000 });
    }

    const stageSepMs = STAGE_SEP_FRACTION * durationMs;
    const subEvents = [];

    if (stages.length > 0) {
        const atSep = samples.find(s => s.tMs >= stageSepMs) ?? samples[samples.length - 1];
        subEvents.push({
            id: "stage-sep",
            tMs: stageSepMs,
            kind: "stage-sep",
            label: "Stufentrennung",
            lat: atSep.lat,
            lon: atSep.lon
        });
    }

    stages.forEach((stage, i) => {
        if (!stage.landingAttempt) return;
        const isRtls = /RTLS|Launch Site/i.test(stage.landingTypeAbbrev || stage.landingTypeName || "");
        const landingDelayMs = (isRtls ? 7 : 8.5) * 60 * 1000;
        const hasCoords = Number.isFinite(stage.landingLat) && Number.isFinite(stage.landingLon);
        subEvents.push({
            id: `recovery-${i}`,
            tMs: Math.min(landingDelayMs, durationMs * 0.98),
            kind: "recovery",
            label: stage.landingSuccess
                ? `Bergung erfolgreich: ${stage.landingLocationName || stage.landingTypeName || "Landeplatz"}`
                : `Bergung fehlgeschlagen: ${stage.landingLocationName || stage.landingTypeName || "Landeplatz"}`,
            success: stage.landingSuccess === true,
            lat: hasCoords ? stage.landingLat : padLat,
            lon: hasCoords ? stage.landingLon : padLon
        });
    });

    subEvents.sort((a, b) => a.tMs - b.tMs);

    return { durationMs, azimuthDeg, inclinationDeg, samples, subEvents, orbitName, orbitAbbrev };
}

/** Interpolierte Position zum Zeitpunkt dt (ms seit Liftoff). */
export function sampleAscentPosition(model, dtMs) {
    const dt = clamp(dtMs, 0, model.durationMs);
    const samples = model.samples;
    let i = 0;
    while (i < samples.length - 2 && samples[i + 1].tMs < dt) i++;
    const a = samples[i], b = samples[i + 1];
    const span = Math.max(1e-6, b.tMs - a.tMs);
    const t = clamp((dt - a.tMs) / span, 0, 1);
    return {
        lat: a.lat + (b.lat - a.lat) * t,
        lon: a.lon + (b.lon - a.lon) * t,
        altM: a.altM + (b.altM - a.altM) * t,
        reachedOrbit: dtMs >= model.durationMs
    };
}

/** Alle Flugbahn-Stützpunkte bis zum Zeitpunkt dt, für die wachsende Pfadlinie. */
export function ascentPathPositions(model, dtMs) {
    const dt = clamp(dtMs, 0, model.durationMs);
    return model.samples.filter(s => s.tMs <= dt);
}
