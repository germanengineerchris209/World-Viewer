/**
 * RadiationLayer.js – Globales Strahlungsmessnetz (Safecast), WEB-154.
 *
 * Quelle: Safecast API (https://api.safecast.org/en-US/measurements.json) –
 * Bürger-/Community-Messnetz (u.a. Nachwirkung Fukushima), CC0-Lizenz,
 * kein Key, kein Account (siehe WEB-140 Kandidat A).
 *
 * CORS ist auf "safecast.org" beschränkt (per curl verifiziert), ein
 * Browser darf die API also nicht direkt abfragen. Läuft daher über den
 * eigenen Server (/api/radiation), der zusätzlich ein Zeitfenster filtert
 * und pro Gerät/Standort nur den jüngsten Wert behält (siehe
 * server/dataProxies.mjs) – sonst würde ein einzelner fahrender
 * bGeigie-Logger eine dichte Punktspur statt eines Sensornetzes zeigen.
 *
 * Die Farbskala orientiert sich an der µSv/h-Dosisleistung. Für Geräte,
 * die nur CPM (Impulse/Minute) melden, rechnet der Server grob um – das
 * ist nur eine Näherung für die Einfärbung, der Originalwert bleibt im
 * Detailpanel erhalten.
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord, svgDataUri } from "../dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.radiation ?? {};

// Dosisschwellen in µSv/h, angelehnt an natürliche Hintergrundstrahlung
// (~0.05-0.3 µSv/h) bis deutlich erhöhte Werte. Ampel analog AQILayer.js.
const BANDS = [
    { max: 0.2, color: "#34d399", label: "Normal" },
    { max: 0.5, color: "#a3e635", label: "Leicht erhöht" },
    { max: 1.0, color: "#facc15", label: "Erhöht" },
    { max: 5.0, color: "#fb923c", label: "Deutlich erhöht" },
    { max: 20, color: "#f87171", label: "Hoch" },
    { max: Infinity, color: "#c084fc", label: "Extrem hoch" }
];

function bandFor(usvEquivalent) {
    if (!Number.isFinite(usvEquivalent)) return { color: "#94a3b8", label: "Unbekannt" };
    return BANDS.find(b => usvEquivalent <= b.max);
}

export class RadiationLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "radiation",
            name: "Strahlungsmessnetz",
            icon: "☢️",
            type: "radiation",
            dataUrl: null
        });

        this.available = false;
        this.lastError = "";
        this._iconByColor = new Map();
    }

    async load() {
        await this.refresh();
        // Daten laufen ohnehin mit ~10 Min. Verzug ein (siehe Server-TTL).
        const seconds = CFG().refreshSeconds ?? 600;
        this.startTimer("poll", seconds * 1000, () => this.refresh());
    }

    async refresh() {
        if (!this.enabled) return;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20_000);
            const res = await fetch(CFG().apiUrl || "/api/radiation", { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            this._rebuild(data.points ?? []);
            this.available = true;
            this.lastError = "";

        } catch (err) {
            this.available = false;
            this.lastError = err.message;
            console.info("[Strahlungsmessnetz] nicht verfügbar:", err.message);
        }
    }

    _rebuild(points) {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        for (const point of points) {
            const obj = normalizeRecord({
                id: point.id,
                name: point.locationName || "Messpunkt",
                latitude: point.latitude,
                longitude: point.longitude,
                altitude: 0,
                value: point.value,
                unit: point.unit,
                usvEquivalent: point.usvEquivalent,
                capturedAt: point.capturedAt
            }, "radiation");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        }
        console.info(`[Strahlungsmessnetz] ${this.objects.length} Messpunkte aktualisiert.`);
    }

    _iconFor(color) {
        if (!this._iconByColor.has(color)) {
            const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <circle cx="9" cy="9" r="6.5" fill="${color}" fill-opacity="0.85" stroke="#0b1220" stroke-width="1.5"/>
</svg>`;
            this._iconByColor.set(color, svgDataUri(svg));
        }
        return this._iconByColor.get(color);
    }

    createEntity(obj) {
        const { usvEquivalent, value, unit } = obj.metadata;
        const band = bandFor(usvEquivalent);
        const displayValue = unit === "usv" ? `${value} µSv/h` : `${value} CPM`;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: this._iconFor(band.color),
                width: 14,
                height: 14,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 5e6, 0.4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(displayValue, Cesium.Color.fromCssColorString(band.color)),
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 3e6, 0.0)
            }
        });
    }

    statusText() {
        if (!this.available) return this.lastError ? `Fehler: ${this.lastError}` : "lädt…";
        if (!this.objects.length) return "derzeit keine Messungen im Zeitfenster";
        return null;
    }

    clear() {
        this.stopTimer("poll");
        super.clear();
    }
}

export { bandFor as radiationBandFor };
