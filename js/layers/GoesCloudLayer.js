/**
 * GoesCloudLayer.js – Infrarote Satellitenwolken (GOES-Ost/-West, Band 13).
 *
 * Quelle: NASA GIBS (Global Imagery Browse Services), WMTS, öffentlich,
 * ohne Schlüssel, mit CORS-Freigabe (access-control-allow-origin: *),
 * daher direkt im Browser ohne Server-Proxy nutzbar:
 * https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/
 * Layer "GOES-East_ABI_Band13_Clean_Infrared" / "GOES-West_ABI_Band13_Clean_Infrared"
 * (10,3 µm, "Clean Longwave Infrared" – zeigt Wolkenoberkanten/-temperatur,
 * nicht nur sichtbares Licht, funktioniert deshalb auch nachts).
 *
 * WICHTIG zur Abdeckung: GOES-Ost/-West sind geostationär über dem
 * amerikanischen Kontinent/Pazifik – das Sichtfeld deckt NUR Amerika,
 * den Pazifik und den Atlantik ab. Europa/Asien/Afrika bleiben in diesem
 * Overlay leer – das ist der Normalfall, kein Fehler (siehe statusText()).
 *
 * Kein Zeit-Parameter nötig: GIBS löst den WMTS-Pfadteil "default" an
 * Stelle von {Time} serverseitig auf das jeweils neueste verfügbare Bild
 * auf. Den tatsächlichen Zeitstempel liefert GIBS im Response-Header
 * `layer-time-actual` zurück (per CORS freigegeben) – daraus ergibt sich
 * der echte Alters-Hinweis in der Sidebar, statt eines geschätzten Taktes.
 */

import { BaseLayer } from "./BaseLayer.js";

const GIBS_BASE = "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best";
const TILE_MATRIX_SET = "2km";
const MAX_ZOOM = 5;          // laut GIBS-Capabilities die höchste Stufe dieses Produkts
const TILE_SIZE = 512;

const SATELLITES = [
    { id: "east", layer: "GOES-East_ABI_Band13_Clean_Infrared", label: "GOES-Ost" },
    { id: "west", layer: "GOES-West_ABI_Band13_Clean_Infrared", label: "GOES-West" }
];

const COVERAGE_HINT = "Amerika, Pazifik & Atlantik (GOES-Ost/-West-Sichtfeld – " +
    "Europa/Asien/Afrika bleiben absichtlich leer)";

const CFG = () => window.WORLD_VIEWER_CONFIG?.goesClouds ?? {};

export class GoesCloudLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "goesClouds",
            name: "GOES-Infrarot-Wolken",
            icon: "🛰️",
            type: "weather",
            dataUrl: null
        });

        this._imageryLayers = [];   // Cesium.ImageryLayer je Satellit
        this._timestampUtc = null;  // echter Bild-Zeitstempel aus GIBS-Header
        this.lastError = "";
    }

    async load() {
        if (!this._imageryLayers.length) this._addImagery();
        await this._refreshTimestamp();

        // GOES-ABI-Vollscans laufen alle ~10 Minuten; GIBS selbst hat laut
        // Response-Header meist 30–60 Min. Verzögerung (NRT-Verarbeitung) –
        // öfter als alle 10 Minuten nachsehen bringt daher nichts.
        const seconds = CFG().refreshSeconds ?? 600;
        this.startTimer("poll", seconds * 1000, () => this._refreshTimestamp());
    }

    _addImagery() {
        for (const sat of SATELLITES) {
            const url = `${GIBS_BASE}/${sat.layer}/default/default/${TILE_MATRIX_SET}/{z}/{y}/{x}.png`;
            const provider = new Cesium.UrlTemplateImageryProvider({
                url,
                tilingScheme: new Cesium.GeographicTilingScheme(),
                tileWidth: TILE_SIZE,
                tileHeight: TILE_SIZE,
                maximumLevel: MAX_ZOOM,
                credit: new Cesium.Credit(
                    'GOES-IR-Wolken: <a href="https://earthdata.nasa.gov/gibs" ' +
                    'target="_blank" rel="noopener noreferrer">NASA GIBS</a>',
                    true
                )
            });
            const layer = this.viewer.imageryLayers.addImageryProvider(provider);
            layer.alpha = 0.85;
            layer.show = this.enabled;
            this._imageryLayers.push(layer);
        }
    }

    /** Liest den echten Bild-Zeitstempel aus dem GIBS-Response-Header (kein Raten). */
    async _refreshTimestamp() {
        try {
            const url = `${GIBS_BASE}/${SATELLITES[0].layer}/default/default/${TILE_MATRIX_SET}/0/0/0.png`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const actual = res.headers.get("layer-time-actual");
            if (!actual) throw new Error("kein Zeitstempel in der Antwort");

            this._timestampUtc = new Date(actual);
            this.lastError = "";
        } catch (err) {
            this.lastError = err.message;
            console.warn("[GOES-Wolken] Zeitstempel nicht abrufbar:", err.message);
        }
    }

    /** Abdeckungs- und Alters-Hinweis in der Sidebar (siehe BaseLayer.statusText). */
    statusText() {
        if (!this._timestampUtc) {
            return this.lastError
                ? `Zeitstempel nicht abrufbar (${this.lastError}) · Abdeckung: ${COVERAGE_HINT}`
                : `Lade … · Abdeckung: ${COVERAGE_HINT}`;
        }
        const ageMin = Math.max(0, Math.round((Date.now() - this._timestampUtc.getTime()) / 60_000));
        const clock = this._timestampUtc.toISOString().slice(11, 16);
        return `Stand ${clock} UTC (vor ${ageMin} Min.) · Takt ~10 Min. · Abdeckung: ${COVERAGE_HINT}`;
    }

    show() {
        super.show();
        for (const layer of this._imageryLayers) layer.show = true;
    }

    hide() {
        super.hide();
        for (const layer of this._imageryLayers) layer.show = false;
    }

    clear() {
        this.stopTimer("poll");
        for (const layer of this._imageryLayers) this.viewer.imageryLayers.remove(layer, true);
        this._imageryLayers = [];
        this._timestampUtc = null;
        super.clear();
    }

    /** Zähler neben dem Schalter: Anzahl aktiver Satelliten-Kacheldienste (0 oder 2). */
    get count() { return this._imageryLayers.length; }
}
