/**
 * WeatherLayer.js – Niederschlag und Wind an handkuratierten Städtepunkten.
 *
 * Quelle: Open-Meteo Forecast API (https://open-meteo.com/en/docs),
 * öffentlich, ohne Anmeldung, ohne Schlüssel für nicht-kommerzielle Nutzung
 * (bis 10.000 Aufrufe/Tag) – dieselbe Quelle wie bereits der AQI-Layer
 * (AQILayer.js) nutzt.
 *
 * Analog zum AQI-Layer: keine Senderliste zum Abfragen vorhanden, daher
 * eine handkuratierte Städteliste (data/weather-locations.json, Vorlage:
 * data/aqi-locations.json) in EINER Anfrage abfragen. `latitude`/`longitude`
 * akzeptieren kommaseparierte Listen, die Antwort ist ein Array in
 * derselben Reihenfolge.
 */

import { BaseLayer } from "./BaseLayer.js";
import { loadJSON, normalizeRecord, svgDataUri } from "../dataManager.js";

const WEATHER_API = "https://api.open-meteo.com/v1/forecast";
const WEATHER_FIELDS = "temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m";

const CFG = () => window.WORLD_VIEWER_CONFIG?.weather ?? {};

// Niederschlagsmenge der aktuellen Stunde (mm) – Farbe zeigt die Intensität.
const PRECIP_BANDS = [
    { max: 0, color: "#94a3b8", label: "Trocken" },
    { max: 0.5, color: "#38bdf8", label: "Leicht" },
    { max: 2.5, color: "#3b82f6", label: "Mäßig" },
    { max: 10, color: "#6366f1", label: "Stark" },
    { max: Infinity, color: "#a855f7", label: "Extrem" }
];

function precipBandFor(mm) {
    const value = Number.isFinite(mm) ? mm : 0;
    return PRECIP_BANDS.find(b => value <= b.max);
}

// WMO Weather Interpretation Codes (Open-Meteo-Standard) – nur die groben
// Gruppen, die für ein Lagebild relevant sind.
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

export class WeatherLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "weather",
            name: "Wetter",
            icon: "🌦️",
            type: "weather",
            dataUrl: null
        });

        this._locations = null;     // Städteliste, einmalig geladen
        this._iconByKey = new Map();
        this.lastFetchAt = 0;
        this.lastError = "";
        this._timer = null;
    }

    async load() {
        this._locations ??= await loadJSON("./data/weather-locations.json");
        await this.refresh();

        // Niederschlag/Wind ändern sich schneller als die Luftqualität,
        // aber nicht sekündlich – Standard: alle 15 Minuten neu abfragen.
        const seconds = CFG().refreshSeconds ?? 900;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        if (!this.enabled) return;
        if (!this._locations?.length) return;

        const base = CFG().apiUrl || WEATHER_API;
        const params = new URLSearchParams({
            latitude: this._locations.map(l => l.latitude).join(","),
            longitude: this._locations.map(l => l.longitude).join(","),
            current: WEATHER_FIELDS,
            wind_speed_unit: "kmh",
            timezone: "auto"
        });

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20_000);
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
            console.warn("[Wetter] Abruf fehlgeschlagen:", err.message);
        }
    }

    /** Antworten (gleiche Reihenfolge wie die Anfrage) mit den Städten zusammenführen. */
    _rebuild(results) {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        results.forEach((result, i) => {
            const loc = this._locations[i];
            const current = result?.current;
            if (!loc || !current) return;

            const windSpeed = Number(current.wind_speed_10m);
            const windDirection = Number(current.wind_direction_10m);
            if (!Number.isFinite(windSpeed) && !Number.isFinite(windDirection)) return;

            const obj = normalizeRecord({
                id: loc.id,
                name: loc.name,
                latitude: loc.latitude,
                longitude: loc.longitude,
                altitude: 0,
                country: loc.country,
                temperature: current.temperature_2m ?? null,
                precipitation: Number.isFinite(Number(current.precipitation)) ? Number(current.precipitation) : 0,
                weatherCode: current.weather_code ?? null,
                weatherLabel: weatherLabelFor(current.weather_code),
                windSpeed: Number.isFinite(windSpeed) ? windSpeed : null,
                windDirection: Number.isFinite(windDirection) ? windDirection : null,
                windGusts: current.wind_gusts_10m ?? null,
                measuredAt: current.time ?? null
            }, "weather");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        });
        console.info(`[Wetter] ${this.objects.length} Städte aktualisiert.`);
    }

    /** Pfeil-Icon: Spitze zeigt zur Windrichtung (Herkunft + 180°), Farbe = Niederschlag. */
    _iconFor(color) {
        if (!this._iconByKey.has(color)) {
            const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
  <circle cx="11" cy="11" r="8" fill="${color}" fill-opacity="0.25" stroke="${color}" stroke-width="1.5"/>
  <path d="M11 3 L15 12 L11 9.5 L7 12 Z" fill="${color}" stroke="#0b1220" stroke-width="0.8"/>
</svg>`;
            this._iconByKey.set(color, svgDataUri(svg));
        }
        return this._iconByKey.get(color);
    }

    createEntity(obj) {
        const { precipitation, windSpeed, windDirection, temperature } = obj.metadata;
        const band = precipBandFor(precipitation);
        const windText = windSpeed != null ? `${Math.round(windSpeed)} km/h` : "–";
        const tempText = temperature != null ? `${Math.round(temperature)}°C` : "";
        const labelText = `${obj.name} · ${windText}${tempText ? " · " + tempText : ""}`;

        // Open-Meteo liefert die Richtung, AUS der der Wind weht (meteorologische
        // Konvention). Der Pfeil im Icon zeigt standardmäßig nach Norden/oben,
        // daher +180° um die tatsächliche Windrichtung (Zielrichtung) zu zeigen.
        const rotationDeg = Number.isFinite(windDirection) ? windDirection + 180 : 0;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: this._iconFor(band.color),
                width: 20,
                height: 20,
                rotation: Cesium.Math.toRadians(-rotationDeg),
                alignedAxis: Cesium.Cartesian3.ZERO,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 5e6, 0.4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(labelText, Cesium.Color.fromCssColorString(band.color)),
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 4e6, 0.0)
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
        super.clear();
    }

    _stopTimer() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }
}

export { precipBandFor as weatherPrecipBandFor };
