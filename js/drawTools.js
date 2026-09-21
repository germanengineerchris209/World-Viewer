/**
 * drawTools.js – Zeichnen & Messen (Freihand, Grenzen, Distanzmessung).
 *
 * Reines Analysewerkzeug wie in Gotham, ergänzt Link-Analyse/Geofencing:
 * Der Nutzer zeichnet Punkte/Linien/Polygone auf den Globus und misst
 * Distanzen – ausschließlich mit CesiumJS-Bordmitteln (Entity,
 * CallbackProperty, EllipsoidGeodesic). Keine neue Datenquelle, kein
 * Server; Geometrien werden analog zu watchlist.js in localStorage
 * gespeichert und lassen sich als GeoJSON exportieren.
 */

import { toRad } from "./dataManager.js";

const STORAGE_KEY = "world-viewer-draw-features";
const EARTH_RADIUS_KM = 6371;

export const TYPE_LABELS = {
    point: "Punkt",
    line: "Freihand-Linie",
    polygon: "Grenze",
    measure: "Messung"
};

const TYPE_COLORS = {
    point: "#38bdf8",
    line: "#38bdf8",
    polygon: "#a78bfa",
    measure: "#fb923c"
};

let featureCounter = 0;

export function formatDistanceKm(km) {
    if (!isFinite(km)) return "–";
    return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(2)} km`;
}

export function formatAreaKm2(km2) {
    if (!isFinite(km2)) return "–";
    return km2 < 1 ? `${Math.round(km2 * 1_000_000)} m²` : `${km2.toFixed(2)} km²`;
}

export class DrawTools {

    /** @param {WorldViewer} worldViewer */
    constructor(worldViewer) {
        this.worldViewer = worldViewer;
        this.viewer = worldViewer.viewer;

        this.features = [];           // { id, type, name, color, positions:[{lat,lon}], distanceKm?, areaKm2? }
        this.activeMode = null;       // "point" | "line" | "polygon" | "measure"

        this._draftPositions = [];    // Cartesian3[] der laufenden Zeichnung
        this._draftEntity = null;
        this._hoverPosition = null;   // Cartesian3 | null – Rubber-Band zur Maus
        this._dragging = false;       // Freihand: Maustaste gedrückt

        this.onFeaturesChanged = null; // () => void, von der UI gesetzt
        this.onModeChanged = null;     // (mode|null) => void, von der UI gesetzt

        this.dataSource = new Cesium.CustomDataSource("draw-tools");
        this.viewer.dataSources.add(this.dataSource);

        this._handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
        this._bindHandler();

        this._loadFeatures();
    }

    /* ─────────── Werkzeuge aktivieren/beenden ─────────── */

    startTool(mode) {
        this._resetDraft();
        this.activeMode = mode;
        this.worldViewer.inputSuppressed = true;
        this.onModeChanged?.(mode);
    }

    cancelTool() {
        this._resetDraft();
        this.activeMode = null;
        this.worldViewer.inputSuppressed = false;
        this.onModeChanged?.(null);
    }

    /** Schließt Polygon/Messung mit den bisher gesetzten Punkten ab. */
    finishDraft() {
        if (this.activeMode !== "polygon" && this.activeMode !== "measure") return;
        if (this._draftPositions.length >= 2) {
            this._commitFeature(this.activeMode, this._draftPositions);
        }
        this._clearDraftEntity();
        this._draftPositions = [];
        this._hoverPosition = null;
    }

    _resetDraft() {
        this._dragging = false;
        this._draftPositions = [];
        this._hoverPosition = null;
        this._clearDraftEntity();
        this.viewer.scene.screenSpaceCameraController.enableRotate = true;
        this.viewer.scene.screenSpaceCameraController.enableTranslate = true;
    }

    _clearDraftEntity() {
        if (this._draftEntity) {
            this.dataSource.entities.remove(this._draftEntity);
            this._draftEntity = null;
        }
    }

    /* ─────────── Eingabe-Handling ─────────── */

    _bindHandler() {
        const h = this._handler;
        h.setInputAction((m) => this._onLeftDown(m), Cesium.ScreenSpaceEventType.LEFT_DOWN);
        h.setInputAction((m) => this._onMouseMove(m), Cesium.ScreenSpaceEventType.MOUSE_MOVE);
        h.setInputAction((m) => this._onLeftUp(m), Cesium.ScreenSpaceEventType.LEFT_UP);
        h.setInputAction((m) => this._onLeftClick(m), Cesium.ScreenSpaceEventType.LEFT_CLICK);
        h.setInputAction((m) => this._onRightClick(m), Cesium.ScreenSpaceEventType.RIGHT_CLICK);
    }

    _pick(position) {
        if (!position) return null;
        return this.viewer.camera.pickEllipsoid(position, this.viewer.scene.globe.ellipsoid) ?? null;
    }

    _onLeftDown(movement) {
        if (this.activeMode !== "line") return;
        const cartesian = this._pick(movement.position);
        if (!cartesian) return;
        this._dragging = true;
        this._draftPositions = [cartesian];
        this.viewer.scene.screenSpaceCameraController.enableRotate = false;
        this.viewer.scene.screenSpaceCameraController.enableTranslate = false;
        this._ensureDraftEntity("line");
    }

    _onMouseMove(movement) {
        if (!this.activeMode) return;

        if (this.activeMode === "line") {
            if (!this._dragging) return;
            const cartesian = this._pick(movement.endPosition);
            if (!cartesian) return;
            const last = this._draftPositions[this._draftPositions.length - 1];
            if (!last || Cesium.Cartesian3.distance(last, cartesian) > this._minSampleDistance()) {
                this._draftPositions.push(cartesian);
            }
            return;
        }

        if (this._draftPositions.length > 0) {
            this._hoverPosition = this._pick(movement.endPosition);
        }
    }

    _onLeftUp() {
        if (this.activeMode !== "line" || !this._dragging) return;
        this._dragging = false;
        this.viewer.scene.screenSpaceCameraController.enableRotate = true;
        this.viewer.scene.screenSpaceCameraController.enableTranslate = true;

        if (this._draftPositions.length >= 2) {
            this._commitFeature("line", this._draftPositions);
        }
        this._draftPositions = [];
        this._clearDraftEntity();
        // Freihand-Werkzeug bleibt aktiv, damit mehrere Striche gezeichnet werden können.
    }

    _onLeftClick(movement) {
        if (this.activeMode !== "polygon" && this.activeMode !== "measure" && this.activeMode !== "point") return;
        const cartesian = this._pick(movement.position);
        if (!cartesian) return;

        if (this.activeMode === "point") {
            this._commitFeature("point", [cartesian]);
            return; // Punktwerkzeug bleibt aktiv für weitere Punkte
        }

        this._draftPositions.push(cartesian);
        this._ensureDraftEntity(this.activeMode);
    }

    _onRightClick() {
        if (this.activeMode === "polygon" || this.activeMode === "measure") {
            this.finishDraft();
        } else if (this.activeMode) {
            this.cancelTool();
        }
    }

    _minSampleDistance() {
        // Kamera-Höhe abhängig, damit Striche bei jedem Zoom sinnvoll aufgelöst sind.
        const height = this.viewer.camera.positionCartographic?.height ?? 1_000_000;
        return Math.max(50, height * 0.0005);
    }

    /* ─────────── Vorschau während des Zeichnens ─────────── */

    _draftCartesians() {
        if (this.activeMode === "line") return this._draftPositions;
        const pts = [...this._draftPositions];
        if (this._hoverPosition) pts.push(this._hoverPosition);
        return pts;
    }

    _ensureDraftEntity(kind) {
        if (this._draftEntity) return;
        const color = Cesium.Color.fromCssColorString(TYPE_COLORS[kind] ?? TYPE_COLORS.line);
        const positionsCallback = new Cesium.CallbackProperty(() => this._draftCartesians(), false);

        const options = {
            polyline: {
                positions: positionsCallback,
                width: kind === "measure" ? 2 : 3,
                material: kind === "measure"
                    ? new Cesium.PolylineDashMaterialProperty({ color })
                    : color,
                clampToGround: true
            }
        };

        if (kind === "polygon") {
            options.polygon = {
                hierarchy: new Cesium.CallbackProperty(
                    () => new Cesium.PolygonHierarchy(this._draftCartesians()), false
                ),
                material: color.withAlpha(0.15),
                outline: true, outlineColor: color, outlineWidth: 2, height: 0
            };
        }

        if (kind === "measure") {
            options.position = new Cesium.CallbackProperty(() => {
                const pts = this._draftCartesians();
                return pts[pts.length - 1] ?? this._draftPositions[0] ?? Cesium.Cartesian3.ZERO;
            }, false);
            options.label = this._labelGraphics(
                new Cesium.CallbackProperty(() => formatDistanceKm(this._draftDistanceKm()), false),
                color
            );
        }

        this._draftEntity = this.dataSource.entities.add(options);
    }

    _draftDistanceKm() {
        return this._pathDistanceKm(this._draftCartesians().map((c) => this._toLatLon(c)));
    }

    /* ─────────── Geometrie fertigstellen ─────────── */

    _commitFeature(type, cartesians) {
        const positions = cartesians.map((c) => this._toLatLon(c));
        const feature = {
            id: `draw-${Date.now()}-${featureCounter++}`,
            type,
            name: this._defaultName(type),
            color: TYPE_COLORS[type],
            positions,
            createdAt: Date.now()
        };

        if (type === "line" || type === "measure") {
            feature.distanceKm = this._pathDistanceKm(positions);
        }
        if (type === "polygon") {
            feature.areaKm2 = this._polygonAreaKm2(positions);
            feature.distanceKm = this._pathDistanceKm([...positions, positions[0]]);
        }

        this.features.push(feature);
        this._renderFeature(feature);
        this._saveFeatures();
        this.onFeaturesChanged?.();
        return feature;
    }

    _defaultName(type) {
        const count = this.features.filter((f) => f.type === type).length + 1;
        return `${TYPE_LABELS[type]} ${count}`;
    }

    /* ─────────── Rendering fertiger Geometrien ─────────── */

    _renderFeature(feature) {
        const color = Cesium.Color.fromCssColorString(feature.color);
        const cartesians = feature.positions.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
        const options = { id: feature.id };

        if (feature.type === "point") {
            options.position = cartesians[0];
            options.point = {
                pixelSize: 10, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            };
            options.label = this._labelGraphics(feature.name, color);
        } else if (feature.type === "polygon") {
            options.polygon = {
                hierarchy: new Cesium.PolygonHierarchy(cartesians),
                material: color.withAlpha(0.2),
                outline: true, outlineColor: color, outlineWidth: 2, height: 0
            };
            options.position = Cesium.BoundingSphere.fromPoints(cartesians).center;
            options.label = this._labelGraphics(
                `${feature.name} · ${formatAreaKm2(feature.areaKm2)}`, color
            );
        } else {
            options.polyline = {
                positions: cartesians,
                width: feature.type === "measure" ? 2 : 3,
                material: feature.type === "measure"
                    ? new Cesium.PolylineDashMaterialProperty({ color })
                    : color,
                clampToGround: true
            };
            options.position = cartesians[cartesians.length - 1];
            options.label = this._labelGraphics(
                feature.type === "measure"
                    ? `📏 ${feature.name} · ${formatDistanceKm(feature.distanceKm)}`
                    : feature.name,
                color
            );
        }

        this.dataSource.entities.add(options);
    }

    _labelGraphics(text, color) {
        return {
            text,
            font: "12px 'SF Mono', Consolas, monospace",
            fillColor: color,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -14),
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            disableDepthTestDistance: Number.POSITIVE_INFINITY
        };
    }

    /* ─────────── Geometrie-Berechnungen ─────────── */

    _toLatLon(cartesian) {
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        return {
            lat: Cesium.Math.toDegrees(carto.latitude),
            lon: Cesium.Math.toDegrees(carto.longitude)
        };
    }

    /** Summe der geodätischen Distanzen entlang eines Pfads (EllipsoidGeodesic). */
    _pathDistanceKm(positions) {
        let total = 0;
        for (let i = 1; i < positions.length; i++) {
            total += this._geodesicDistanceKm(positions[i - 1], positions[i]);
        }
        return total;
    }

    _geodesicDistanceKm(a, b) {
        const geodesic = new Cesium.EllipsoidGeodesic(
            Cesium.Cartographic.fromDegrees(a.lon, a.lat),
            Cesium.Cartographic.fromDegrees(b.lon, b.lat)
        );
        return geodesic.surfaceDistance / 1000;
    }

    /** Näherungsformel für sphärische Polygonflächen (Chamberlain/Duquette). */
    _polygonAreaKm2(positions) {
        if (positions.length < 3) return 0;
        const n = positions.length;
        let total = 0;
        for (let i = 0; i < n; i++) {
            const p1 = positions[(i - 1 + n) % n];
            const p2 = positions[i];
            const p3 = positions[(i + 1) % n];
            total += (toRad(p3.lon) - toRad(p1.lon)) * Math.sin(toRad(p2.lat));
        }
        return Math.abs(total * EARTH_RADIUS_KM * EARTH_RADIUS_KM / 2);
    }

    /* ─────────── Verwalten fertiger Geometrien ─────────── */

    removeFeature(id) {
        const index = this.features.findIndex((f) => f.id === id);
        if (index < 0) return;
        this.features.splice(index, 1);
        const entity = this.dataSource.entities.getById(id);
        if (entity) this.dataSource.entities.remove(entity);
        this._saveFeatures();
        this.onFeaturesChanged?.();
    }

    clearAll() {
        this.features = [];
        this.dataSource.entities.removeAll();
        this._saveFeatures();
        this.onFeaturesChanged?.();
    }

    /** Fliegt zur Bounding-Sphere der Geometrie (wie flyToEntity in viewer.js: aus den
     *  gespeicherten Koordinaten berechnet statt über Cesiums Entity-Visualisierung,
     *  damit es unabhängig vom Render-/Visualizer-Status funktioniert). */
    flyToFeature(id) {
        const feature = this.features.find((f) => f.id === id);
        if (!feature) return;
        const cartesians = feature.positions.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat));
        const sphere = Cesium.BoundingSphere.fromPoints(cartesians);
        const carto = Cesium.Cartographic.fromCartesian(sphere.center);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);
        const height = Math.max(sphere.radius * 2.5, 2_000);
        this.worldViewer.flyTo(lon, lat, height);
    }

    /* ─────────── Export ─────────── */

    toGeoJSON() {
        return {
            type: "FeatureCollection",
            features: this.features.map((f) => ({
                type: "Feature",
                properties: {
                    name: f.name, type: f.type,
                    distanceKm: f.distanceKm ?? null,
                    areaKm2: f.areaKm2 ?? null
                },
                geometry: this._geometryFor(f)
            }))
        };
    }

    _geometryFor(f) {
        const coords = f.positions.map((p) => [p.lon, p.lat]);
        if (f.type === "point") return { type: "Point", coordinates: coords[0] };
        if (f.type === "polygon") return { type: "Polygon", coordinates: [[...coords, coords[0]]] };
        return { type: "LineString", coordinates: coords };
    }

    /* ─────────── Persistenz (localStorage) ─────────── */

    _saveFeatures() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.features));
        } catch {
            // z.B. privater Modus ohne Storage-Zugriff – Zeichnungen bleiben nur
            // für die laufende Sitzung erhalten.
        }
    }

    _loadFeatures() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const features = JSON.parse(raw);
            if (!Array.isArray(features)) return;
            for (const feature of features) {
                if (!feature?.id || !Array.isArray(feature.positions) || feature.positions.length === 0) continue;
                this.features.push(feature);
                this._renderFeature(feature);
            }
        } catch {
            // korrupte/alte Daten ignorieren, App bleibt funktionsfähig
        }
    }
}
