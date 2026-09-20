/**
 * dataManager.js – Laden und Normalisieren von Daten.
 *
 * Alle Layer benutzen dieses Modul, damit Daten überall im
 * gleichen einheitlichen Format vorliegen:
 *
 * {
 *   id: "unique-id",
 *   type: "aircraft" | "ship" | "satellite" | "camera" | "infrastructure",
 *   name: "Anzeigename",
 *   position: { latitude, longitude, altitude },
 *   heading: 0-360,        // optional
 *   speed: km/h,           // optional
 *   timestamp: Date.now(),
 *   metadata: { ... }      // typspezifische Zusatzdaten
 * }
 *
 * Später können hier fetch()-Aufrufe gegen echte APIs
 * (OpenSky, AIS, TLE-Daten …) oder WebSockets ergänzt werden.
 */

/**
 * Lädt eine JSON-Datei mit Fehlerbehandlung.
 * @returns {Promise<Array>} leeres Array bei Fehlern (App läuft weiter)
 */
export async function loadJSON(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} für ${url}`);
        }
        return await response.json();
    } catch (err) {
        console.error(`[dataManager] Konnte ${url} nicht laden:`, err);
        return [];
    }
}

/** Wandelt einen Roh-Datensatz in das einheitliche Format um. */
export function normalizeRecord(raw, type) {
    return {
        id: raw.id ?? `${type}-${Math.random().toString(36).slice(2, 9)}`,
        type,
        name: raw.name ?? raw.callsign ?? raw.id ?? "Unbekannt",
        position: {
            latitude: raw.position?.latitude ?? raw.latitude ?? 0,
            longitude: raw.position?.longitude ?? raw.longitude ?? 0,
            altitude: raw.position?.altitude ?? raw.altitude ?? 0
        },
        heading: raw.heading ?? 0,
        speed: raw.speed ?? 0,
        timestamp: raw.timestamp ?? Date.now(),
        metadata: { ...raw }
    };
}

/** Grad → Bogenmaß */
export const toRad = (deg) => deg * Math.PI / 180;
/** Bogenmaß → Grad */
export const toDeg = (rad) => rad * 180 / Math.PI;

/**
 * Bewegt eine Position um `distanceKm` in Richtung `headingDeg`
 * (vereinfachte sphärische Berechnung – für die Simulation ausreichend).
 * @returns {{latitude:number, longitude:number}}
 */
export function movePosition(latitude, longitude, headingDeg, distanceKm) {
    const R = 6371; // Erdradius in km
    const d = distanceKm / R;
    const h = toRad(headingDeg);
    const lat1 = toRad(latitude);
    const lon1 = toRad(longitude);

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d) +
        Math.cos(lat1) * Math.sin(d) * Math.cos(h)
    );
    const lon2 = lon1 + Math.atan2(
        Math.sin(h) * Math.sin(d) * Math.cos(lat1),
        Math.cos(d) - Math.sin(lat1) * Math.sin(lat2)
    );

    return {
        latitude: toDeg(lat2),
        // Longitude in den Bereich [-180, 180] normalisieren
        longitude: ((toDeg(lon2) + 540) % 360) - 180
    };
}

/**
 * Erzeugt eine data:-URI aus SVG-Markup – so brauchen wir keine
 * externen Icon-Dateien und alles funktioniert offline.
 */
export function svgDataUri(svg) {
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

const EARTH_RADIUS_KM = 6371;

/** Entfernung zwischen zwei Koordinaten in km (Haversine-Formel). */
export function haversineKm(lat1, lon1, lat2, lon2) {
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
