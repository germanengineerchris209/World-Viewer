/**
 * EarthquakeLayer.js – Erdbeben der letzten 24 Stunden.
 *
 * Quelle: U.S. Geological Survey (USGS), öffentlich zugänglich, kein Key.
 * Der Dienst sendet CORS-Header, der Browser darf ihn also direkt
 * abfragen – dieser Layer funktioniert auch ohne laufenden Server.
 *
 * Vorgehensweise übernommen aus "God's Eye View" von Bilawal Sidhu
 * (MIT-Lizenz, https://github.com/bilawalsidhu/gods-eye-view).
 * Daten: "Data courtesy of the U.S. Geological Survey".
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord } from "../dataManager.js";

const USGS_FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

const CFG = () => window.WORLD_VIEWER_CONFIG?.earthquakes ?? {};

export class EarthquakeLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "earthquakes",
            name: "Erdbeben",
            icon: "🌋",
            type: "earthquake",
            dataUrl: null
        });

        this.lastFetchAt = 0;
        this.lastError = "";
        this._timer = null;
    }

    async load() {
        await this.refresh();
        const seconds = CFG().refreshSeconds ?? 300;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        if (!this.enabled) return;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12_000);
            const res = await fetch(USGS_FEED, { signal: controller.signal });
            clearTimeout(timer);

            if (!res.ok) throw new Error(`USGS antwortete mit ${res.status}`);
            const geojson = await res.json();

            this._rebuild(geojson.features ?? []);
            this.lastFetchAt = Date.now();
            this.lastError = "";

        } catch (err) {
            this.lastError = err.message;
            console.warn("[Erdbeben] Abruf fehlgeschlagen:", err.message);
        }
    }

    /** Ereignisse neu aufbauen (die Liste ist klein genug dafür). */
    _rebuild(features) {
        const minMagnitude = CFG().minMagnitude ?? 2.5;

        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        for (const feature of features) {
            const magnitude = Number(feature?.properties?.mag);
            if (!Number.isFinite(magnitude) || magnitude < minMagnitude) continue;

            // Die Tiefe steckt in der DRITTEN Koordinate, nicht in properties
            const [lon, lat, depthKm] = feature.geometry?.coordinates ?? [];
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

            const obj = normalizeRecord({
                id: feature.id ?? `quake-${this.objects.length}`,
                name: `M ${magnitude.toFixed(1)}`,
                latitude: lat,
                longitude: lon,
                altitude: 0,
                magnitude,
                depthKm: Number(depthKm) || 0,
                place: feature.properties.place ?? "",
                time: feature.properties.time ?? Date.now(),
                tsunami: feature.properties.tsunami === 1,
                usgsUrl: feature.properties.url ?? "",
                felt: feature.properties.felt ?? null
            }, "earthquake");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        }
    }

    createEntity(obj) {
        const { magnitude, depthKm } = obj.metadata;

        // Farbe nach TIEFE: flache Beben richten den meisten Schaden an
        const color = depthKm < 70 ? "#f87171"        // flach
            : depthKm < 300 ? "#fb923c"               // mittel
            : "#fbbf24";                              // tief

        // Radius exponentiell zur Magnitude – so wie die Energie wächst
        const radius = Math.pow(2, magnitude) * 1000;
        const significant = magnitude >= 5.0;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, 0),
            ellipse: {
                // WICHTIG: feste Zahlen, keine CallbackProperty!
                // Am Boden liegende Ellipsen mit veränderlichen Achsen
                // werden pro Frame neu vernetzt und kosten dann ein
                // Vielfaches an Rechenzeit.
                semiMinorAxis: radius,
                semiMajorAxis: radius,
                material: Cesium.Color.fromCssColorString(color)
                    .withAlpha(significant ? 0.4 : 0.3),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString(color)
                    .withAlpha(significant ? 1.0 : 0.8),
                outlineWidth: significant ? 3 : 2,
                classificationType: Cesium.ClassificationType.TERRAIN
            },
            label: significant ? {
                ...this._makeLabel(obj.name, Cesium.Color.fromCssColorString(color)),
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 2e7, 0.35)
            } : undefined
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
