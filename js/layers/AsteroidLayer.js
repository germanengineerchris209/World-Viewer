/**
 * AsteroidLayer.js – Erdnahe Asteroiden (NEOs) der nächsten 7 Tage.
 *
 * Quelle: NASA NeoWs ("Near Earth Object Web Service") über den eigenen
 * Server (/api/asteroids), weil der Key dort geheim bleiben muss und das
 * Kontingent ohne eigenen Key (DEMO_KEY) bei 30 Abrufen/Stunde liegt.
 *
 * Darstellung: NeoWs liefert nur die reale Annäherungsdistanz, KEINE
 * Richtung. Die Positionen sind deshalb – wie die vereinfachte
 * Kreisbahn im Satelliten-Layer bei fehlenden TLE-Daten – eine
 * stilisierte Visualisierung: stabile Pseudo-Zufallsrichtung je
 * Asteroid-ID, Höhe gestaucht-logarithmisch nach relativer Nähe
 * innerhalb der aktuell geladenen Liste. Die echten Werte (km,
 * Monddistanzen) stehen im Detailpanel.
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord, svgDataUri } from "../dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.asteroids ?? {};

const EARTH_RADIUS_M = 6_371_000;
const MIN_ALT_M = 800_000;       // nächster Ring: knapp über LEO
const MAX_ALT_M = 60_000_000;    // äußerster Ring: deutlich jenseits GEO

/** Stabiler String-Hash (FNV-1a-artig) für eine deterministische Pseudo-Position. */
function hashToUnit(id) {
    let h = 2166136261;
    for (let i = 0; i < id.length; i++) {
        h ^= id.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 1_000_000) / 1_000_000; // [0, 1)
}

function stablePosition(id) {
    const a = hashToUnit(`${id}:lat`);
    const b = hashToUnit(`${id}:lon`);
    return {
        latitude: (a * 2 - 1) * 70,   // Pole aussparen
        longitude: (b * 2 - 1) * 180
    };
}

function asteroidColor(hazardous) {
    return hazardous ? "#ff4d4d" : "#8bd3ff";
}

const ASTEROID_SVG = (color) => `
<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
  <path d="M13 2 L19 5 L23 11 L20 18 L13 24 L6 20 L2 13 L5 6 Z"
        fill="${color}" stroke="#0b0e14" stroke-width="1.2"/>
  <circle cx="10" cy="10" r="1.6" fill="#0b0e14" opacity="0.55"/>
  <circle cx="16" cy="15" r="1.1" fill="#0b0e14" opacity="0.45"/>
</svg>`;

export class AsteroidLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "asteroids",
            name: "Asteroiden",
            icon: "☄️",
            type: "asteroid",
            dataUrl: null
        });

        this.available = false;
        this.lastError = "";
        this._timer = null;
        this._iconCache = new Map();
    }

    async load() {
        await this.refresh();
        const seconds = CFG().refreshSeconds ?? 3600;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        if (!this.enabled) return;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            const res = await fetch(CFG().apiUrl || "/api/asteroids", { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            this._rebuild(data.asteroids ?? []);
            this.available = true;
            this.lastError = "";

        } catch (err) {
            this.available = false;
            this.lastError = err.message;
            // Ohne Server gibt es diese Ebene schlicht nicht – kein Drama
            console.info("[Asteroiden] nicht verfügbar:", err.message);
        }
    }

    _rebuild(asteroids) {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        const distances = asteroids
            .map(a => a.missDistanceKm)
            .filter(d => Number.isFinite(d));
        const minKm = distances.length ? Math.min(...distances) : 0;
        const maxKm = distances.length ? Math.max(...distances) : 1;

        for (const asteroid of asteroids) {
            const { latitude, longitude } = stablePosition(asteroid.id);
            const altitude = this._scaledAltitude(asteroid.missDistanceKm, minKm, maxKm);

            const obj = normalizeRecord({
                ...asteroid,
                id: `asteroid-${asteroid.id}`,
                name: asteroid.name,
                latitude,
                longitude,
                altitude
            }, "asteroid");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        }
        console.info(`[Asteroiden] ${this.objects.length} Annäherungen in den nächsten 7 Tagen.`);
    }

    /** Logarithmisch gestauchte Höhe – nur zur relativen Einordnung, nicht maßstabsgetreu. */
    _scaledAltitude(km, minKm, maxKm) {
        if (!Number.isFinite(km) || maxKm <= minKm) return MIN_ALT_M;
        const logMin = Math.log10(minKm + 1);
        const logMax = Math.log10(maxKm + 1);
        const t = (Math.log10(km + 1) - logMin) / (logMax - logMin || 1);
        return MIN_ALT_M + t * (MAX_ALT_M - MIN_ALT_M);
    }

    createEntity(obj) {
        const m = obj.metadata;
        const color = asteroidColor(m.hazardous);
        const diameter = m.diameterMaxM ?? 50;
        const size = Math.min(34, Math.max(14, 14 + Math.log10(diameter + 1) * 6));

        if (!this._iconCache.has(color)) {
            this._iconCache.set(color, svgDataUri(ASTEROID_SVG(color)));
        }

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude),
            billboard: {
                image: this._iconCache.get(color),
                width: size,
                height: size,
                scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 5e7, 0.3),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(m.name, Cesium.Color.fromCssColorString(color)),
                scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 2e7, 0.0)
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

    statusText() {
        if (!this.available && this.lastError) return `nicht verfügbar: ${this.lastError}`;
        return "Position stilisiert (Richtung unbekannt) – echte Distanz im Detailpanel";
    }

    _stopTimer() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }
}
