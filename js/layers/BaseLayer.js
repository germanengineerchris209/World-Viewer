/**
 * BaseLayer.js – Basisklasse für alle Daten-Layer.
 *
 * Jeder Layer:
 *  - besitzt eine eigene Cesium-CustomDataSource (unabhängig ein-/ausblendbar)
 *  - lädt seine Daten selbst (JSON-Datei, später API/WebSocket)
 *  - kann pro Frame aktualisiert werden (update)
 *  - erzeugt Entities im einheitlichen Datenformat (siehe dataManager.js)
 *
 * Neue Layer: einfach von BaseLayer erben und createEntity()
 * sowie ggf. update() überschreiben – fertig.
 */

import { loadJSON, normalizeRecord } from "../dataManager.js";

const TRAIL_MAX_POINTS = 25;
const TRAIL_MIN_INTERVAL_MS = 4000;

export class BaseLayer {

    /**
     * @param {WorldViewer} worldViewer  Wrapper um den Cesium-Viewer
     * @param {object} options { id, name, icon, type, dataUrl }
     */
    constructor(worldViewer, options) {
        this.worldViewer = worldViewer;
        this.viewer = worldViewer.viewer;

        this.id = options.id;                 // z.B. "aircraft"
        this.name = options.name;             // Anzeigename, z.B. "Aircraft"
        this.icon = options.icon ?? "📍";     // Icon für die Sidebar
        this.type = options.type ?? options.id;
        this.dataUrl = options.dataUrl;       // z.B. "./data/aircraft.json"

        this.enabled = true;
        this.objects = [];                    // normalisierte Datensätze
        this.entityById = new Map();          // id → Cesium.Entity

        // Eigene DataSource → Layer komplett unabhängig steuerbar
        this.dataSource = new Cesium.CustomDataSource(this.id);
        this.viewer.dataSources.add(this.dataSource);

        // Bewegungsspuren (Track-Verlauf) – standardmäßig aus, siehe enableTrails()
        this._trailColor = null;
        this._trailEntities = new Map();  // Objekt-ID → Cesium.Entity (Polyline)
        this.trailsVisible = false;
    }

    /** Von Unterklassen mit beweglichen Objekten aufrufen (z.B. AircraftLayer). */
    enableTrails(color) {
        this._trailColor = color;
    }

    get supportsTrails() { return this._trailColor !== null; }

    /**
     * Merkt sich die aktuelle Position als neuen Spurpunkt (gedrosselt,
     * damit die Spur nicht bei jedem Frame wächst).
     */
    _recordTrailPoint(obj) {
        if (!this.trailsVisible) return;

        const now = Date.now();
        if (now - (obj.__lastTrailAt ?? 0) < TRAIL_MIN_INTERVAL_MS) return;
        obj.__lastTrailAt = now;

        obj.__trailPoints ??= [];
        obj.__trailPoints.push({
            longitude: obj.position.longitude,
            latitude: obj.position.latitude,
            altitude: obj.position.altitude
        });
        if (obj.__trailPoints.length > TRAIL_MAX_POINTS) obj.__trailPoints.shift();

        if (!this._trailEntities.has(obj.id)) this._createTrailEntity(obj);
    }

    /** Legt die Polyline-Entity für die Spur eines Objekts an. */
    _createTrailEntity(obj) {
        const entity = this.dataSource.entities.add({
            id: `${obj.id}-trail`,
            show: this.trailsVisible,
            polyline: {
                positions: new Cesium.CallbackProperty(() =>
                    (obj.__trailPoints ?? []).map(p =>
                        Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitude)
                    ), false),
                width: 2,
                material: this._trailColor.withAlpha(0.55),
                clampToGround: false
            }
        });
        this._trailEntities.set(obj.id, entity);
        return entity;
    }

    /** Entfernt die Spur eines Objekts (beim Entfernen des Objekts selbst). */
    _removeTrailEntity(id) {
        const entity = this._trailEntities.get(id);
        if (entity) this.dataSource.entities.remove(entity);
        this._trailEntities.delete(id);
    }

    /** Globaler Schalter, siehe LayerManager.setTrailsVisible(). */
    setTrailsVisible(visible) {
        this.trailsVisible = visible;
        for (const entity of this._trailEntities.values()) entity.show = visible;
    }

    /** Daten laden und Entities erzeugen. */
    async load() {
        if (!this.dataUrl) return;
        const raw = await loadJSON(this.dataUrl);
        this.objects = raw.map(r => normalizeRecord(r, this.type));
        for (const obj of this.objects) {
            const entity = this.createEntity(obj);
            if (entity) {
                // Referenz auf die Originaldaten für Detailpanel & Suche
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
            }
        }
        console.info(`[${this.name}] ${this.objects.length} Objekte geladen.`);
    }

    /**
     * Erzeugt eine Cesium-Entity für ein Objekt.
     * Muss von Unterklassen überschrieben werden.
     * @returns {Cesium.Entity|null}
     */
    createEntity(obj) {
        // Standard: einfacher Punkt
        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            point: { pixelSize: 8, color: Cesium.Color.WHITE },
            label: this._makeLabel(obj.name)
        });
    }

    /** Standard-Label unterhalb des Symbols. */
    _makeLabel(text, color = Cesium.Color.WHITE) {
        return {
            text,
            font: "11px 'SF Mono', Consolas, monospace",
            fillColor: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, 18),
            verticalOrigin: Cesium.VerticalOrigin.TOP,
            scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 8e6, 0.0),
            show: true
        };
    }

    /**
     * Update, wird pro Tick von app.js aufgerufen.
     * @param {number} simDeltaSeconds   vergangene SIMULATIONS-Sekunden
     *                                   (berücksichtigt den Zeitraffer)
     * @param {number} realDeltaSeconds  tatsächlich vergangene Sekunden –
     *                                   für Layer mit Live-Daten, die sich
     *                                   in Echtzeit bewegen sollen
     */
    update(simDeltaSeconds, realDeltaSeconds) {
        // Standard: statische Layer tun nichts
    }

    /* ─── Sichtbarkeit ─── */

    show() { this.enabled = true; this.dataSource.show = true; }
    hide() { this.enabled = false; this.dataSource.show = false; }
    toggle() { this.enabled ? this.hide() : this.show(); return this.enabled; }

    /** Beschriftungen ein-/ausblenden. */
    setLabelsVisible(visible) {
        for (const entity of this.dataSource.entities.values) {
            if (entity.label) entity.label.show = visible;
        }
    }

    /** Alle Objekte entfernen. */
    clear() {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this._trailEntities.clear();
        this.objects = [];
    }

    get count() { return this.objects.length; }
}
