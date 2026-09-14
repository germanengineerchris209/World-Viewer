/**
 * FireLayer.js – Aktive Brände der letzten 24 Stunden.
 *
 * Quelle: NASA FIRMS (Fire Information for Resource Management System),
 * VIIRS-Daten von NOAA-20, NOAA-21 und Suomi-NPP. Läuft über den eigenen
 * Server (/api/fires), weil der Zugriff einen Key braucht.
 *
 * Vorgehensweise übernommen aus "God's Eye View" von Bilawal Sidhu
 * (MIT-Lizenz, https://github.com/bilawalsidhu/gods-eye-view).
 *
 * Pflichthinweis der NASA:
 * "We acknowledge the use of data and/or imagery from NASA's Fire
 * Information for Resource Management System (FIRMS)
 * (https://earthdata.nasa.gov/firms), part of NASA's Earth Observing
 * System Data and Information System (EOSDIS)."
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord } from "../dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.fires ?? {};

export class FireLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "fires",
            name: "Brände",
            icon: "🔥",
            type: "fire",
            dataUrl: null
        });

        this.available = false;
        this.needsKey = false;
        this.lastError = "";
        this._timer = null;
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
            const timer = setTimeout(() => controller.abort(), 20_000);
            const res = await fetch(CFG().apiUrl || "/api/fires", { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();

            if (res.status === 503 && data.error === "no_key") {
                this.needsKey = true;
                this.available = false;
                this.lastError = data.message ?? "FIRMS_MAP_KEY fehlt";
                return;
            }
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            this._rebuild(data.fires ?? []);
            this.available = true;
            this.needsKey = false;
            this.lastError = "";

        } catch (err) {
            this.available = false;
            this.lastError = err.message;
            console.info("[Brände] nicht verfügbar:", err.message);
        }
    }

    _rebuild(fires) {
        // Weltweit können es zehntausende sein – begrenzen und die
        // stärksten zuerst, sonst leidet die Bildrate
        const limit = CFG().maxFires ?? 1500;
        const strongest = [...fires]
            .sort((a, b) => (b.frp ?? 0) - (a.frp ?? 0))
            .slice(0, limit);

        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        strongest.forEach((fire, index) => {
            const obj = normalizeRecord({
                id: `fire-${index}-${fire.latitude.toFixed(3)}-${fire.longitude.toFixed(3)}`,
                name: "Brandherd",
                latitude: fire.latitude,
                longitude: fire.longitude,
                altitude: 0,
                ...fire
            }, "fire");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        });

        console.info(`[Brände] ${this.objects.length} von ${fires.length} Brandherden dargestellt.`);
    }

    createEntity(obj) {
        const { frp = 0, confidence = 0.5 } = obj.metadata;

        // Hitzewert aus Strahlungsleistung und Konfidenz
        const heat = Math.min(1, Math.sqrt(Math.max(0, frp) / 150) * 0.85 + confidence * 0.15);
        const color = heat > 0.72 ? "#ff3b30"
            : heat > 0.42 ? "#ff8c00"
            : "#ffd400";

        // Punktgröße nach Strahlungsleistung, in Stufen gerundet
        const size = Math.max(6, Math.min(22, Math.round(6 + Math.sqrt(frp) * 1.8)));

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, 0),
            point: {
                pixelSize: size,
                color: Cesium.Color.fromCssColorString(color).withAlpha(0.85),
                outlineWidth: 0,
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.2, 2e7, 0.4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
            // Bewusst ohne Label: bei über tausend Brandherden wäre
            // die Karte sonst unlesbar
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
