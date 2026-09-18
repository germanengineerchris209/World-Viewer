/**
 * ShipLayer.js – Schiffe.
 *
 * ZWEI BETRIEBSARTEN, automatisch gewählt (wie bei AircraftLayer):
 *
 *  LIVE  Echte AIS-Positionen über den eigenen Server (/api/ships), der
 *        eine dauerhafte WebSocket-Verbindung zu AISStream.io hält
 *        (server/aisStream.mjs). Zwischen zwei Abrufen fahren die
 *        Schiffe per Koppelnavigation (Kurs + Geschwindigkeit) weiter,
 *        damit die Bewegung flüssig aussieht statt zu springen.
 *
 *  DEMO  Läuft kein Server oder ist kein AISSTREAM_API_KEY gesetzt:
 *        Beispieldaten aus data/ships.json mit der bisherigen Simulation.
 */

import { BaseLayer } from "./BaseLayer.js";
import { movePosition, svgDataUri, normalizeRecord } from "../dataManager.js";
import { ShipDataSource } from "../shipData.js";

// Schiffssymbol (Pfeilform, Spitze = Fahrtrichtung/Norden)
const SHIP_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <path d="M18 4 L26 26 L18 22 L10 26 Z"
        fill="#4ade80" stroke="#0b2b16" stroke-width="1.2"/>
