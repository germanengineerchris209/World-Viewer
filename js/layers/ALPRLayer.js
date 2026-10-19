/**
 * ALPRLayer.js – Kennzeichenleser-Standorte (ALPR/ANPR) aus OpenStreetMap.
 *
 * Quelle ist die DeFlock-Community (https://deflock.me): sie kartiert
 * Kennzeichenleser als gewöhnliche OSM-Knoten/-Wege
 * (man_made=surveillance + surveillance:type=ALPR/ANPR) und reichert sie
 * mit Gerätedaten an (Hersteller, Modell, Blickrichtung).
 *
 * WICHTIG – Datenschutzgrenze: Dieser Layer zeigt AUSSCHLIESSLICH
 * Standorte und Gerätetags. OSM führt an diesen Knoten grundsätzlich
 * keine Kennzeichen-, Fahrzeug- oder Personendaten, und der eigene
 * Server (/api/alpr, siehe server/dataProxies.mjs) reicht ohnehin nur
 * eine feste Whitelist an Feldern durch.
 *
 * Abgefragt wird – wie bei AircraftLayer – immer nur der sichtbare
 * Kartenausschnitt über den Server (Overpass-Proxy), der die Antwort
 * eine Weile zwischenspeichert. Einmal geladene Standorte bleiben auf
 * der Karte (Kameras verschwinden nicht wieder), neue kommen beim
 * Schwenken/Zoomen dazu.
 *
 * Die Kartierung ist Crowd-Sourcing und bleibt unvollständig – das wird
 * über statusText() dauerhaft in der Sidebar angezeigt, nicht nur bei
 * leerem Ergebnis.
 */

import { BaseLayer } from "./BaseLayer.js";
import { svgDataUri, normalizeRecord } from "../dataManager.js";

/* Kamera auf Mast, mit kleinem "Scan"-Balken statt Objektiv-Highlight –
   bewusst anders als CameraLayer (Gehäuse) und AllskyLayer (Kuppel). */
const ALPR_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <rect x="16" y="14" width="2.4" height="16" fill="#78350f"/>
  <rect x="9" y="8" width="17" height="10" rx="2" fill="#fbbf24" stroke="#78350f" stroke-width="1.2"/>
  <rect x="11" y="12" width="13" height="2.2" fill="#78350f"/>
