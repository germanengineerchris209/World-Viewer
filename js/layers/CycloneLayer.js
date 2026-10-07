/**
 * CycloneLayer.js – Tropische Wirbelstürme (Atlantik/Ost-/Zentralpazifik).
 *
 * Quelle: NOAA National Hurricane Center, öffentliche US-Regierungsdaten,
 * kein Key nötig: https://www.nhc.noaa.gov/CurrentStorms.json
 * Läuft über den eigenen Server (/api/storms, /api/storms/cone), weil
 * NHC keine CORS-Header sendet (siehe server/dataProxies.mjs).
 *
 * Zuständigkeit des NHC: nur Atlantik sowie Ost-/Zentralpazifik. Andere
 * Ozeanbecken (z.B. Westpazifik/Indischer Ozean, JTWC) sind bewusst
 * nicht Teil dieses Layers (siehe WEB-69).
 *
 * Außerhalb der Hurrikansaison ist "activeStorms" meist leer – das ist
 * der Normalfall, kein Fehler. statusText() macht das in der Sidebar
 * sichtbar, statt eine stillschweigend leere Ebene zu zeigen.
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord, svgDataUri } from "../dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.cyclones ?? {};

/** Farbe nach Klassifikation/Kategorie – stärker = kräftigere Farbe. */
function cycloneColor(classification, category) {
    if (classification === "HU") {
        return category >= 3 ? "#dc2626" : "#f97316";   // schwerer Hurrikan / Kat. 1-2
    }
    if (classification === "TS" || classification === "STS") return "#fbbf24"; // Sturm
    return "#60a5fa";                                    // Tiefdruckgebiet / sonstiges
}

/** Einfaches Doppelspiral-Symbol für Wirbelstürme. */
const CYCLONE_SVG = (color) => `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M16 16 C24 16 26 8 18 6 C11 4 6 9 8 15"
        fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
  <path d="M16 16 C8 16 6 24 14 26 C21 28 26 23 24 17"
        fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
  <circle cx="16" cy="16" r="3" fill="${color}" stroke="#0b0e14" stroke-width="1"/>
</svg>`;

export class CycloneLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "cyclones",
            name: "Wirbelstürme",
            icon: "🌀",
            type: "cyclone",
            dataUrl: null
        });

        this.available = false;
        this.lastError = "";
        this._timer = null;
        this._iconCache = new Map();
        this._coneCache = new Map();   // coneUrl → [[lon,lat], ...] oder null
    }

    async load() {
        await this.refresh();
        const seconds = CFG().refreshSeconds ?? 1200;   // 20 Min., siehe WEB-69
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        if (!this.enabled) return;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20_000);
            const res = await fetch(CFG().apiUrl || "/api/storms", { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            await this._rebuild(data.storms ?? []);
            this.available = true;
            this.lastError = "";

        } catch (err) {
            this.available = false;
            this.lastError = err.message;
            console.info("[Wirbelstürme] nicht verfügbar:", err.message);
        }
    }

    async _rebuild(storms) {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        for (const storm of storms) {
            const obj = normalizeRecord({
                id: storm.id,
                name: storm.name,
                latitude: storm.latitude,
                longitude: storm.longitude,
                altitude: 0,
                ...storm
            }, "cyclone");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }

            if (storm.coneUrl) this._addConePolygon(storm);
        }
        console.info(`[Wirbelstürme] ${this.objects.length} aktive System(e).`);
    }

    createEntity(obj) {
        const m = obj.metadata;
        const color = cycloneColor(m.classification, m.category);

        if (!this._iconCache.has(color)) {
            this._iconCache.set(color, svgDataUri(CYCLONE_SVG(color)));
        }

        const label = m.category
            ? `${obj.name} (Kat. ${m.category})`
            : `${obj.name} (${m.classificationLabel})`;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, 0),
            billboard: {
                image: this._iconCache.get(color),
                width: 30,
                height: 30,
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

    /** Lädt (gecacht) und zeichnet den Vorhersagekegel eines Sturms. */
    async _addConePolygon(storm) {
        let coordinates = this._coneCache.get(storm.coneUrl);
        if (coordinates === undefined) {
            coordinates = await this._fetchCone(storm.coneUrl);
            this._coneCache.set(storm.coneUrl, coordinates);
        }
        if (!coordinates || !this.enabled) return;
        // Zwischenzeitlich neu aufgebaut (neuer Abruf) – nicht mehr anhängen
        if (!this.objects.some(o => o.id === storm.id)) return;

        const color = cycloneColor(storm.classification, storm.category);
        this.dataSource.entities.add({
            id: `${storm.id}-cone`,
            polygon: {
                hierarchy: new Cesium.PolygonHierarchy(
                    coordinates.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat))
                ),
                material: Cesium.Color.fromCssColorString(color).withAlpha(0.15),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.7),
                height: 0
            }
        });
    }

    async _fetchCone(coneUrl) {
        try {
            const url = `/api/storms/cone?url=${encodeURIComponent(coneUrl)}`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20_000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
            return Array.isArray(data.coordinates) ? data.coordinates : null;
        } catch (err) {
            console.info("[Wirbelstürme] Vorhersagekegel nicht abrufbar:", err.message);
            return null;
        }
    }

    /** Hinweis in der Sidebar, solange keine Systeme aktiv oder der Abruf fehlschlägt. */
    statusText() {
        if (!this.available && this.lastError) {
            return `Nicht abrufbar: ${this.lastError}`;
        }
        if (this.available && this.objects.length === 0) {
            return "Derzeit keine aktiven Systeme (Atlantik/Ost-/Zentralpazifik)";
        }
        return null;
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
