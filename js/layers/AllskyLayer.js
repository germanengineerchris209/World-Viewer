/**
 * AllskyLayer.js – Allsky-Kameras (Ganzhimmelkameras) weltweit.
 *
 * Allsky-Kameras blicken mit einem Fisheye-Objektiv senkrecht nach oben und
 * zeigen den kompletten Himmel von Horizont zu Horizont. Sternwarten nutzen
 * sie zur Wolken- und Meteorüberwachung; nachts sind Milchstraße, Polarlichter
 * und Feuerkugeln zu sehen.
 *
 * Zwei Quellen werden zusammengeführt – das gleiche Muster wie CameraLayer:
 *
 *   1. data/allsky-cameras.json – handverlesene, bekannte Standorte:
 *      die Allskycam der Sternwarte Rotheul (WEB-80), die Ganzhimmelkamera
 *      am dänischen 1,54-m-Teleskop der ESO-La-Silla-Sternwarte, die
 *      Sternwarte Hannover u.a.
 *
 *   2. Die öffentliche Allsky-Karte von Thomas Jacquin über den eigenen
 *      Server (/api/allsky). Dort melden mehrere hundert Betreiber ihre
 *      Kameras samt Koordinaten – der Katalog bleibt so automatisch aktuell.
 *
 * Ohne laufenden Server bleiben nur die handverlesenen Kameras, weil die
 * Allsky-Karte kein CORS erlaubt.
 */

import { BaseLayer } from "./BaseLayer.js";
import { svgDataUri, normalizeRecord } from "../dataManager.js";

/* Fisheye-Kuppel: Halbkugel mit Sternen – unterscheidbar von der
   Verkehrskamera (Gehäuse-Symbol) des CameraLayer. */
const ALLSKY_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <path d="M5 25 A13 13 0 0 1 31 25 Z" fill="#1e3a5f" stroke="#7dd3fc" stroke-width="1.6"/>
  <circle cx="13" cy="20" r="1.3" fill="#e0f2fe"/>
  <circle cx="18" cy="15" r="1.6" fill="#f0f9ff"/>
  <circle cx="23" cy="20" r="1.3" fill="#e0f2fe"/>
  <circle cx="18" cy="22" r="1" fill="#bae6fd"/>
  <rect x="4" y="25" width="28" height="2.6" rx="1.3" fill="#7dd3fc"/>
</svg>`;

const ALLSKY_COLOR = "#7dd3fc";

export class AllskyLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "allsky",
            name: "Allsky-Kameras",
            icon: "🌌",
            type: "allsky",
            dataUrl: "./data/allsky-cameras.json"
        });
        this._iconUrl = svgDataUri(ALLSKY_SVG);
        this.catalogCount = 0;
        this.catalogSource = null;
    }

    /** Erst die bekannten Sternwarten, dann die gemeldeten Kameras. */
    async load() {
        await super.load();
        await this._loadPublicCatalog();
    }

    /**
     * Lädt die Allsky-Karte über den Server. Schlägt das fehl (kein Server),
     * bleibt es bei den handverlesenen Kameras.
     */
    async _loadPublicCatalog() {
        const cfg = window.WORLD_VIEWER_CONFIG?.allsky ?? {};
        if (cfg.usePublicCatalog === false) return;

        // Doppelte vermeiden: die handverlesenen Kameras stehen im Katalog
        // teils ebenfalls – der gepflegte Datensatz hat Vorrang.
        const knownUrls = new Set(
            this.objects.flatMap(obj => this._streamUrlsOf(obj.metadata)));

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20_000);
            const res = await fetch(cfg.catalogUrl || "/api/allsky", { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            this.catalogSource = data.source ?? null;

            for (const cam of data.cameras ?? []) {
                if (knownUrls.has(cam.imageUrl)) continue;

                const obj = normalizeRecord({
                    id: cam.id,
                    name: cam.name,
                    latitude: cam.latitude,
                    longitude: cam.longitude,
                    altitude: 12,
                    cameraType: "Allsky-Kamera",
                    status: "online",
                    location: cam.location ?? "",
                    operator: cam.owner ?? "",
                    hardware: [cam.camera, cam.lens].filter(Boolean).join(" · "),
                    streamSource: "Allsky-Karte",
                    attribution: data.attribution ?? "",
                    // Allsky-Software schreibt image.jpg fortlaufend neu
                    stream: {
                        label: "Himmel live",
                        type: "image",
                        url: cam.imageUrl,
                        refreshSeconds: cam.refreshSeconds ?? 60,
                        pageUrl: cam.websiteUrl ?? ""
                        // Bewusst ohne viaProxy: Die Erlaubnisliste des
                        // Kamera-Proxys stammt nur aus den eigenen
                        // Datensätzen, nicht aus dem fremden Katalog.
                        // Die gemeldeten Kameras erlauben Hotlinks fast
                        // immer; sonst greift die Fehlermeldung des Players.
                    },
                    publicCatalog: true
                }, "allsky");

                const entity = this.createEntity(obj);
                if (entity) {
                    entity.worldViewerObject = obj;
                    this.entityById.set(obj.id, entity);
                    this.objects.push(obj);
                    this.catalogCount++;
                }
            }
            console.info(`[Allsky] ${this.catalogCount} gemeldete Allsky-Kameras geladen.`);

        } catch (err) {
            console.info("[Allsky] Öffentlicher Katalog nicht verfügbar:", err.message);
        }
    }

    /** Alle Bild-URLs eines Datensatzes – für den Dubletten-Abgleich. */
    _streamUrlsOf(meta) {
        const urls = [];
        if (meta?.stream?.url) urls.push(meta.stream.url);
        for (const s of meta?.streams ?? []) if (s?.url) urls.push(s.url);
        return urls;
    }

    createEntity(obj) {
        const fromCatalog = obj.metadata.publicCatalog === true;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: this._iconUrl,
                width: fromCatalog ? 16 : 24,
                height: fromCatalog ? 16 : 24,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 8e6, 0.35),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(obj.name, Cesium.Color.fromCssColorString(ALLSKY_COLOR)),
                // Die gemeldeten Kameras stehen dicht – Labels erst spät zeigen
                scaleByDistance: fromCatalog
                    ? new Cesium.NearFarScalar(5e4, 1.0, 6e5, 0.0)
                    : new Cesium.NearFarScalar(2e5, 1.0, 4e6, 0.0)
            }
        });
    }

    statusText() {
        if (this.catalogCount > 0) return null;
        return "nur bekannte Sternwarten – Katalog braucht den Server";
    }
}
