/**
 * CameraLayer.js – Öffentliche Kameras.
 *
 * Zwei Quellen werden zusammengeführt:
 *
 *   1. data/cameras.json – handverlesene Standorte (München, Hamburg,
 *      Times Square, Venedig …) mit teils mehreren Ansichten je Punkt.
 *
 *   2. Öffentliche Verkehrskamera-Kataloge über den eigenen Server
 *      (/api/cctv): Transport for London (JamCams), Caltrans
 *      (Kalifornien) und City of Austin. Das sind mehrere hundert
 *      Kameras, die automatisch aktuell bleiben.
 *      Übernommen aus "God's Eye View" von Bilawal Sidhu (MIT-Lizenz).
 *
 * Ohne laufenden Server bleiben nur die handverlesenen Kameras – die
 * Kataloge sind nicht CORS-freigegeben.
 */

import { BaseLayer } from "./BaseLayer.js";
import { svgDataUri, normalizeRecord } from "../dataManager.js";

const CAMERA_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <rect x="6" y="12" width="16" height="12" rx="2" fill="#c084fc" stroke="#2a1140" stroke-width="1.2"/>
  <path d="M22 15 L30 11 L30 25 L22 21 Z" fill="#c084fc" stroke="#2a1140" stroke-width="1.2"/>
  <circle cx="14" cy="18" r="3" fill="#2a1140"/>
</svg>`;

export class CameraLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "cameras",
            name: "Cameras",
            icon: "📷",
            type: "camera",
            dataUrl: "./data/cameras.json"
        });
        this._iconUrl = svgDataUri(CAMERA_SVG);
        this.catalogCount = 0;
        this.catalogSources = [];
    }

    /** Erst die eigenen Kameras, dann die öffentlichen Kataloge. */
    async load() {
        await super.load();
        await this._loadPublicCatalog();
    }

    /**
     * Lädt die Verkehrskamera-Kataloge über den Server.
     * Schlägt das fehl (kein Server), bleibt es bei den eigenen Kameras.
     */
    async _loadPublicCatalog() {
        const cfg = window.WORLD_VIEWER_CONFIG?.cameras ?? {};
        if (cfg.usePublicCatalog === false) return;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20_000);
            const res = await fetch(cfg.catalogUrl || "/api/cctv", { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            this.catalogSources = data.sources ?? [];

            for (const cam of data.cameras ?? []) {
                const obj = normalizeRecord({
                    id: cam.id,
                    name: cam.name,
                    latitude: cam.latitude,
                    longitude: cam.longitude,
                    altitude: 8,
                    cameraType: "Verkehrskamera",
                    status: "online",
                    location: cam.city ?? "",
                    streamSource: cam.provider ?? "",
                    attribution: cam.attribution ?? "",
                    // Verkehrskameras liefern ein Standbild, das sich erneuert
                    stream: {
                        label: "Live",
                        type: "image",
                        url: cam.imageUrl,
                        refreshSeconds: cam.refreshSeconds ?? 180,
                        pageUrl: cam.pageUrl ?? "",
                        // Diese Bilder brauchen fast immer den Proxy
                        viaProxy: true
                    },
                    publicCatalog: true
                }, "camera");

                const entity = this.createEntity(obj);
                if (entity) {
                    entity.worldViewerObject = obj;
                    this.entityById.set(obj.id, entity);
                    this.objects.push(obj);
                    this.catalogCount++;
                }
            }
            console.info(`[Cameras] ${this.catalogCount} öffentliche Verkehrskameras geladen.`);

        } catch (err) {
            console.info("[Cameras] Öffentliche Kataloge nicht verfügbar:", err.message);
        }
    }

    createEntity(obj) {
        const isOnline = (obj.metadata.status ?? "online") === "online";

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: this._iconUrl,
                width: obj.metadata.publicCatalog ? 16 : 22,
                height: obj.metadata.publicCatalog ? 16 : 22,
                color: isOnline ? Cesium.Color.WHITE : Cesium.Color.GRAY,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 5e6, 0.3),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(obj.name, Cesium.Color.fromCssColorString("#c084fc")),
                // Kamera-Labels erst beim Heranzoomen einblenden;
                // Katalogkameras noch später, sonst wird es unlesbar
                scaleByDistance: obj.metadata.publicCatalog
                    ? new Cesium.NearFarScalar(1e4, 1.0, 3e5, 0.0)
                    : new Cesium.NearFarScalar(5e4, 1.0, 2e6, 0.0)
            }
        });
    }
}
