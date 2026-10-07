/**
 * SpaceWeatherLayer.js – Kp-Index, Sonnenwind und Polarlicht-Vorhersage.
 *
 * Quelle: NOAA Space Weather Prediction Center (services.swpc.noaa.gov),
 * öffentliche US-Regierungsdaten (public domain), ohne Key/Anmeldung.
 * CORS ist gesetzt (`Access-Control-Allow-Origin: *`, per curl gegen
 * alle drei Endpunkte verifiziert) – kein Server-Proxy nötig:
 *   - json/planetary_k_index_1m.json        (Kp-Index, 1-Minuten-Werte)
 *   - json/ovation_aurora_latest.json       (OVATION-Gitter, Polarlicht-Wahrscheinlichkeit)
 *   - products/summary/solar-wind-mag-field.json  (IMF Bt/Bz)
 *   - products/summary/solar-wind-speed.json      (Protonengeschwindigkeit)
 *
 * Die im Ticket genannte URL für den Sonnenwind
 * (`products/solar-wind/mag-1-day.json`) existiert nicht mehr (404) –
 * die beiden "summary"-Endpunkte oben liefern denselben aktuellen
 * Momentwert und sind ebenfalls CORS-offen.
 *
 * Darstellung: Die OVATION-Daten sind ein 1°×1°-Gitter über den ganzen
 * Globus (~65000 Punkte) – als einzelne Entities viel zu viel. Je
 * Längengrad wird daher nur die äquatorwärtige Sichtbarkeitsgrenze
 * (erste Breite mit Aurora-Wahrscheinlichkeit über Schwellwert)
 * bestimmt und als farbiges Band (Corridor) um jeden Pol gezeichnet.
 */

import { BaseLayer } from "./BaseLayer.js";

const KP_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json";
const OVATION_URL = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json";
const SOLAR_WIND_MAG_URL = "https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json";
const SOLAR_WIND_SPEED_URL = "https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json";

const CFG = () => window.WORLD_VIEWER_CONFIG?.spaceWeather ?? {};

// Ab diesem OVATION-Wert (0-100, Aurora-Wahrscheinlichkeit in %) gilt eine
// Position als "im Sichtbarkeitsband" – üblicher Schwellwert für Vorhersagekarten.
const VISIBILITY_THRESHOLD = 10;

// Fällt die Vorhersage mangels Aktivität nirgends über den Schwellwert,
// wird ersatzweise die ruhige, klimatologische Oval-Lage gezeichnet.
const QUIET_BAND_LAT = 67;

const BAND_WIDTH_M = 450_000;      // Breite des gezeichneten Bands in Metern
const BAND_HEIGHT_M = 15_000;      // etwas über Grund, gegen Z-Fighting

// Geomagnetischer Sturmgrad (NOAA G-Skala) aus dem Kp-Index.
const G_SCALE = [
    { min: 9, label: "G5 – Extremer Sturm" },
    { min: 8, label: "G4 – Starker Sturm" },
    { min: 7, label: "G3 – Starker Sturm" },
    { min: 6, label: "G2 – Mittlerer Sturm" },
    { min: 5, label: "G1 – Leichter Sturm" },
    { min: 4, label: "Aktiv" },
    { min: 0, label: "Ruhig" }
];

// NOAA liefert bei Datenlücken `null` statt einer Zahl. `Number(null)` wäre 0
// und damit "finite" – ein Ausfall würde als echte 0 nT / 0 km/s angezeigt.
function numberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function gScaleFor(kp) {
    if (!Number.isFinite(kp)) return "–";
    return (G_SCALE.find(b => kp >= b.min) ?? G_SCALE[G_SCALE.length - 1]).label;
}

