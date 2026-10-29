/**
 * TrafficLayer.js – Verkehrs-Layer (WEB-93).
 *
 * GRUNDBETRIEB (immer, ohne jeden Schlüssel):
 *   Simuliert Fahrzeuge auf einem prozeduralen Straßenraster im
 *   sichtbaren Kartenausschnitt. Echte OSM-Straßengeometrie über die
 *   Overpass API scheitert aus dieser Sandbox an einer IP-Sperre
 *   (406/500 auf allen drei öffentlichen Instanzen, siehe
 *   docs/WEB-83-datenquellen-verkehr-oepnv-streetlevel-militaer.md,
 *   Abschnitt 1a) – deshalb erzeugt der Layer stattdessen ein an die
 *   Kamera gebundenes, deterministisches Gitter aus Hauptstraßen/
 *   Nebenstraßen. Das Gitter ist an feste Grad-Schritte "eingerastet",
 *   damit es beim Schwenken nicht springt. WICHTIG: Das ist eine
 *   SIMULATION, keine echte Straßenkarte – siehe statusText().
 *
 *   Spätere Erweiterung auf echte OSM-Geometrie (außerhalb gesperrter
 *   Sandbox-Netze funktioniert Overpass normal): ein Build-Skript nach
 *   Vorbild von scripts/build-volcano-fallback.mjs könnte Straßenzüge
 *   je Stadt einmalig abrufen und cachen, siehe Abschnitt 1a in
 *   docs/WEB-83-datenquellen-verkehr-oepnv-streetlevel-militaer.md.
 *
 * TOMTOM-LIVE-SCHICHT (optional, nur mit TOMTOM_API_KEY):
 *   Der Server (/api/traffic/flow) fragt echte Flussgeschwindigkeiten
 *   für einzelne Punkte ab (server/dataProxies.mjs) und hält dabei ein
 *   Tagesbudget ein. Dieser Layer tastet dafür nur wenige Punkte pro
 *   Kartenausschnitt ab (siehe MAX_SAMPLE_POINTS) und färbt die
 *   nächstgelegenen simulierten Straßen entsprechend ein – die
 *   einzelnen Fahrzeuge bleiben Simulation, nur ihr Tempo richtet sich
 *   dann nach echten Werten.
 */

import { BaseLayer } from "./BaseLayer.js";
import { haversineKm } from "../dataManager.js";

/** Kandidaten für den Gitterabstand in Grad – der größte, der unter
 *  MAX_LINES_PER_AXIS bleibt, wird für den aktuellen Ausschnitt gewählt. */
const STEP_CANDIDATES_DEG = [0.0015, 0.003, 0.006, 0.012, 0.024, 0.05, 0.1];
const MAX_LINES_PER_AXIS = 22;
const ARTERIAL_EVERY = 5;        // jede 5. Linie ist eine "Hauptstraße"

const ROAD_STYLE = {
    arterial: { speedKmh: 55, width: 3, color: "#ffd166" },
    residential: { speedKmh: 24, width: 1.5, color: "#aab2bd" }
};

const MAX_VEHICLES = 140;
const MAX_SAMPLE_POINTS = 10;     // Punkte je TomTom-Abfrage (Budgetschutz)
const TOMTOM_POLL_MS = 5 * 60_000; // deckt sich mit dem 5-Minuten-Server-Cache

let vehicleSeq = 0;