</svg>`;

const ALPR_COLOR = "#fbbf24";

const DISCLAIMER = "Unvollständige Community-Kartierung (OSM/DeFlock) – "
    + "zeigt nur Standorte, keine Kennzeichen-, Fahrzeug- oder Personendaten.";

export class ALPRLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "alpr",
            name: "Kennzeichenleser (ALPR)",
            icon: "🪪",
            type: "alpr",
            dataUrl: null
        });
        this._iconUrl = svgDataUri(ALPR_SVG);

        this.outOfRange = false;
        this.fetchPending = false;
        this._timer = null;
        this._lastRequestAt = 0;
        this._queriedBoxes = [];   // bereits abgefragte bbox, um Wiederholungen zu vermeiden
    }

    get config() {
        return window.WORLD_VIEWER_CONFIG?.alpr ?? {};
    }

    /** Keine statischen Startdaten – alles kommt viewport-bezogen vom Server. */
    async load() {
        await this.refresh(true);
        this.startPolling();
    }

    startPolling() {
        this.stopPolling();
        const seconds = Math.max(this.config.refreshSeconds ?? 10, 5);
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    stopPolling() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    /**
     * Berechnet den sichtbaren Kartenausschnitt – identisch zum Muster in
     * AircraftLayer. Zu weit herausgezoomt liefert null (kein Abruf).
     */
    _visibleBounds() {
        const viewer = this.worldViewer;
        const camera = viewer.camera;

        const cam = viewer.getCameraPosition();
        if (!cam) return null;

        const maxHeightKm = this.config.maxHeightKm ?? 250;
        if (cam.height / 1000 > maxHeightKm) return null;

        const maxSpan = this.config.maxSpanDegrees ?? 2.5;
        const rect = camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
        if (!rect) return null;

        const bounds = {
            north: Cesium.Math.toDegrees(rect.north),
            south: Cesium.Math.toDegrees(rect.south),
            west: Cesium.Math.toDegrees(rect.west),
            east: Cesium.Math.toDegrees(rect.east)
        };
        const latSpan = bounds.north - bounds.south;
        const lonSpan = bounds.east - bounds.west;
        if (latSpan <= 0 || lonSpan <= 0 || latSpan > maxSpan || lonSpan > maxSpan) return null;

        return bounds;
    }

    /** true, wenn die bbox vollständig in einer bereits abgefragten bbox liegt. */
    _alreadyQueried(bounds) {
        return this._queriedBoxes.some(b =>
            bounds.south >= b.south && bounds.north <= b.north
            && bounds.west >= b.west && bounds.east <= b.east);
    }

    async refresh(force = false) {
        if (this.fetchPending || !this.enabled) return;

        const minGapMs = (this.config.minRequestGapSeconds ?? 4) * 1000;
        if (!force && Date.now() - this._lastRequestAt < minGapMs) return;

        const bounds = this._visibleBounds();
        if (!bounds) {
            this.outOfRange = true;
            return;
        }
        this.outOfRange = false;

        // Ausschnitt schon (in etwas größerem Zuschnitt) abgefragt → Server
        // nicht erneut belasten, die Standorte stehen schon auf der Karte
        if (!force && this._alreadyQueried(bounds)) return;

        this._lastRequestAt = Date.now();
        this.fetchPending = true;

        try {
            const params = new URLSearchParams({
                south: bounds.south.toFixed(4),
                west: bounds.west.toFixed(4),
                north: bounds.north.toFixed(4),
                east: bounds.east.toFixed(4)
            });
            const controller = new AbortController();
            // Der öffentliche Overpass-Server ist oft ausgelastet – etwas
            // großzügigeres Zeitlimit als bei den anderen Katalogen
            const timer = setTimeout(() => controller.abort(), 35_000);
            const res = await fetch(`/api/alpr?${params}`, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            this._queriedBoxes.push(bounds);
            // Mehr als ein paar Boxen merken ist unnötig – alte, längst
            // überdeckte Einträge bremsen nur die Prüfung in _alreadyQueried
            if (this._queriedBoxes.length > 30) this._queriedBoxes.shift();

            for (const cam of data.cameras ?? []) {
                this._upsert(cam);
            }

        } catch (err) {
            console.info("[ALPR] Standorte nicht abrufbar:", err.message);
        } finally {
            this.fetchPending = false;
        }
    }

    _upsert(cam) {
        if (this.entityById.has(cam.id)) return;   // statische Standorte: nie entfernen

        const obj = normalizeRecord({
            id: cam.id,
            name: "Kennzeichenleser",
            latitude: cam.latitude,
            longitude: cam.longitude,
            altitude: 6,
            surveillanceType: cam.surveillanceType,
            zone: cam.zone,
            manufacturer: cam.manufacturer,
            model: cam.model,
            direction: cam.direction,
            mount: cam.mount,
            operator: cam.operator,
            startDate: cam.startDate,
            osmType: cam.osmType,
            osmId: cam.osmId
        }, "alpr");

        const entity = this.createEntity(obj);
        if (entity) {
            entity.worldViewerObject = obj;
            this.entityById.set(obj.id, entity);
            this.objects.push(obj);
        }
    }

    createEntity(obj) {
        const m = obj.metadata;
        const heading = Number.isFinite(m.direction) ? Cesium.Math.toRadians(m.direction) : 0;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: this._iconUrl,
                width: 18,
                height: 18,
                rotation: -heading,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 4e5, 0.4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel("ALPR", Cesium.Color.fromCssColorString(ALPR_COLOR)),
                scaleByDistance: new Cesium.NearFarScalar(2e3, 1.0, 5e4, 0.0)
            }
        });
    }

    /** Dauerhafter Hinweis in der Sidebar – siehe Klassenkopf. */
    statusText() {
        if (this.outOfRange) {
            return `${DISCLAIMER} Zum Laden näher heranzoomen (Ausschnitt zu groß).`;
        }
        return DISCLAIMER;
    }
}
