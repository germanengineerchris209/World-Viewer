/**
 * WorldWeatherLayer.js – Live-Wetter als weltweites Raster (WEB-102).
 *
 * Quelle: Open-Meteo Forecast API (https://open-meteo.com/en/docs),
 * öffentlich, ohne Anmeldung und ohne Schlüssel für nicht-kommerzielle
 * Nutzung – dieselbe API, die WeatherLayer.js (WEB-56) und AQILayer.js
 * schon verwenden.
 *
 * Abgrenzung zu den bestehenden Wetter-Layern:
 *   - WeatherLayer.js (WEB-56): Wind/Niederschlag an 40 kuratierten Städten,
 *     also punktuelle Details dort, wo Menschen wohnen.
 *   - dieser Layer: flächendeckendes Live-Bild der GANZEN Welt – ein
 *     Gradnetz-Raster, dessen Zellen nach der aktuellen Temperatur gefärbt
 *     sind (Standard 15°, also 264 Zellen), inklusive Ozeanen.
 *
 * Alle Zellen werden in EINER Anfrage geholt: `latitude`/`longitude`
 * akzeptieren kommaseparierte Listen, die Antwort ist ein Array in
 * derselben Reihenfolge (siehe WeatherLayer.js). Das hält die Last bei
 * einem einzigen Aufruf pro Aktualisierung statt bei 576.
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord } from "../dataManager.js";

const WEATHER_API = "https://api.open-meteo.com/v1/forecast";
const WEATHER_FIELDS = "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m";

const CFG = () => window.WORLD_VIEWER_CONFIG?.worldWeather ?? {};

// Gradnetz-Raster: Schrittweite in Grad. Die Zellenzahl bestimmt direkt den
// API-Verbrauch, denn Open-Meteo zählt bei Sammelabfragen JEDE Koordinate als
// eigenen Aufruf (Fair Use: ~10.000/Tag). 15° ≙ 264 Zellen; bei stündlicher
// Aktualisierung sind das ~6.300 Koordinaten-Aufrufe/Tag und damit noch im
// kostenlosen Rahmen. Ein 10°-Raster (576 Zellen) wäre optisch feiner, würde
// das Tageslimit aber schon im Einzelbetrieb sprengen – wer einen eigenen
// API-Schlüssel/Server nutzt, kann per Konfiguration feiner stellen.
// Die Pole bleiben frei: dort liefert das Modell kaum Mehrwert und die
// Zellen würden extrem verzerrt.
const DEFAULT_STEP_DEG = 15;
const DEFAULT_LAT_LIMIT = 80;
const DEFAULT_OPACITY = 0.45;

// Temperaturskala (°C) – von polar bis Wüstenhitze.
const TEMP_BANDS = [
    { max: -30, color: "#4c1d95", label: "Extrem kalt" },
    { max: -20, color: "#5b21b6", label: "Sehr kalt" },
    { max: -10, color: "#1d4ed8", label: "Kalt" },
    { max: 0, color: "#0ea5e9", label: "Frost" },
    { max: 10, color: "#22d3ee", label: "Kühl" },
    { max: 20, color: "#4ade80", label: "Mild" },
    { max: 25, color: "#facc15", label: "Warm" },
    { max: 30, color: "#fb923c", label: "Heiß" },
    { max: 35, color: "#ef4444", label: "Sehr heiß" },
    { max: Infinity, color: "#991b1b", label: "Extreme Hitze" }
];

function tempBandFor(celsius) {
    if (!Number.isFinite(celsius)) return { color: "#64748b", label: "Unbekannt" };
    return TEMP_BANDS.find(b => celsius <= b.max);
}

// WMO Weather Interpretation Codes – gleiche Gruppierung wie WeatherLayer.js.
const WMO_LABELS = [
    { max: 0, label: "Klar" },
    { max: 3, label: "Bewölkt" },
    { max: 48, label: "Nebel" },
    { max: 57, label: "Niesel" },
    { max: 67, label: "Regen" },
    { max: 77, label: "Schnee" },
    { max: 82, label: "Regenschauer" },
    { max: 86, label: "Schneeschauer" },
    { max: 99, label: "Gewitter" }
];

function weatherLabelFor(code) {
    if (!Number.isFinite(code)) return "Unbekannt";
    return (WMO_LABELS.find(b => code <= b.max) ?? { label: "Unbekannt" }).label;
}

export class WorldWeatherLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "worldweather",
            name: "Weltwetter (Live)",
            icon: "🌡️",
            type: "worldweather",
            dataUrl: null
        });

        this._cells = null;      // Rasterzellen, einmalig berechnet
        this.lastFetchAt = 0;
        this.lastError = "";
    }

    /**
     * Gradnetz aufbauen. Jede Zelle deckt `step`×`step` Grad ab; abgefragt
     * wird ihr Mittelpunkt, gefärbt wird die ganze Fläche.
     */
    _buildGrid() {
        const step = Math.max(2, Number(CFG().gridStepDeg) || DEFAULT_STEP_DEG);
        const latLimit = Math.min(89, Number(CFG().latLimit) || DEFAULT_LAT_LIMIT);
        const cells = [];

        for (let south = -latLimit; south < latLimit; south += step) {
            const north = Math.min(south + step, latLimit);
            for (let west = -180; west < 180; west += step) {
                const east = Math.min(west + step, 180);
                cells.push({
                    id: `worldweather-${south}-${west}`,
                    south, north, west, east,
                    latitude: (south + north) / 2,
                    longitude: (west + east) / 2
                });
            }
        }
        return cells;
    }

    async load() {
        this._cells ??= this._buildGrid();
        await this.refresh();

        // Open-Meteo rechnet seine Modelldaten stündlich neu, und auf einem
        // 15°-Raster ändert sich ohnehin nichts im Minutentakt – stündlich
        // neu abfragen hält den Koordinaten-Verbrauch im Fair-Use-Rahmen
        // (siehe DEFAULT_STEP_DEG). Punktgenaue Minutenwerte liefert weiter
        // WeatherLayer.js an seinen Städten.
        const seconds = CFG().refreshSeconds ?? 3600;
        this.startTimer("poll", seconds * 1000, () => this.refresh());
    }

    async refresh() {
        if (!this.enabled) return;
        if (!this._cells?.length) return;

        const base = CFG().apiUrl || WEATHER_API;
        const params = new URLSearchParams({
            latitude: this._cells.map(c => c.latitude).join(","),
            longitude: this._cells.map(c => c.longitude).join(","),
            current: WEATHER_FIELDS,
            wind_speed_unit: "kmh",
            timezone: "UTC"
        });

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 30_000);
            const res = await fetch(`${base}?${params.toString()}`, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const json = await res.json();
            const results = Array.isArray(json) ? json : [json];
            this._rebuild(results);
            this.lastFetchAt = Date.now();
            this.lastError = "";

        } catch (err) {
            this.lastError = err.message;
            console.warn("[Weltwetter] Abruf fehlgeschlagen:", err.message);
        }
    }

    /** Antworten (gleiche Reihenfolge wie die Anfrage) auf die Zellen legen. */
    _rebuild(results) {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        results.forEach((result, i) => {
            const cell = this._cells[i];
            const current = result?.current;
            if (!cell || !current) return;

            const temperature = Number(current.temperature_2m);
            if (!Number.isFinite(temperature)) return;

            const windSpeed = Number(current.wind_speed_10m);
            const windDirection = Number(current.wind_direction_10m);
            const precipitation = Number(current.precipitation);
            const weatherCode = Number(current.weather_code);

            const obj = normalizeRecord({
                id: cell.id,
                name: `${formatLat(cell.latitude)} ${formatLon(cell.longitude)}`,
                latitude: cell.latitude,
                longitude: cell.longitude,
                altitude: 0,
                bounds: { south: cell.south, north: cell.north, west: cell.west, east: cell.east },
                temperature,
                tempLabel: tempBandFor(temperature).label,
                precipitation: Number.isFinite(precipitation) ? precipitation : 0,
                weatherCode: Number.isFinite(weatherCode) ? weatherCode : null,
                weatherLabel: weatherLabelFor(weatherCode),
                windSpeed: Number.isFinite(windSpeed) ? windSpeed : null,
                windDirection: Number.isFinite(windDirection) ? windDirection : null,
                elevation: Number.isFinite(Number(result.elevation)) ? Number(result.elevation) : null,
                measuredAt: current.time ?? null
            }, "worldweather");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        });
        console.info(`[Weltwetter] ${this.objects.length} Rasterzellen aktualisiert.`);
    }

    createEntity(obj) {
        const m = obj.metadata;
        const band = tempBandFor(m.temperature);
        const opacity = Number(CFG().opacity) || DEFAULT_OPACITY;
        const color = Cesium.Color.fromCssColorString(band.color).withAlpha(opacity);

        return this.dataSource.entities.add({
            id: obj.id,
            // Mittelpunkt trägt die Beschriftung, das Rechteck die Fläche.
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, 0
            ),
            rectangle: {
                coordinates: Cesium.Rectangle.fromDegrees(
                    m.bounds.west, m.bounds.south, m.bounds.east, m.bounds.north
                ),
                // Feste Höhe 0: der Globus testet nicht gegen das Terrain
                // (viewer.js: depthTestAgainstTerrain = false), damit liegt
                // das Raster verlässlich sichtbar auf der Oberfläche.
                height: 0,
                material: color,
                outline: false
            },
            // Temperaturzahl erst beim Hineinzoomen – bei Weltsicht wären
            // 576 Zahlen unlesbar, die Farbfläche trägt dort die Information.
            label: {
                ...this._makeLabel(
                    `${Math.round(m.temperature)}°C`,
                    Cesium.Color.fromCssColorString(band.color)
                ),
                scaleByDistance: new Cesium.NearFarScalar(2e6, 1.0, 1.2e7, 0.0)
            }
        });
    }

    clear() {
        this.stopTimer("poll");
        super.clear();
    }
}

/** 47.5 → "47,5° N" (deutsche Dezimalkomma-Schreibweise wie im übrigen UI) */
function formatLat(lat) {
    const v = Math.abs(lat).toFixed(1).replace(".", ",");
    return `${v}° ${lat >= 0 ? "N" : "S"}`;
}

/** -7.5 → "7,5° W" */
function formatLon(lon) {
    const v = Math.abs(lon).toFixed(1).replace(".", ",");
    return `${v}° ${lon >= 0 ? "O" : "W"}`;
}

export { tempBandFor as worldWeatherTempBandFor, TEMP_BANDS as WORLD_WEATHER_TEMP_BANDS };
