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

import { loadJSON, normalizeRecord, svgDataUri } from "../dataManager.js";

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

        // Sichtbarer Lade-/Fehlerstatus für den Layer-Schalter (WEB-159):
        // 'laden' | 'ok' | 'fehler' | 'leer' | 'schluessel_fehlt'. Fehlende
        // API-Schlüssel werden nicht hier, sondern von UI._renderKeyBadges
        // anhand von /api/keys gesetzt (siehe ui.js), da dieser Status aus
        // einer separaten Server-Abfrage kommt, nicht aus dem Laden selbst.
        this.status = this.dataUrl ? "laden" : "leer";
        this.statusDetail = null;             // optionaler Zusatztext fürs title-Attribut

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

    /**
     * Bündelt nah beieinanderliegende Entities zu einem Cluster-Symbol mit
     * Anzahl-Label, sobald die DataSource viele tausend Objekte enthält –
     * einzelne Billboards je Objekt (z.B. Rechenzentren/Dämme/Seekabel in
     * GEV-Größenordnung) würden sonst die Framerate einbrechen lassen.
     * Von Unterklassen im Konstruktor aufrufen, siehe InfrastructureLayer/CableLayer.
     */
    enableClustering({ pixelRange = 60, minimumClusterSize = 10, color = "#e5e9f0" } = {}) {
        const clustering = this.dataSource.clustering;
        clustering.enabled = true;
        clustering.pixelRange = pixelRange;
        clustering.minimumClusterSize = minimumClusterSize;

        const icon = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <circle cx="18" cy="18" r="16" fill="${color}" fill-opacity="0.85" stroke="#111" stroke-width="1.5"/>
</svg>`);

        clustering.clusterEvent.addEventListener((entities, cluster) => {
            cluster.billboard.show = true;
            cluster.billboard.image = icon;
            cluster.billboard.width = 36;
            cluster.billboard.height = 36;
            cluster.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;

            cluster.label.show = true;
            cluster.label.text = entities.length.toLocaleString("de-DE");
            cluster.label.font = "bold 13px 'SF Mono', Consolas, monospace";
            cluster.label.fillColor = Cesium.Color.BLACK;
            cluster.label.style = Cesium.LabelStyle.FILL;
            cluster.label.verticalOrigin = Cesium.VerticalOrigin.CENTER;
            cluster.label.pixelOffset = new Cesium.Cartesian2(0, 0);
        });
    }

    /** Daten laden und Entities erzeugen. */
    async load() {
        if (!this.dataUrl) { this.status = "leer"; return; }
        this.status = "laden";
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
        this.status = this._statusFromRaw(raw);
        console.info(`[${this.name}] ${this.objects.length} Objekte geladen.`);
    }

    /**
     * Leitet den Status aus einem (ggf. von loadJSON/loadJSONOptional mit
     * `__loadFailed` markierten) Rohdaten-Array ab. Auch von Unterklassen
     * mit eigenem load()-Override nutzbar (z.B. InfrastructureLayer, das
     * mehrere Quellen kombiniert), damit der Status überall gleich berechnet
     * wird.
     * @returns {"fehler"|"leer"|"ok"}
     */
    _statusFromRaw(raw) {
        if (raw?.__loadFailed) return "fehler";
        return this.objects.length === 0 ? "leer" : "ok";
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

    /**
     * Optionaler Hinweistext unter dem Layer-Schalter in der Sidebar
     * (z.B. "derzeit keine aktiven Systeme" bei saisonal leeren Layern).
     * @returns {string|null}
     */
    statusText() { return null; }
}
