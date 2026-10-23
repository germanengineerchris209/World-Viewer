/**
 * TsunamiAlertLayer.js – Aktive Tsunami-Warnungen (NOAA/NWS).
 *
 * Quelle: NOAA/NWS Tsunami Warning Centers (PTWC Honolulu + NTWC Palmer,
 * AK), öffentliche US-Regierungsdaten, kein Key nötig. Die beiden
 * Zentren zusammen decken den internationalen Pazifikraum sowie die
 * US-/Kanada-Küsten inkl. Atlantik/Golf/Karibik ab.
 * Läuft über den eigenen Server (/api/tsunami), weil die Atom-Feeds
 * weder CORS senden noch JSON liefern (siehe server/dataProxies.mjs).
 *
 * Nicht zu verwechseln mit der reinen Erdbeben-Magnitude
 * (EarthquakeLayer.js): Dieser Layer zeigt die amtliche
 * Tsunami-Einschätzung der Warnzentren, als Ampel wie bei
 * Vulkanen/Erdbeben: Information (grün) → Watch (gelb) →
 * Advisory (orange) → Warning (rot).
 *
 * Der Feed enthält die meiste Zeit nur unbedrohliche
 * Informationsmeldungen zu Erdbeben ohne Tsunami-Gefahr – das ist
 * der Normalfall, kein Fehler. statusText() macht das in der Sidebar
 * sichtbar.
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord, svgDataUri } from "../dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.tsunamiAlerts ?? {};

/** Warndreieck mit Ausrufezeichen, Farbe nach Ampel-Stufe. */
const TSUNAMI_SVG = (color) => `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M16 4 L29 27 L3 27 Z" fill="${color}" stroke="#0b0e14" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="M16 11 L16 20" stroke="#0b0e14" stroke-width="2.4" stroke-linecap="round"/>
  <circle cx="16" cy="23.5" r="1.4" fill="#0b0e14"/>
</svg>`;

export class TsunamiAlertLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "tsunamiAlerts",
            name: "Tsunami-Warnungen",
            icon: "🌊",
            type: "tsunamiAlert",
            dataUrl: null
        });

        this.available = false;
        this.lastError = "";
        this._iconCache = new Map();
    }

    async load() {
        await this.refresh();
        const seconds = CFG().refreshSeconds ?? 120;   // Warnmeldung: kurzes Intervall
        this.startTimer("poll", seconds * 1000, () => this.refresh());
    }

    async refresh() {
        if (!this.enabled) return;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            const res = await fetch(CFG().apiUrl || "/api/tsunami", { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            this._rebuild(data.alerts ?? []);
            this.available = true;
            this.lastError = "";

        } catch (err) {
            this.available = false;
            this.lastError = err.message;
            console.info("[Tsunami-Warnungen] nicht verfügbar:", err.message);
        }
    }

    _rebuild(alerts) {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        for (const alert of alerts) {
            const obj = normalizeRecord({
                id: alert.id,
                name: alert.affectedRegion || alert.title,
                latitude: alert.latitude,
                longitude: alert.longitude,
                altitude: 0,
                ...alert
            }, "tsunamiAlert");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        }
        console.info(`[Tsunami-Warnungen] ${this.objects.length} Meldung(en).`);
    }

    createEntity(obj) {
        const m = obj.metadata;
        const color = m.severityColor || "#a3a3a3";

        if (!this._iconCache.has(color)) {
            this._iconCache.set(color, svgDataUri(TSUNAMI_SVG(color)));
        }

        const label = `${obj.name} (${m.severityLabel})`;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, 0),
            billboard: {
                image: this._iconCache.get(color),
                width: 28,
                height: 28,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.2, 1.5e7, 0.4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(label, Cesium.Color.fromCssColorString(color)),
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 1e7, 0.35)
            }
        });
    }

    /** Hinweis in der Sidebar, solange keine Meldungen aktiv oder der Abruf fehlschlägt. */
    statusText() {
        if (!this.available && this.lastError) {
            return `Nicht abrufbar: ${this.lastError}`;
        }
        if (this.available && this.objects.length === 0) {
            return "Derzeit keine Meldungen";
        }
        return null;
    }

    clear() {
        this.stopTimer("poll");
        super.clear();
    }
}
