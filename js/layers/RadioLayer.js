/**
 * RadioLayer.js – Internetradiosender als Kartenlayer.
 *
 * Quelle: Radio Browser API (https://api.radio-browser.info), öffentlich,
 * ohne Anmeldung und ohne Schlüssel. Die API sendet CORS-Header, ein
 * Server-Proxy ist also nicht nötig (verifiziert per curl gegen
 * de1.api.radio-browser.info und all.api.radio-browser.info).
 *
 * Nur Sender mit Geo-Koordinaten (`geo_lat`/`geo_long`) werden angezeigt –
 * das ist bei der Radio-Browser-Datenbank nur ein Teil des Katalogs, aber
 * genau die, die sich sinnvoll auf der Karte verorten lassen.
 *
 * Empfehlung der API-Betreiber: aussagekräftiger `User-Agent`-Header,
 * kein API-Key nötig, Richtwert 2-3 Anfragen/Sekunde (wir stellen hier
 * nur eine einzige Anfrage pro Aktualisierung).
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord, svgDataUri } from "../dataManager.js";

const RADIO_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <rect x="7" y="15" width="22" height="14" rx="2" fill="#34d399" stroke="#0b2d22" stroke-width="1.2"/>
  <circle cx="13" cy="22" r="3" fill="#0b2d22"/>
  <path d="M20 22 h6 M20 25 h4" stroke="#0b2d22" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M18 15 L23 6" stroke="#34d399" stroke-width="1.6" stroke-linecap="round"/>
  <circle cx="23" cy="6" r="1.6" fill="#34d399"/>
</svg>`;

const CFG = () => window.WORLD_VIEWER_CONFIG?.radio ?? {};

export class RadioLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "radio",
            name: "Radiosender",
            icon: "📻",
            type: "radio",
            dataUrl: null
        });
        this._iconUrl = svgDataUri(RADIO_SVG);
        this.lastError = "";
    }

    async load() {
        await this.refresh();
    }

    async refresh() {
        const cfg = CFG();
        const base = cfg.apiUrl || "https://all.api.radio-browser.info/json/stations/search";
        const limit = cfg.limit ?? 300;
        const userAgent = cfg.userAgent || "WorldViewer/1.0";

        const params = new URLSearchParams({
            hasgeoinfo: "true",
            order: cfg.order || "votes",
            reverse: "true",
            limit: String(limit)
        });

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            const res = await fetch(`${base}?${params.toString()}`, {
                signal: controller.signal,
                // Nur als Kennzeichnung gedacht; die API verlangt keinen Key.
                headers: { "User-Agent": userAgent }
            });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const stations = await res.json();
            this._rebuild(stations);
            this.lastError = "";

        } catch (err) {
            this.lastError = err.message;
            console.warn("[Radio] Sender konnten nicht geladen werden:", err.message);
        }
    }

    _rebuild(stations) {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        for (const station of stations) {
            const lat = Number(station.geo_lat);
            const lon = Number(station.geo_long);
            // Trotz hasgeoinfo=true liefert die API teils Sender ohne
            // brauchbare Koordinaten – hier zusätzlich clientseitig filtern.
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) continue;

            const streamUrl = station.url_resolved || station.url;
            if (!streamUrl) continue;

            const obj = normalizeRecord({
                id: station.stationuuid,
                name: station.name?.trim() || "Unbenannter Sender",
                latitude: lat,
                longitude: lon,
                altitude: 0,
                genre: (station.tags || "").split(",").filter(Boolean).slice(0, 4).join(", "),
                country: station.country || "",
                language: station.language || "",
                codec: station.codec || "",
                bitrate: station.bitrate || 0,
                votes: station.votes || 0,
                homepage: station.homepage || "",
                favicon: station.favicon || "",
                streamUrl,
                stationuuid: station.stationuuid
            }, "radio");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        }
        console.info(`[Radio] ${this.objects.length} Sender mit Geo-Koordinaten geladen.`);
    }

    createEntity(obj) {
        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: this._iconUrl,
                width: 18,
                height: 18,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 5e6, 0.3),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(obj.name, Cesium.Color.fromCssColorString("#34d399")),
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 3e5, 0.0)
            }
        });
    }
}
