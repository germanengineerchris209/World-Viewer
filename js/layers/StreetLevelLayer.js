/**
 * StreetLevelLayer.js – Street-Level-Abdeckung über die Mapillary Graph API
 * (WEB-95, Epic WEB-81/F7).
 *
 * Portiert die Idee aus "God's Eye View" von Bilawal Sidhu (MIT-Lizenz,
 * https://github.com/bilawalsidhu/gods-eye-view): Abdeckung als Linien
 * (je eine Polylinie pro Mapillary-"sequence"), Einzelbilder als Kegel in
 * Blickrichtung (compass_angle) – geometrisch dieselbe Sektor-Konstruktion
 * wie der Kamera-Sichtkegel (Kreisbogen über movePosition()), hier für
 * potenziell hunderte Bilder statt einer einzelnen Kamera.
 *
 * Datenfluss: KEIN dataUrl – die Abdeckung wird lazy für den sichtbaren
 * Kartenausschnitt geladen (/api/mapillary/images), analog zu
 * AircraftLayer.refreshLive(). Das schont Mapillarys Fair-Use-Kontingent
 * (siehe docs/WEB-83-…) und bleibt bei zu großem/fernem Ausschnitt einfach
 * leer statt tausende Bilder auf einmal zu laden.
 *
 * Ohne MAPILLARY_TOKEN liefert der Server 503/no_key – der Layer bleibt
 * dann leer und erklärt sich über statusText() (gleiches Muster wie
 * FireLayer ohne FIRMS_MAP_KEY), zusätzlich über das 🔑-Badge aus
 * server/keyRegistry.mjs im POWER-UP-Panel.
 *
 * Bilder laufen durch normalizeRecord() wie bei jedem anderen Layer, obwohl
 * sie nie aus einer JSON-Datei kommen: Suche, Beobachtungszonen und die
 * Link-Analyse iterieren layerManager.getAllObjects() blind über alle Layer
 * und erwarten überall .name/.position/.metadata – ohne Normalisierung
 * würden hunderte Street-Level-Treffer dort mit einem TypeError abbrechen.
 */

import { BaseLayer } from "./BaseLayer.js";
import { movePosition, svgDataUri, normalizeRecord } from "../dataManager.js";

const FOV_FLAT_DEGREES = 50;     // Öffnungswinkel für normale (nicht-360°) Bilder
const RANGE_METERS = 30;         // Reichweite des Kegels – reine Visualisierung
const MAX_HEIGHT_METERS = 6000;  // oberhalb dieser Kamerahöhe wird nicht geladen
const MAX_SPAN_DEGREES = 0.08;   // ~8 km Kantenlänge, siehe Server-Obergrenze
const MIN_REQUEST_GAP_MS = 1500;
const CONE_VISIBLE_METERS = 20_000; // Kegel erst aus der Nähe einblenden

const IMAGE_ICON = svgDataUri(`
<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
  <circle cx="10" cy="10" r="7" fill="#38bdf8" stroke="#082f49" stroke-width="1.5"/>
</svg>`);