</svg>`;

export class ShipLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "ships",
            name: "Ships",
            icon: "🚢",
            type: "ship",
            dataUrl: null            // Daten kommen über ShipDataSource
        });

        this._iconUrl = svgDataUri(SHIP_SVG);
        this.source = new ShipDataSource();
        this.enableTrails(Cesium.Color.fromCssColorString("#4ade80"));

        /** "live" | "demo" | "unknown" */
        this.mode = "unknown";
        this.lastFetchAt = 0;
        this.fetchPending = false;
        this.outOfRange = false;

        this._timer = null;
        this._lastRequestAt = 0;
        this._onStatusChange = null;
    }

    get config() {
        return window.WORLD_VIEWER_CONFIG?.ships ?? {};
    }

    onStatusChange(callback) { this._onStatusChange = callback; }

    _notify() { this._onStatusChange?.(this.getStatus()); }

    getStatus() {
        return {
            mode: this.mode,
            source: this.source.sourceName,
            count: this.objects.length,
            lastFetchAt: this.lastFetchAt,
            error: this.source.lastError,
            outOfRange: this.outOfRange,
            loading: this.fetchPending
        };
    }

    /* ═══════════ Laden ═══════════ */

    async load() {
        this.mode = await this.source.checkAvailability();

        if (this.mode === "live") {
            await this.refreshLive();
            this.startPolling();
        } else {
            await this._loadDemo();
        }
        this._notify();
    }

    async _loadDemo() {
        const records = await this.source.fetchDemo();
        for (const record of records) {
            this._upsert(record);
        }
        console.info(`[Ships] ${this.objects.length} Demo-Schiffe geladen.`);
    }

    /* ═══════════ Live-Abruf ═══════════ */

    startPolling() {
        this.stopPolling();
        const interval = Math.max(this.config.refreshSeconds ?? 15, 5) * 1000;
        this._timer = setInterval(() => this.refreshLive(), interval);
        console.info(`[Ships] Live-Abruf alle ${Math.round(interval / 1000)} s.`);
    }

    stopPolling() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    /**
     * Sichtbarer Kartenausschnitt – wie bei AircraftLayer, aber mit
     * eigenen (großzügigeren) Grenzen aus der ships-Konfiguration.
     * @returns {object|null} null, wenn zu weit herausgezoomt
     */
    _visibleBounds() {
        const viewer = this.worldViewer;
        const camera = viewer.camera;
        const cfg = this.config;

        const cam = viewer.getCameraPosition();
        if (!cam) return null;

        const maxHeightKm = cfg.maxHeightKm ?? 30000;
        if (cam.height / 1000 > maxHeightKm) return null;

        const maxSpan = cfg.maxSpanDegrees ?? 60;
        const rect = camera.computeViewRectangle(viewer.scene.globe.ellipsoid);

        let bounds = null;

        if (rect) {
            const candidate = {
                north: Cesium.Math.toDegrees(rect.north),
                south: Cesium.Math.toDegrees(rect.south),
                west: Cesium.Math.toDegrees(rect.west),
                east: Cesium.Math.toDegrees(rect.east)
            };
            const latSpan = candidate.north - candidate.south;
            const lonSpan = candidate.east - candidate.west;
            if (latSpan > 0 && lonSpan > 0 && latSpan <= maxSpan && lonSpan <= maxSpan) {
                bounds = candidate;
            }
        }

        if (!bounds) {
            const half = maxSpan / 2;
            bounds = {
                north: cam.latitude + half,
                south: cam.latitude - half,
                west: cam.longitude - half,
                east: cam.longitude + half
            };
        }

        if (bounds.north > 90) { bounds.south -= bounds.north - 90; bounds.north = 90; }
        if (bounds.south < -90) { bounds.north += -90 - bounds.south; bounds.south = -90; }
        if (bounds.east > 180) { bounds.west -= bounds.east - 180; bounds.east = 180; }
        if (bounds.west < -180) { bounds.east += -180 - bounds.west; bounds.west = -180; }

        return {
            north: Math.min(bounds.north, 90),
            south: Math.max(bounds.south, -90),
            west: Math.max(bounds.west, -180),
            east: Math.min(bounds.east, 180)
        };
    }

    async refreshLive(force = false) {
        if (this.mode !== "live" || this.fetchPending || !this.enabled) return;

        const minGapMs = (this.config.minRequestGapSeconds ?? 3) * 1000;
        if (!force && Date.now() - this._lastRequestAt < minGapMs) return;
        this._lastRequestAt = Date.now();

        const bounds = this._visibleBounds();
        if (!bounds) {
            if (!this.outOfRange) { this.outOfRange = true; this._notify(); }
            return;
        }
        if (this.outOfRange) this.outOfRange = false;

        this.fetchPending = true;
        this._notify();

        try {
            const result = await this.source.fetchLive(bounds);
            if (!result) {
                if (this.objects.length === 0) {
                    console.warn("[Ships] Live-Daten nicht verfügbar:", this.source.lastError);
                    this.mode = "demo";
                    this.stopPolling();
                    await this._loadDemo();
                }
                return;
            }

            this.lastFetchAt = result.fetchedAt;
            this._reconcile(result.ships);

        } finally {
            this.fetchPending = false;
            this._notify();
        }
    }

    /** Gleicht die neue Schiffsliste mit der Anzeige ab. */
    _reconcile(list) {
        const now = Date.now();
        const seen = new Set();

        for (const record of list) {
            seen.add(record.id);
            this._upsert(record);
        }

        // Schiffe, die eine Weile nicht mehr gemeldet wurden, entfernen
        // (AIS kennt kein explizites "Schiff verschwunden").
        const graceMs = (this.config.removeAfterSeconds ?? 1200) * 1000;

        for (const obj of [...this.objects]) {
            if (seen.has(obj.id)) {
                obj.__lastSeen = now;
            } else if (now - (obj.__lastSeen ?? 0) > graceMs) {
                this._remove(obj.id);
            }
        }
    }

    /** Legt ein Schiff an oder aktualisiert es. */
    _upsert(record) {
        const existing = this.entityById.get(record.id);

        if (existing) {
            const obj = existing.worldViewerObject;
            obj.position.latitude = record.latitude;
            obj.position.longitude = record.longitude;
            obj.speed = record.speed;
            obj.heading = record.heading;
            obj.timestamp = record.timestamp;
            obj.__lastSeen = Date.now();
            Object.assign(obj.metadata, this._buildMetadata(record));
            return;
        }

        const obj = normalizeRecord({
            id: record.id,
            name: record.name,
            latitude: record.latitude,
            longitude: record.longitude,
            altitude: 0,
            speed: record.speed,
            heading: record.heading,
            timestamp: record.timestamp,
            ...this._buildMetadata(record)
        }, "ship");

        obj.__lastSeen = Date.now();

        const entity = this.createEntity(obj);
        if (entity) {
            entity.worldViewerObject = obj;
            this.entityById.set(obj.id, entity);
            this.objects.push(obj);
        }
    }

    /** Baut die Zusatzfelder für Detailpanel, Suche und Bildsuche. */
    _buildMetadata(record) {
        return {
            mmsi: record.mmsi ?? "",
            shipType: record.shipType ?? "",
            flag: record.flag ?? "",
            destination: record.destination ?? "",
            callSign: record.callSign ?? "",
            navigationalStatus: record.navigationalStatus ?? null,
            wikipedia: record.wikipedia ?? "",
            live: this.mode === "live"
        };
    }

    /** Entfernt ein Schiff vollständig. */
    _remove(id) {
        const entity = this.entityById.get(id);
        if (entity) this.dataSource.entities.remove(entity);
        this.entityById.delete(id);
        this._removeTrailEntity(id);
        const i = this.objects.findIndex(o => o.id === id);
        if (i >= 0) this.objects.splice(i, 1);
    }

    /* ═══════════ Darstellung ═══════════ */

    createEntity(obj) {
        return this.dataSource.entities.add({
            id: obj.id,
            position: new Cesium.CallbackProperty(() =>
                Cesium.Cartesian3.fromDegrees(
                    obj.position.longitude,
                    obj.position.latitude,
                    0
                ), false),
            billboard: {
                image: this._iconUrl,
                width: 24,
                height: 24,
                rotation: new Cesium.CallbackProperty(
                    () => Cesium.Math.toRadians(-(obj.heading ?? 0)), false),
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 1.2e7, 0.4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: this._makeLabel(obj.name, Cesium.Color.fromCssColorString("#4ade80"))
        });
    }

    /**
     * @param {number} simDeltaSeconds   Simulationszeit (Zeitraffer)
     * @param {number} realDeltaSeconds  echte vergangene Sekunden
     *
     * Im Live-Betrieb zählt die ECHTE Zeit, damit sich Schiffe unabhängig
     * vom Zeitraffer-Regler in Wirklichkeitsgeschwindigkeit bewegen.
     */
    update(simDeltaSeconds, realDeltaSeconds = simDeltaSeconds) {
        if (!this.enabled) return;

        const delta = this.mode === "live" ? realDeltaSeconds : simDeltaSeconds;
        if (delta <= 0) return;

        for (const obj of this.objects) {
            const speedKnots = obj.speed || 0;   // Schiffe: Speed in Knoten
            if (speedKnots <= 0) continue;

            const speedKmh = speedKnots * 1.852;
            const distanceKm = (speedKmh / 3600) * delta;
            const next = movePosition(
                obj.position.latitude,
                obj.position.longitude,
                obj.heading,
                distanceKm
            );
            obj.position.latitude = next.latitude;
            obj.position.longitude = next.longitude;

            this._recordTrailPoint(obj);
        }
    }

    /* ═══════════ Aufräumen ═══════════ */

    show() {
        super.show();
        if (this.mode === "live" && !this._timer) {
            this.startPolling();
            this.refreshLive();
        }
    }

    hide() {
        super.hide();
        this.stopPolling();
    }

    clear() {
        this.stopPolling();
        super.clear();
    }
}