export class TrafficLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "traffic",
            name: "Verkehr",
            icon: "🚗",
            type: "vehicle",
            dataUrl: null
        });

        this.outOfRange = false;
        this.tomtomAvailable = false;
        this.tomtomStatus = null;     // Antwort von /api/traffic/status
        this._tomtomChecked = false;

        this._gridKey = null;         // aktuell gezeichneter, eingerasteter Ausschnitt
        this._lines = [];             // { id, orientation, index, cls, start, end, lengthKm, ratio }
        this._roadEntities = new Map(); // line.id → Entity
        this._vehicles = [];          // { entity, line, t, dir }

        this._lastFlowFetchAt = 0;
        this._flowPending = false;
    }

    get config() { return window.WORLD_VIEWER_CONFIG?.traffic ?? {}; }

    /* ═══════════ Laden / Sichtbarkeit ═══════════ */

    async load() {
        await this._checkTomTomStatus();
        this._rebuildGrid();
    }

    show() {
        super.show();
        this._startTicking();
        this._rebuildGrid();
    }

    hide() {
        super.hide();
        this._stopTicking();
    }

    clear() {
        this._stopTicking();
        for (const entity of this._roadEntities.values()) this.dataSource.entities.remove(entity);
        this._roadEntities.clear();
        this._lines = [];
        this._vehicles = [];
        this._gridKey = null;
        super.clear();
    }

    _startTicking() {
        // Kamera bewegt sich öfter als Flugzeuge schwenken – 2s Takt reicht,
        // um das Gitter nachzuziehen, ohne bei jedem Frame neu zu rechnen.
        this.startTimer("tick", 2000, () => this._rebuildGrid());
    }

    _stopTicking() {
        this.stopTimer("tick");
    }

    async _checkTomTomStatus() {
        if (this._tomtomChecked) return;
        this._tomtomChecked = true;
        try {
            const res = await fetch(this.config.statusUrl ?? "/api/traffic/status");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.tomtomStatus = await res.json();
            this.tomtomAvailable = !!this.tomtomStatus.configured;
        } catch (err) {
            // Kein Node-Server (nur "python3 -m http.server") oder Route fehlt –
            // Simulation läuft trotzdem, nur ohne Live-Schicht.
            this.tomtomAvailable = false;
            this.tomtomStatus = null;
        }
    }

    /* ═══════════ Sichtbarer Ausschnitt ═══════════ */

    /** @returns {object|null} Grad-Grenzen, null = zu weit herausgezoomt/ungültig. */
    _visibleBounds() {
        const viewer = this.worldViewer;
        const cfg = this.config;
        const cam = viewer.getCameraPosition();
        if (!cam) return null;

        const maxHeightKm = cfg.maxHeightKm ?? 8;
        if (cam.height / 1000 > maxHeightKm) return null;

        const maxSpan = cfg.maxSpanDegrees ?? 0.9;
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
        if (!(latSpan > 0 && lonSpan > 0) || latSpan > maxSpan || lonSpan > maxSpan) {
            return null; // zu groß, Datumsgrenze oder ungültig – lieber abschalten als Welt-Gitter zeichnen
        }
        return bounds;
    }

    /** Wählt den größten Gitterabstand, der höchstens MAX_LINES_PER_AXIS Linien ergibt. */
    _pickStep(spanDeg) {
        for (const step of STEP_CANDIDATES_DEG) {
            if (spanDeg / step <= MAX_LINES_PER_AXIS) return step;
        }
        return STEP_CANDIDATES_DEG[STEP_CANDIDATES_DEG.length - 1];
    }

    /* ═══════════ Gitter aufbauen ═══════════ */

    _rebuildGrid() {
        if (!this.enabled) return;
        const bounds = this._visibleBounds();

        if (!bounds) {
            if (!this.outOfRange) {
                this.outOfRange = true;
                this._clearGrid();
            }
            return;
        }
        this.outOfRange = false;

        const step = this._pickStep(Math.max(bounds.north - bounds.south, bounds.east - bounds.west));
        const snap = (v, s) => Math.round(v / s) * s;
        const north = snap(bounds.north, step) + step;
        const south = snap(bounds.south, step) - step;
        const west = snap(bounds.west, step) - step;
        const east = snap(bounds.east, step) + step;

        const key = `${step}:${north.toFixed(4)}:${south.toFixed(4)}:${west.toFixed(4)}:${east.toFixed(4)}`;
        if (key === this._gridKey) {
            this._maybePollTomTom(bounds);
            return;
        }
        this._gridKey = key;
        this._clearGrid();
        this._lines = this._buildLines(step, north, south, west, east);
        this._createRoadEntities();
        this._spawnVehicles();
        this._maybePollTomTom(bounds);
    }

    _clearGrid() {
        for (const entity of this._roadEntities.values()) this.dataSource.entities.remove(entity);
        this._roadEntities.clear();
        for (const v of this._vehicles) this.dataSource.entities.remove(v.entity);
        this._vehicles = [];
        this._lines = [];
        // Alle bisher getrackten Objekte gehören zu Fahrzeugen dieses Layers –
        // beim Neuaufbau des Gitters komplett zurücksetzen (kein Leck in
        // objects/entityById, sonst zählt die Sidebar alte Geisterfahrzeuge mit).
        this.objects = [];
        this.entityById.clear();
    }

    _buildLines(step, north, south, west, east) {
        const lines = [];
        let idx = 0;

        // Horizontale Linien (West-Ost, konstante Breite)
        for (let lat = south, i = 0; lat <= north + 1e-9; lat += step, i++) {
            const cls = i % ARTERIAL_EVERY === 0 ? "arterial" : "residential";
            lines.push({
                id: `h${idx++}`, orientation: "h", cls,
                start: { latitude: lat, longitude: west },
                end: { latitude: lat, longitude: east },
                ratio: 1
            });
        }
        // Vertikale Linien (Nord-Süd, konstante Länge)
        for (let lon = west, i = 0; lon <= east + 1e-9; lon += step, i++) {
            const cls = i % ARTERIAL_EVERY === 0 ? "arterial" : "residential";
            lines.push({
                id: `v${idx++}`, orientation: "v", cls,
                start: { latitude: south, longitude: lon },
                end: { latitude: north, longitude: lon },
                ratio: 1
            });
        }
        for (const line of lines) {
            line.lengthKm = haversineKm(
                line.start.latitude, line.start.longitude,
                line.end.latitude, line.end.longitude
            );
        }
        return lines;
    }

    _createRoadEntities() {
        for (const line of this._lines) {
            const style = ROAD_STYLE[line.cls];
            const entity = this.dataSource.entities.add({
                id: `traffic-road-${line.id}-${this._gridKey}`,
                polyline: {
                    positions: Cesium.Cartesian3.fromDegreesArray([
                        line.start.longitude, line.start.latitude,
                        line.end.longitude, line.end.latitude
                    ]),
                    width: style.width,
                    material: Cesium.Color.fromCssColorString(style.color).withAlpha(0.5),
                    clampToGround: true
                }
            });
            this._roadEntities.set(line.id, entity);
        }
    }

    /* ═══════════ Fahrzeuge ═══════════ */

    _spawnVehicles() {
        if (!this._lines.length) return;

        // Fahrzeuge anteilig nach Straßenlänge verteilen, Gesamtzahl gedeckelt.
        const totalLengthKm = this._lines.reduce((sum, l) => sum + l.lengthKm, 0) || 1;
        const perKm = Math.min(MAX_VEHICLES / totalLengthKm, 8);

        for (const line of this._lines) {
            const count = Math.max(1, Math.round(line.lengthKm * perKm));
            for (let n = 0; n < count && this._vehicles.length < MAX_VEHICLES; n++) {
                this._vehicles.push(this._createVehicle(line, n / count));
            }
        }
    }

    _createVehicle(line, t) {
        const style = ROAD_STYLE[line.cls];
        const dir = Math.random() < 0.5 ? 1 : -1;
        const obj = {
            id: `traffic-vehicle-${vehicleSeq++}`,
            type: "vehicle",
            name: line.cls === "arterial" ? "Fahrzeug (Hauptstraße, Simulation)"
                : "Fahrzeug (Nebenstraße, Simulation)",
            position: this._positionOnLine(line, t),
            heading: this._headingFor(line, dir),
            speed: style.speedKmh,
            timestamp: Date.now(),
            metadata: {
                roadClass: line.cls === "arterial" ? "Hauptstraße" : "Nebenstraße",
                simulated: true,
                live: false
            }
        };

        const entity = this.dataSource.entities.add({
            id: obj.id,
            position: new Cesium.CallbackProperty(() =>
                Cesium.Cartesian3.fromDegrees(obj.position.longitude, obj.position.latitude, 2), false),
            point: {
                pixelSize: line.cls === "arterial" ? 7 : 5,
                color: new Cesium.CallbackProperty(() =>
                    Cesium.Color.fromCssColorString(this._vehicleColor(line, obj)), false),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 1,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
        entity.worldViewerObject = obj;
        this.entityById.set(obj.id, entity);
        this.objects.push(obj);

        return { entity, line, t, dir, obj };
    }

    _headingFor(line, dir) {
        if (line.orientation === "h") return dir > 0 ? 90 : 270;  // Ost / West
        return dir > 0 ? 0 : 180;                                  // Nord / Süd
    }

    _positionOnLine(line, t) {
        return {
            latitude: line.start.latitude + (line.end.latitude - line.start.latitude) * t,
            longitude: line.start.longitude + (line.end.longitude - line.start.longitude) * t
        };
    }

    _vehicleColor(line, obj) {
        if (!obj.metadata.live) return ROAD_STYLE[line.cls].color;
        // Grün = freie Fahrt, Gelb = zäh, Rot = Stau (TomTom-Verhältnis)
        if (line.ratio >= 0.7) return "#5ad56b";
        if (line.ratio >= 0.4) return "#ffce45";
        return "#ff5c5c";
    }

    /** Pro Frame von layerManager aufgerufen – IMMER Simulationszeit, auch mit TomTom-Einfärbung. */
    update(simDeltaSeconds) {
        if (!this.enabled || this.outOfRange || simDeltaSeconds <= 0) return;

        for (const v of this._vehicles) {
            const ratio = v.line.ratio ?? 1;
            const speedKmh = v.obj.speed * Math.max(0.15, ratio);
            const distanceKm = (speedKmh / 3600) * simDeltaSeconds;
            const deltaT = v.line.lengthKm > 0 ? distanceKm / v.line.lengthKm : 0;

            v.t += deltaT * v.dir;
            if (v.t > 1) { v.t = 1; v.dir = -1; }
            else if (v.t < 0) { v.t = 0; v.dir = 1; }

            v.obj.position = { ...this._positionOnLine(v.line, v.t), altitude: 2 };
            v.obj.heading = this._headingFor(v.line, v.dir);
        }
    }

    /* ═══════════ TomTom-Live-Schicht (optional) ═══════════ */

    async _maybePollTomTom(bounds) {
        if (!this.tomtomAvailable || this._flowPending) return;
        if (Date.now() - this._lastFlowFetchAt < TOMTOM_POLL_MS) return;

        const points = this._samplePoints(bounds);
        if (!points.length) return;

        this._flowPending = true;
        this._lastFlowFetchAt = Date.now();
        try {
            const url = (this.config.flowUrl ?? "/api/traffic/flow")
                + "?points=" + encodeURIComponent(points.map(p => `${p.lat},${p.lon}`).join("|"));
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            this.tomtomStatus = { ...this.tomtomStatus, ...data.budget };
            this._applyFlow(points, data.results ?? []);
        } catch (err) {
            console.warn("[Traffic] TomTom-Flussdaten nicht abrufbar:", err.message);
        } finally {
            this._flowPending = false;
        }
    }

    /** Je eine Stichprobe am Mittelpunkt der Hauptstraßen (Budgetschutz: gedeckelt). */
    _samplePoints(bounds) {
        const arterials = this._lines.filter(l => l.cls === "arterial");
        const step = Math.max(1, Math.ceil(arterials.length / MAX_SAMPLE_POINTS));
        const points = [];
        for (let i = 0; i < arterials.length && points.length < MAX_SAMPLE_POINTS; i += step) {
            const mid = this._positionOnLine(arterials[i], 0.5);
            points.push({ lat: mid.latitude, lon: mid.longitude, line: arterials[i] });
        }
        return points;
    }

    _applyFlow(points, results) {
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            const point = points[i];
            if (!point || !r || !r.ok) continue;

            const ratio = r.freeFlowSpeed > 0
                ? Math.min(1, r.currentSpeed / r.freeFlowSpeed) : 1;
            point.line.ratio = ratio;

            // Alle Fahrzeuge auf dieser Straße als "live" markieren
            for (const v of this._vehicles) {
                if (v.line === point.line) {
                    v.obj.metadata.live = true;
                    v.obj.metadata.currentSpeedKmh = r.currentSpeed;
                    v.obj.metadata.freeFlowSpeedKmh = r.freeFlowSpeed;
                }
            }
            const entity = this._roadEntities.get(point.line.id);
            if (entity) {
                entity.polyline.material = Cesium.Color
                    .fromCssColorString(this._vehicleColor(point.line, { metadata: { live: true } }))
                    .withAlpha(0.7);
            }
        }
    }

    /* ═══════════ Status für die Sidebar ═══════════ */

    statusText() {
        if (this.outOfRange) {
            return "Zu weit herausgezoomt – näher an eine Stadt heranzoomen, "
                + "dann erscheint die Verkehrssimulation.";
        }
        if (this.tomtomAvailable) {
            const budget = this.tomtomStatus;
            const rest = budget?.dayBudget != null
                ? `, Tageskontingent ${budget.dayUsed ?? 0}/${budget.dayBudget}` : "";
            return `Simulation auf Straßenraster, eingefärbt mit echten `
                + `TomTom-Flussgeschwindigkeiten${rest}.`;
        }
        return "Simulation auf einem Straßenraster – keine echten Fahrzeuge, "
            + "keine Live-Daten (ohne TOMTOM_API_KEY).";
    }
}