export class StreetLevelLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "streetlevel",
            name: "Street-Level",
            icon: "📸",
            type: "streetlevel",
            dataUrl: null
        });

        this.available = null;     // null = noch nicht geprüft
        this.needsKey = false;
        this.lastError = "";
        this.outOfRange = false;

        this._lineEntities = new Map();   // sequence-ID → Cesium.Entity (Abdeckungslinie)

        this.filters = { imageType: "all", startMs: null, endMs: null };

        this._lastRequestAt = 0;
        this._fetchPending = false;

        /** Vom Panel gesetzt: Klick auf einen Bildkegel öffnet den Betrachter. */
        this.onImageSelected = null;
    }

    /** Kein statisches dataUrl – nur einmal die Server-Verfügbarkeit prüfen. */
    async load() {
        await this._checkAvailability();
    }

    async _checkAvailability() {
        try {
            const res = await fetch("/api/mapillary/status");
            const data = await res.json();
            this.available = !!data.available;
            this.needsKey = !this.available;
            this.lastError = this.available
                ? ""
                : "Kein MAPILLARY_TOKEN gesetzt – siehe POWER-UP-Panel (⚡).";
        } catch {
            // Kein Server (nur "python3 -m http.server") – degradiert sauber,
            // genau wie KeyStatusPanel ohne /api/keys.
            this.available = false;
            this.needsKey = false;
            this.lastError = "Kein Server erreichbar – Street-Level braucht node server/server.mjs.";
        }
    }

    /** Erklärt in der Layer-Konsole, warum die Ebene leer bleibt. */
    statusText() {
        if (this.available === false) return this.lastError;
        if (this.outOfRange) return "Näher heranzoomen, um Abdeckung zu laden.";
        return null;
    }

    /**
     * Lädt die Abdeckung für den aktuellen Kartenausschnitt neu.
     * Wird von app.js bei camera.moveEnd aufgerufen, drosselt sich selbst.
     */
    async refreshForView(force = false) {
        if (!this.enabled || !this.available || this._fetchPending) return;

        if (!force && Date.now() - this._lastRequestAt < MIN_REQUEST_GAP_MS) return;
        this._lastRequestAt = Date.now();

        const bbox = this._visibleBbox();
        if (!bbox) {
            this.outOfRange = true;
            return;
        }
        this.outOfRange = false;

        this._fetchPending = true;
        try {
            const params = new URLSearchParams({
                bbox: `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`
            });
            const res = await fetch(`/api/mapillary/images?${params}`);
            const data = await res.json();

            if (res.status === 503 && data.error === "no_key") {
                this.available = false;
                this.needsKey = true;
                this.lastError = data.message;
                return;
            }
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            this._rebuild(data.images ?? []);

        } catch (err) {
            console.info("[Street-Level] Abdeckung nicht abrufbar:", err.message);
        } finally {
            this._fetchPending = false;
        }
    }

    /** Sichtausschnitt als bbox in Grad, oder null wenn zu groß/zu hoch. */
    _visibleBbox() {
        const viewer = this.worldViewer;
        const cam = viewer.getCameraPosition();
        if (!cam || cam.height > MAX_HEIGHT_METERS) return null;

        const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
        if (!rect) return null;

        const bounds = {
            north: Cesium.Math.toDegrees(rect.north),
            south: Cesium.Math.toDegrees(rect.south),
            west: Cesium.Math.toDegrees(rect.west),
            east: Cesium.Math.toDegrees(rect.east)
        };
        const latSpan = bounds.north - bounds.south;
        const lonSpan = bounds.east - bounds.west;
        if (latSpan <= 0 || lonSpan <= 0 || latSpan > MAX_SPAN_DEGREES || lonSpan > MAX_SPAN_DEGREES) {
            return null;
        }
        return bounds;
    }

    /** Baut Abdeckungslinien + Bildkegel aus einer frischen Bildliste. */
    _rebuild(rawImages) {
        this.clear();

        const bySequence = new Map();
        for (const raw of rawImages) {
            const obj = normalizeRecord({
                id: raw.id,
                name: `Mapillary-Bild ${raw.id}`,
                latitude: raw.latitude,
                longitude: raw.longitude,
                altitude: 0,
                heading: raw.heading,
                timestamp: raw.capturedAt ?? Date.now(),
                isPano: raw.isPano,
                sequence: raw.sequence,
                thumbUrl: raw.thumbUrl
            }, "streetlevel");

            this.objects.push(obj);

            const seqId = obj.metadata.sequence;
            if (!bySequence.has(seqId)) bySequence.set(seqId, []);
            bySequence.get(seqId).push(obj);

            this._addCone(obj);
        }

        for (const [sequenceId, objs] of bySequence) {
            if (objs.length < 2) continue; // eine Linie braucht mind. 2 Punkte
            objs.sort((a, b) => a.timestamp - b.timestamp);
            this._addCoverageLine(sequenceId, objs);
        }

        this._applyFilters();
    }

    _addCoverageLine(sequenceId, objs) {
        const positions = objs.flatMap(o => [o.position.longitude, o.position.latitude]);
        const entity = this.dataSource.entities.add({
            id: `streetlevel-line-${sequenceId}`,
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(positions),
                width: 2,
                material: Cesium.Color.fromCssColorString("#38bdf8").withAlpha(0.65),
                clampToGround: true
            }
        });
        this._lineEntities.set(sequenceId, entity);
    }

    /** Bildkegel: 360°-Bilder als Vollkreis, sonst Sektor in Blickrichtung. */
    _addCone(obj) {
        const { longitude, latitude } = obj.position;
        const isPano = obj.metadata.isPano;
        const fovDegrees = isPano ? 359 : FOV_FLAT_DEGREES;
        const rangeKm = RANGE_METERS / 1000;
        const segments = Math.min(48, Math.max(8, Math.round(fovDegrees / 5)));
        const startAngle = obj.heading - fovDegrees / 2;
        const stepAngle = fovDegrees / segments;

        const coords = isPano ? [] : [longitude, latitude];
        for (let i = 0; i <= segments; i++) {
            const angle = (startAngle + i * stepAngle + 360) % 360;
            const p = movePosition(latitude, longitude, angle, rangeKm);
            coords.push(p.longitude, p.latitude);
        }

        const entity = this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(longitude, latitude, 0),
            billboard: {
                image: IMAGE_ICON,
                width: 10, height: 10,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                scaleByDistance: new Cesium.NearFarScalar(500, 1.0, 20000, 0.4)
            },
            polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArray(coords),
                material: Cesium.Color.fromCssColorString("#38bdf8").withAlpha(0.18),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString("#38bdf8"),
                outlineWidth: 1,
                height: 0,
                arcType: Cesium.ArcType.GEODESIC,
                show: new Cesium.CallbackProperty(() => this._withinConeRange(obj), false)
            }
        });
        // Bewusst KEIN entity.worldViewerObject: ein Klick soll das dedizierte
        // Street-Level-Panel (Betrachter + Filter) öffnen, nicht das generische
        // Detailpanel – siehe app.js worldViewer.onObjectPicked.
        entity.streetLevelImage = obj;
        this.entityById.set(obj.id, entity);
        return entity;
    }

    /** Kegel erst aus der Nähe einblenden – bei hunderten Bildern sonst unleserlich. */
    _withinConeRange(obj) {
        const cam = this.worldViewer.getCameraPosition();
        if (!cam) return false;
        const dLat = cam.latitude - obj.position.latitude;
        const dLon = cam.longitude - obj.position.longitude;
        const approxMeters = Math.sqrt(dLat * dLat + dLon * dLon) * 111_000; // grobe Näherung reicht hier
        return approxMeters < CONE_VISIBLE_METERS;
    }

    /** Filter Bildtyp (ALLE/360°/FLACH) + Zeitraum, ohne neu zu laden. */
    setFilters(filters) {
        this.filters = { ...this.filters, ...filters };
        this._applyFilters();
    }

    _applyFilters() {
        const { imageType, startMs, endMs } = this.filters;
        for (const obj of this.objects) {
            const entity = this.entityById.get(obj.id);
            if (!entity) continue;

            let visible = true;
            if (imageType === "pano" && !obj.metadata.isPano) visible = false;
            if (imageType === "flat" && obj.metadata.isPano) visible = false;
            if (startMs != null && obj.timestamp < startMs) visible = false;
            if (endMs != null && obj.timestamp > endMs) visible = false;
            entity.show = visible;
        }
    }

    createEntity() {
        return null; // Entities entstehen ausschließlich über _rebuild()/_addCone()
    }

    /** Beim Wiedereinblenden sofort für den aktuellen Ausschnitt nachladen. */
    show() {
        super.show();
        this.refreshForView(true);
    }

    clear() {
        super.clear();
        this._lineEntities.clear();
    }
}
