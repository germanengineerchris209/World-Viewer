/**
 * AQILayer.js – Luftqualität (PM2.5, PM10, O3, NO2, Euro-/US-AQI)
 * an handkuratierten Städtepunkten.
 *
 * Quelle: Open-Meteo Air Quality API (https://open-meteo.com/en/docs/air-quality-api),
 * öffentlich, ohne Anmeldung, ohne Schlüssel für nicht-kommerzielle Nutzung.
 * CORS ist gesetzt (`Access-Control-Allow-Origin: *`, per curl gegen
 * air-quality-api.open-meteo.com verifiziert), ein Server-Proxy ist daher
 * nicht nötig.
 *
 * Die API liefert selbst keine Senderliste wie Radio Browser – Werte
 * müssen pro Koordinate abgefragt werden. Statt beliebiger Klicks holt
 * dieser Layer die Werte für eine handkuratierte Liste von Großstädten
 * (data/aqi-locations.json) in EINER Anfrage: `latitude`/`longitude`
 * akzeptieren kommaseparierte Listen, die Antwort ist dann ein Array in
 * derselben Reihenfolge.
 */

import { BaseLayer } from "./BaseLayer.js";
import { loadJSON, normalizeRecord, svgDataUri } from "../dataManager.js";

const AQI_API = "https://air-quality-api.open-meteo.com/v1/air-quality";
const AQI_FIELDS = "pm10,pm2_5,ozone,nitrogen_dioxide,european_aqi,us_aqi";

const CFG = () => window.WORLD_VIEWER_CONFIG?.aqi ?? {};

// Europäischer AQI (EAQI): offizielle Open-Meteo-Skala, 0-20 = Gut ... >100 = Extrem schlecht.
const EU_BANDS = [
    { max: 20, color: "#34d399", label: "Gut" },
    { max: 40, color: "#a3e635", label: "Mäßig" },
    { max: 60, color: "#facc15", label: "Mittelmäßig" },
    { max: 80, color: "#fb923c", label: "Schlecht" },
    { max: 100, color: "#f87171", label: "Sehr schlecht" },
    { max: Infinity, color: "#c084fc", label: "Extrem schlecht" }
];

// US-AQI (EPA): nur als Rückfallebene, falls european_aqi mal fehlt.
const US_BANDS = [
    { max: 50, color: "#34d399", label: "Gut" },
    { max: 100, color: "#a3e635", label: "Mäßig" },
    { max: 150, color: "#facc15", label: "Ungesund (empfindl. Gruppen)" },
    { max: 200, color: "#fb923c", label: "Ungesund" },
    { max: 300, color: "#f87171", label: "Sehr ungesund" },
    { max: Infinity, color: "#c084fc", label: "Gefährlich" }
];

function bandFor(europeanAqi, usAqi) {
    if (Number.isFinite(europeanAqi)) return EU_BANDS.find(b => europeanAqi <= b.max);
    if (Number.isFinite(usAqi)) return US_BANDS.find(b => usAqi <= b.max);
    return { color: "#94a3b8", label: "Unbekannt" };
}

export class AQILayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "aqi",
            name: "Luftqualität",
            icon: "🌫️",
            type: "aqi",
            dataUrl: null
        });

        this._locations = null;     // Städteliste, einmalig geladen
        this._iconByColor = new Map();
        this.lastFetchAt = 0;
        this.lastError = "";
        this._timer = null;
    }

    async load() {
        this._locations ??= await loadJSON("./data/aqi-locations.json");
        await this.refresh();

        // Luftqualität ändert sich stündlich – häufiger nachfragen bringt nichts.
        const seconds = CFG().refreshSeconds ?? 1800;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        if (!this.enabled) return;
        if (!this._locations?.length) return;

        const base = CFG().apiUrl || AQI_API;
        const params = new URLSearchParams({
            latitude: this._locations.map(l => l.latitude).join(","),
            longitude: this._locations.map(l => l.longitude).join(","),
            current: AQI_FIELDS,
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
            console.warn("[Luftqualität] Abruf fehlgeschlagen:", err.message);
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

            const europeanAqi = Number(current.european_aqi);
            const usAqi = Number(current.us_aqi);
            if (!Number.isFinite(europeanAqi) && !Number.isFinite(usAqi)) return;

            const obj = normalizeRecord({
                id: loc.id,
                name: loc.name,
                latitude: loc.latitude,
                longitude: loc.longitude,
                altitude: 0,
                country: loc.country,
                europeanAqi: Number.isFinite(europeanAqi) ? europeanAqi : null,
                usAqi: Number.isFinite(usAqi) ? usAqi : null,
                pm2_5: current.pm2_5 ?? null,
                pm10: current.pm10 ?? null,
                ozone: current.ozone ?? null,
                nitrogenDioxide: current.nitrogen_dioxide ?? null,
                measuredAt: current.time ?? null
            }, "aqi");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        });
        console.info(`[Luftqualität] ${this.objects.length} Städte aktualisiert.`);
    }

    _iconFor(color) {
        if (!this._iconByColor.has(color)) {
            const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
  <circle cx="11" cy="11" r="8" fill="${color}" fill-opacity="0.85" stroke="#0b1220" stroke-width="1.5"/>
</svg>`;
            this._iconByColor.set(color, svgDataUri(svg));
        }
        return this._iconByColor.get(color);
    }

    createEntity(obj) {
        const { europeanAqi, usAqi } = obj.metadata;
        const band = bandFor(europeanAqi, usAqi);
        const value = europeanAqi ?? usAqi;
        const labelText = value != null ? `${obj.name} · AQI ${value}` : obj.name;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: this._iconFor(band.color),
                width: 16,
                height: 16,
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

export { bandFor as aqiBandFor };
