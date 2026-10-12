/**
 * aircraftModels.js – 3D-Modelle je Flugzeugklasse (statt Glyph) ab einer
 * Entfernungsschwelle.
 *
 * GEV ("God's Eye View", Bilawal Sidhu, MIT) hat dafür ein "Hangar" mit
 * genau fünf GLB-Modellen: 787, ATR-72, Citation, Bell 206, MQ-9. Wir
 * übernehmen exakt diese fünf (CC BY 4.0, siehe DATENQUELLEN.md) statt
 * für jeden ICAO-Typcode ein eigenes – nicht jeder Typ bekommt also ein
 * passendes Modell, der Rest bleibt beim Glyph. Besser ehrlich nur fünf
 * Klassen abdecken als mit einem falschen Modell ein 737 als 787 zeigen.
 *
 * Herkunft der Modelldateien (unverändert aus GEV übernommen):
 *   https://github.com/bilawalsidhu/gods-eye-view/tree/main/public/models
 *
 * Ausrichtung: Die GLB-Dateien sind laut GEV mit der Nase Richtung
 * lokales −X gebacken (Y-up). Zusammen mit Cesiums
 * Transforms.headingPitchRollQuaternion (bei Kurs 0° zeigt lokales +X
 * nach Osten) braucht es +180° Versatz, damit die Nase bei Kurs 0 nach
 * Norden zeigt – exakt der Wert, den GEV selbst für dieselben Dateien
 * einsetzt (MODEL_HEADING_OFFSET_DEG in deren Rendering-Code).
 */

export const MODEL_HEADING_OFFSET_DEG = 180;

/** Fünf Klassen, exakt wie im GEV-"Hangar". */
export const MODEL_CLASSES = {
    heavy787: {
        url: "./assets/models/b789.glb",
        label: "Boeing 787",
        minimumPixelSize: 48,
        maximumScale: 220
    },
    atr72: {
        url: "./assets/models/atr72.glb",
        label: "ATR 72",
        minimumPixelSize: 40,
        maximumScale: 120
    },
    citation: {
        url: "./assets/models/citation2.glb",
        label: "Cessna Citation",
        minimumPixelSize: 36,
        maximumScale: 80
    },
    bell206: {
        url: "./assets/models/bell206.glb",
        label: "Bell 206",
        minimumPixelSize: 32,
        maximumScale: 60
    },
    mq9: {
        url: "./assets/models/mq9.glb",
        label: "MQ-9 Reaper",
        minimumPixelSize: 36,
        maximumScale: 100
    }
};

/** ICAO-Typcode → Modellklasse (nur Codes mit eindeutig passendem Modell). */
const TYPE_TO_CLASS = {
    // 787-Familie
    B788: "heavy787", B789: "heavy787", B78X: "heavy787",
    // ATR 72 (ATR 42 ist sich ähnlich genug für dieselbe Silhouette)
    AT72: "atr72", AT76: "atr72", AT45: "atr72",
    // Leichte Business-Jets in Citation-Größenklasse
    C25A: "citation", GLF6: "citation", E55P: "citation"
};

/**
 * Hubschrauber-ICAO-Typcodes (keine davon stehen in aircraftTypes.js,
 * weil Live-Flugdaten überwiegend Linien-/Charterflugzeuge liefern –
 * gelegentlich tauchen aber Rettungs-/Polizeihubschrauber auf).
 */
const HELICOPTER_TYPES = new Set([
    "B06", "B06T", "B407", "B429", "A109", "A139", "EC20", "EC25",
    "EC30", "EC35", "EC45", "AS50", "AS55", "AS65", "R44", "R66", "H60"
]);

/** Bekannte MQ-9/RQ-9-Varianten (ADS-B meldet diese selten, aber real). */
const DRONE_TYPES = new Set(["MQ9", "RQ9", "MQ-9", "RQ-9"]);

/**
 * Modellklasse für einen ICAO-Typcode bestimmen.
 * @param {string} typeCode
 * @param {{military?: boolean}} [meta]  optionale Zusatzangaben (z.B. aus
 *   dem adsb.lol-Militärfeed, siehe server/flightProviders.mjs)
 * @returns {string|null} Schlüssel aus MODEL_CLASSES, oder null = kein
 *   Modell vorhanden, es bleibt beim Glyph
 */
export function modelClassFor(typeCode, meta = {}) {
    const code = (typeCode || "").toUpperCase();

    if (HELICOPTER_TYPES.has(code)) return "bell206";
    if (DRONE_TYPES.has(code)) return "mq9";
    if (meta.military && (!code || DRONE_TYPES.has(code))) return "mq9";

    return TYPE_TO_CLASS[code] ?? null;
}

/** Modell-Konfiguration für eine Klasse (oder null). */
export function modelSpecFor(modelClass) {
    return MODEL_CLASSES[modelClass] ?? null;
}
