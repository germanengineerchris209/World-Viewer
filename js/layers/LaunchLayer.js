/**
 * LaunchLayer.js – Raketenstarts der letzten 30 Tage.
 *
 * Quelle: Launch Library 2 von The Space Devs, über den eigenen Server
 * (/api/launches), weil das Kontingent ohne Token bei 15 Abrufen pro
 * Stunde liegt und serverseitig gecacht wird.
 *
 * Vorgehensweise übernommen aus "God's Eye View" von Bilawal Sidhu
 * (MIT-Lizenz, https://github.com/bilawalsidhu/gods-eye-view).
 * Daten: "Launch Library 2 — The Space Devs".
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord, svgDataUri } from "../dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.launches ?? {};

/** Farbe nach Betreiber – wie im Referenzprojekt. */
function providerColor(text) {
    const t = String(text).toUpperCase();
    if (/NASA/.test(t)) return "#ff9f43";
    if (/SPACEX|STARLINK|FALCON/.test(t)) return "#4cc9f0";
    if (/ROCKET LAB|ELECTRON/.test(t)) return "#7bed9f";
    if (/ISRO/.test(t)) return "#ff66c4";
    if (/CNSA|LONG MARCH|CASC/.test(t)) return "#ffd166";
    if (/BLUE ORIGIN|NEW GLENN|NEW SHEPARD/.test(t)) return "#a78bfa";
    if (/ULA|ATLAS|VULCAN|DELTA/.test(t)) return "#f97316";
    if (/ARIANE|ESA|VEGA/.test(t)) return "#60a5fa";
    return "#22e6e6";
}

const ROCKET_SVG = (color) => `
<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
  <path d="M17 3 C21 8 22 15 22 21 L12 21 C12 15 13 8 17 3 Z"
        fill="${color}" stroke="#0b0e14" stroke-width="1.2"/>
  <path d="M12 18 L7 25 L12 24 Z M22 18 L27 25 L22 24 Z"
        fill="${color}" stroke="#0b0e14" stroke-width="1"/>
  <circle cx="17" cy="12" r="2.6" fill="#0b0e14"/>
  <path d="M14 22 L17 31 L20 22 Z" fill="#ff6b35" opacity="0.85"/>
</svg>`;

export class LaunchLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "launches",
            name: "Raketenstarts",
            icon: "🚀",
            type: "launch",
            dataUrl: null
        });

        this.available = false;
        this.lastError = "";
        this._timer = null;
        this._iconCache = new Map();
    }

    async load() {
        await this.refresh();
        const seconds = CFG().refreshSeconds ?? 900;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        if (!this.enabled) return;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            const res = await fetch(CFG().apiUrl || "/api/launches", { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            this._rebuild(data.launches ?? []);
            this.available = true;
            this.lastError = "";

        } catch (err) {
            this.available = false;
            this.lastError = err.message;
            // Ohne Server gibt es diese Ebene schlicht nicht – kein Drama
            console.info("[Raketenstarts] nicht verfügbar:", err.message);
        }
    }

    _rebuild(launches) {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        for (const launch of launches) {
            const obj = normalizeRecord({
                id: launch.id,
                name: launch.name,
                latitude: launch.latitude,
                longitude: launch.longitude,
                altitude: 0,
                ...launch,
                wikipedia: launch.provider || ""
            }, "launch");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        }
        console.info(`[Raketenstarts] ${this.objects.length} Starts der letzten 30 Tage.`);
    }

    createEntity(obj) {
        const m = obj.metadata;
        const color = providerColor(`${m.provider} ${m.name} ${m.missionName}`);

        if (!this._iconCache.has(color)) {
            this._iconCache.set(color, svgDataUri(ROCKET_SVG(color)));
        }

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, 0),
            billboard: {
                image: this._iconCache.get(color),
                width: 26,
                height: 26,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 1e7, 0.35),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(m.name, Cesium.Color.fromCssColorString(color)),
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e6, 0.0)
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