export class SpaceWeatherLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "spaceWeather",
            name: "Weltraumwetter",
            icon: "🌌",
            type: "spaceWeather",
            dataUrl: null
        });

        this.kpIndex = null;
        this.kpTime = null;
        this.windSpeed = null;
        this.bt = null;
        this.bz = null;
        this.lastFetchAt = 0;
        this.lastError = "";
        this._timer = null;
        this._onStatusChange = null;

        this._northBand = null;
        this._southBand = null;
    }

    onStatusChange(callback) { this._onStatusChange = callback; }

    _notify() { this._onStatusChange?.(this.getStatus()); }

    getStatus() {
        return {
            kp: this.kpIndex,
            kpTime: this.kpTime,
            gScale: gScaleFor(this.kpIndex),
            windSpeed: this.windSpeed,
            bt: this.bt,
            bz: this.bz,
            lastFetchAt: this.lastFetchAt,
            error: this.lastError
        };
    }

    async load() {
        await this.refresh();

        const seconds = CFG().refreshSeconds ?? 600;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        if (!this.enabled) return;

        const results = await Promise.allSettled([
            this._fetchJSON(CFG().kpUrl || KP_URL),
            this._fetchJSON(CFG().ovationUrl || OVATION_URL),
            this._fetchJSON(CFG().solarWindMagUrl || SOLAR_WIND_MAG_URL),
            this._fetchJSON(CFG().solarWindSpeedUrl || SOLAR_WIND_SPEED_URL)
        ]);
        const [kpResult, ovationResult, magResult, speedResult] = results;

        let ok = false;
        const errors = [];

        if (kpResult.status === "fulfilled") {
            this._applyKp(kpResult.value);
            ok = true;
        } else {
            errors.push(`Kp-Index: ${kpResult.reason.message}`);
        }

        if (magResult.status === "fulfilled") {
            this._applyMag(magResult.value);
            ok = true;
        } else {
            errors.push(`Sonnenwind (Magnetfeld): ${magResult.reason.message}`);
        }

        if (speedResult.status === "fulfilled") {
            this._applySpeed(speedResult.value);
            ok = true;
        } else {
            errors.push(`Sonnenwind (Geschwindigkeit): ${speedResult.reason.message}`);
        }

        if (ovationResult.status === "fulfilled") {
            this._rebuildAuroraBands(ovationResult.value);
            ok = true;
        } else {
            errors.push(`Polarlicht-Vorhersage: ${ovationResult.reason.message}`);
        }

        this.lastError = errors.join(" · ");
        if (ok) this.lastFetchAt = Date.now();
        this._notify();
    }

    async _fetchJSON(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    }

    _applyKp(json) {
        const entries = Array.isArray(json) ? json : [];
        const last = entries[entries.length - 1];
        if (!last) return;
        const value = numberOrNull(last.kp_index ?? last.estimated_kp);
        if (value !== null) {
            this.kpIndex = value;
            this.kpTime = last.time_tag ?? null;
        }
    }

    _applyMag(json) {
        const entry = Array.isArray(json) ? json[0] : null;
        if (!entry) return;
        const bt = numberOrNull(entry.bt);
        const bz = numberOrNull(entry.bz_gsm);
        if (bt !== null) this.bt = bt;
        if (bz !== null) this.bz = bz;
    }

    _applySpeed(json) {
        const entry = Array.isArray(json) ? json[0] : null;
        if (!entry) return;
        const speed = numberOrNull(entry.proton_speed);
        if (speed !== null) this.windSpeed = speed;
    }

    /**
     * Baut die beiden Polarlicht-Bänder aus dem OVATION-Gitter.
     * Je Längengrad wird die äquatorwärtige Grenze der Sichtbarkeitszone
     * bestimmt (erste Breite >= Schwellwert, von der Äquatorseite her
     * gesucht) und als Band entlang dieser Kontur gezeichnet.
     */
    _rebuildAuroraBands(json) {
        const coords = json?.coordinates;
        if (!Array.isArray(coords) || coords.length === 0) return;

        const byLon = new Map();
        for (const [lon, lat, value] of coords) {
            if (!byLon.has(lon)) byLon.set(lon, []);
            byLon.get(lon).push([lat, value]);
        }

        const northPoints = [];
        const southPoints = [];

        for (const lon of [...byLon.keys()].sort((a, b) => a - b)) {
            const samples = byLon.get(lon).sort((a, b) => a[0] - b[0]); // nach Breite aufsteigend

            // Nordhalbkugel: von 0° Richtung Pol suchen, erste Überschreitung = Grenze
            let northLat = null;
            for (const [lat, value] of samples) {
                if (lat < 0) continue;
                if (value >= VISIBILITY_THRESHOLD) { northLat = lat; break; }
            }
            northPoints.push([lon, northLat ?? QUIET_BAND_LAT]);

            // Südhalbkugel: von 0° in die Gegenrichtung suchen
            let southLat = null;
            for (let i = samples.length - 1; i >= 0; i--) {
                const [lat, value] = samples[i];
                if (lat > 0) continue;
                if (value >= VISIBILITY_THRESHOLD) { southLat = lat; break; }
            }
            southPoints.push([lon, southLat ?? -QUIET_BAND_LAT]);
        }

        this._setBand("north", northPoints, "#34d399");
        this._setBand("south", southPoints, "#38bdf8");
    }

    _setBand(hemisphere, points, color) {
        if (points.length < 4) return;

        // Als Längengrad-Schleife schließen
        const closed = [...points, points[0]];
        const positions = closed.map(([lon, lat]) =>
            Cesium.Cartesian3.fromDegrees(lon, lat, BAND_HEIGHT_M));

        const key = hemisphere === "north" ? "_northBand" : "_southBand";
        if (this[key]) {
            this.dataSource.entities.remove(this[key]);
            this[key] = null;
        }

        this[key] = this.dataSource.entities.add({
            id: `space-weather-band-${hemisphere}`,
            corridor: {
                positions,
                width: BAND_WIDTH_M,
                cornerType: Cesium.CornerType.ROUNDED,
                material: Cesium.Color.fromCssColorString(color).withAlpha(0.35),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.7)
            }
        });
    }

    show() {
        super.show();
        if (!this._timer) this.load();
    }

    hide() {
        super.hide();
        this._stopTimer();
    }

    clear() {
        this._stopTimer();
        this._northBand = null;
        this._southBand = null;
        super.clear();
    }

    _stopTimer() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }
}

export { gScaleFor };
