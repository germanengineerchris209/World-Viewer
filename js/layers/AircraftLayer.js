/**
 * AircraftLayer.js – Flugzeuge auf dem Globus.
 *
 * ZWEI BETRIEBSARTEN, automatisch gewählt:
 *
 *  LIVE  Echte Flugdaten über den eigenen Server (/api/flights), der sie
 *        von Flightradar24 oder OpenSky holt. Abgefragt wird immer nur
 *        der SICHTBARE Kartenausschnitt – das spart Guthaben und hält
 *        die Datenmenge klein. Zwischen zwei Abrufen werden die
 *        Flugzeuge per Koppelnavigation (Kurs + Geschwindigkeit)
 *        weiterbewegt, damit die Bewegung flüssig aussieht statt zu
 *        springen. Genau so macht es auch Flightradar24 selbst.
 *
 *  DEMO  Läuft kein Server, greift die bisherige Simulation mit den
 *        Beispieldaten aus data/aircraft.json.
 *
 * Dieselbe Klasse trägt auch den Militärflüge-Layer (WEB-90): die App
 * legt dafür eine zweite Instanz mit `overrides` an (eigene Farbe, eigener
 * Server-Endpunkt ohne Bounding-Box, kein Demo-Rückfall, Abgleich gegen
 * den zivilen Layer gegen Doppelanzeige). Siehe js/app.js.
 */

import { BaseLayer } from "./BaseLayer.js";
import { movePosition, svgDataUri, normalizeRecord } from "../dataManager.js";
import { FlightDataSource } from "../flightData.js";
import { typeName, typeWikipedia, sizeClass } from "../aircraftTypes.js";
import { modelClassFor, modelSpecFor, MODEL_HEADING_OFFSET_DEG } from "../aircraftModels.js";
import { normalizeHeading, slewHeading } from "../cockpit.js";

// Flugzeug-Symbol als Inline-SVG (Spitze zeigt nach oben = Norden)
const aircraftSvg = (color) => `
<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
  <path d="M20 3 L23 14 L36 20 L36 23 L23 20 L22 30 L27 34 L27 36 L20 34 L13 36 L13 34 L18 30 L17 20 L4 23 L4 20 L17 14 Z"
        fill="${color}" stroke="#1a1a1a" stroke-width="1"/>
</svg>`;

const SIZE_PX = { heavy: 34, medium: 28, light: 22 };

/*
 * Glyph → 3D-Modell: nur für die fünf ICAO-Typen, für die wir ein Modell
 * haben (siehe aircraftModels.js). Umschaltung mit Hysterese (NEAR zum
 * Wechsel auf das Modell, FAR zum Zurückwechseln), sonst flackert es an
 * der Schwelle. Modell-Erzeugung (GLB-Laden) übernimmt Cesiums
 * ModelVisualizer selbst erst beim ersten "show: true" – das ist das
 * geforderte Lazy-Laden, ohne das hier nachzubauen. Einmal erzeugt bleibt
 * das Model-Primitive beim Zurückzoomen erhalten (nur ausgeblendet),
 * also auch die geforderte Cache-Wiederverwendung.
 */
const MODEL_SWITCH_NEAR_M = 6000;
const MODEL_SWITCH_FAR_M = 9000;

// Kursglättung fürs Modell: dieselbe Mechanik wie die Kamera im Cockpit
// (normalizeHeading/slewHeading aus cockpit.js), nur mit eigener Rate –
// die Absicht ist, Datensprünge zwischen zwei Live-Updates weich
// auszugleichen, nicht die Kamera-Konstante zu kopieren.
const MODEL_HEADING_SLEW_DPS = 25;

const _scratchModelPos = new Cesium.Cartesian3();
const _scratchHpr = new Cesium.HeadingPitchRoll();

export class AircraftLayer extends BaseLayer {

    /**
     * @param {WorldViewer} worldViewer
     * @param {object} [overrides]
     * @param {string} [overrides.id="aircraft"]
     * @param {string} [overrides.name="Aircraft"]
     * @param {string} [overrides.icon="✈️"]
     * @param {string} [overrides.color="#ffd166"]       Symbol-/Spurfarbe
     * @param {string} [overrides.configKey="flights"]   Schlüssel in config.js
     * @param {boolean} [overrides.allowDemo=true]        bei fehlenden Live-Daten
     *        auf data/aircraft.json zurückfallen (für den Militär-Layer
     *        unerwünscht – dann lieber ein sauberer Leerzustand)
     * @param {boolean} [overrides.boundsInQuery=true]    Kartenausschnitt als
     *        Bounding-Box mitschicken (adsb.lol/mil kennt keine und liefert
     *        immer weltweit; die Begrenzung passiert dann clientseitig)
     * @param {AircraftLayer} [overrides.dedupeAgainst]   Maschinen, die dort
     *        schon angezeigt werden, hier nicht zusätzlich zeichnen
     */
    constructor(worldViewer, overrides = {}) {
        const {
            id = "aircraft",
            name = "Aircraft",
            icon = "✈️",
            color = "#ffd166",
            configKey = "flights",
            allowDemo = true,
            boundsInQuery = true,
            dedupeAgainst = null
        } = overrides;

        super(worldViewer, {
            id,
            name,
            icon,
            type: "aircraft",
            dataUrl: null            // Daten kommen über FlightDataSource
        });

        this._color = color;
        this._configKey = configKey;
        this.allowDemo = allowDemo;
        this.boundsInQuery = boundsInQuery;
        this.dedupeAgainst = dedupeAgainst;

        this._iconUrl = svgDataUri(aircraftSvg(color));
        this.source = new FlightDataSource(configKey);
        this.enableTrails(Cesium.Color.fromCssColorString(color));

        /** "live" | "demo" | "unknown" */
        this.mode = "unknown";
        this._statusMessage = "wird geprüft …";
        this.lastFetchAt = 0;
        this.fetchPending = false;
        this.outOfRange = false;     // true = zu weit herausgezoomt

        this._timer = null;
        this._lastRequestAt = 0;
        this._onStatusChange = null; // Callback für das UI
    }

    get config() {
        return window.WORLD_VIEWER_CONFIG?.[this._configKey] ?? {};
    }

    /** UI benachrichtigen, wenn sich Quelle/Status ändern. */
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
            this._statusMessage = this.source.sourceName;
            await this.refreshLive();
            this.startPolling();
        } else if (this.allowDemo) {
            this._statusMessage = "Demo-Daten";
            await this._loadDemo();
        } else {
            // Kein Demo-Rückfall (z.B. Militär-Layer): leer bleiben statt
            // mit erfundenen Daten zu füllen – der statusText() der Sidebar
            // erklärt, warum.
            this._statusMessage = this.source.lastError || "Keine Live-Daten verfügbar.";
        }
        this._notify();
    }

    async _loadDemo() {
        const records = await this.source.fetchDemo();
        for (const record of records) {
            this._upsert(record);
        }
        console.info(`[${this.name}] ${this.objects.length} Demo-Flugzeuge geladen.`);
    }

    /* ═══════════ Live-Abruf ═══════════ */

    /** Startet den regelmäßigen Abruf. */
    startPolling() {
        this.stopPolling();
        const interval = Math.max(
            this.config.refreshSeconds ?? 20,
            (this.source.serverMinIntervalMs || 0) / 1000
        ) * 1000;

        this._timer = setInterval(() => this.refreshLive(), interval);
        console.info(`[${this.name}] Live-Abruf alle ${Math.round(interval / 1000)} s.`);
    }

    stopPolling() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    /**
     * Berechnet den aktuell sichtbaren Kartenausschnitt.
     * @returns {object|null} null, wenn zu weit herausgezoomt
     */
    _visibleBounds() {
        const viewer = this.worldViewer;
        const camera = viewer.camera;
        const cfg = this.config;

        const cam = viewer.getCameraPosition();
        if (!cam) return null;

        // Zu weit weg? Dann kein Abruf – sonst kämen zehntausende
        // Flugzeuge zurück (und kosteten bei Flightradar24 viel Guthaben).
        const maxHeightKm = cfg.maxHeightKm ?? 3000;
        if (cam.height / 1000 > maxHeightKm) return null;

        const maxSpan = cfg.maxSpanDegrees ?? 40;
        const rect = camera.computeViewRectangle(viewer.scene.globe.ellipsoid);

        let bounds = null;

        if (rect) {
            const candidate = {
                north: Cesium.Math.toDegrees(rect.north),
                south: Cesium.Math.toDegrees(rect.south),
                west: Cesium.Math.toDegrees(rect.west),
                east: Cesium.Math.toDegrees(rect.east)
            };
            // Nur übernehmen, wenn der Ausschnitt klein genug ist und die
            // Datumsgrenze nicht überschritten wird (dann ist west > east)
            const latSpan = candidate.north - candidate.south;
            const lonSpan = candidate.east - candidate.west;
            if (latSpan > 0 && lonSpan > 0 && latSpan <= maxSpan && lonSpan <= maxSpan) {
                bounds = candidate;
            }
        }

        if (!bounds) {
            // Zu großer oder unbrauchbarer Ausschnitt → begrenzten Kasten
            // UM DEN BLICKPUNKT legen (nicht um den Nullpunkt!)
            const half = maxSpan / 2;
            bounds = {
                north: cam.latitude + half,
                south: cam.latitude - half,
                west: cam.longitude - half,
                east: cam.longitude + half
            };
        }

        // In gültige Bereiche schieben, ohne den Ausschnitt zu verkleinern
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

    /** Liegt ein Datensatz innerhalb der Bounding-Box? (für weltweite Feeds) */
    _insideBounds(record, bounds) {
        return record.latitude >= bounds.south && record.latitude <= bounds.north
            && record.longitude >= bounds.west && record.longitude <= bounds.east;
    }

    /**
     * Holt frische Live-Daten und gleicht sie mit der Anzeige ab.
     * @param {boolean} force  true = Mindestabstand ignorieren
     */
    async refreshLive(force = false) {
        if (this.mode !== "live" || this.fetchPending || !this.enabled) return;

        // Mindestabstand zwischen zwei Anfragen – schützt vor einer Flut
        // von Abrufen beim schnellen Schwenken der Kamera
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
            const result = await this.source.fetchLive(this.boundsInQuery ? bounds : undefined);
            if (!result) {
                if (this.objects.length === 0) {
                    console.warn(`[${this.name}] Live-Daten nicht verfügbar:`,
                        this.source.lastError);
                    if (this.allowDemo) {
                        // Live fehlgeschlagen – beim ersten Mal auf Demo
                        // umschalten, damit die Karte nicht leer bleibt
                        this.mode = "demo";
                        this.stopPolling();
                        await this._loadDemo();
                    }
                }
                return;
            }

            this.lastFetchAt = result.fetchedAt;

            let list = result.aircraft;
            if (!this.boundsInQuery) list = list.filter(a => this._insideBounds(a, bounds));
            if (this.dedupeAgainst) {
                list = list.filter(a => !this.dedupeAgainst.entityById.has(a.id));
            }

            this._reconcile(list);

        } finally {
            this.fetchPending = false;
            this._notify();
        }
    }

    /**
     * Gleicht die neue Flugzeugliste mit der Anzeige ab:
     * vorhandene aktualisieren, neue anlegen, verschwundene entfernen.
     */
    _reconcile(list) {
        const now = Date.now();
        const seen = new Set();

        for (const record of list) {
            seen.add(record.id);
            this._upsert(record);
        }

        // Flugzeuge, die eine Weile nicht mehr geliefert wurden, entfernen.
        // Kurze Aussetzer (Rand des Ausschnitts) werden so überbrückt.
        const graceMs = (this.config.removeAfterSeconds ?? 75) * 1000;

        for (const obj of [...this.objects]) {
            if (seen.has(obj.id)) {
                obj.__lastSeen = now;
            } else if (now - (obj.__lastSeen ?? 0) > graceMs) {
                this._remove(obj.id);
            }
        }
    }

    /** Legt ein Flugzeug an oder aktualisiert es. */
    _upsert(record) {
        const existing = this.entityById.get(record.id);

        if (existing) {
            const obj = existing.worldViewerObject;
            obj.position.latitude = record.latitude;
            obj.position.longitude = record.longitude;
            obj.position.altitude = record.altitude;
            obj.speed = record.speed;
            obj.heading = record.heading;
            obj.timestamp = record.timestamp;
            obj.__lastSeen = Date.now();
            // Zusatzangaben können nachträglich eintreffen
            Object.assign(obj.metadata, this._buildMetadata(record));
            return;
        }

        const obj = normalizeRecord({
            id: record.id,
            name: record.callsign || record.id,
            latitude: record.latitude,
            longitude: record.longitude,
            altitude: record.altitude,
            speed: record.speed,
            heading: record.heading,
            timestamp: record.timestamp,
            ...this._buildMetadata(record)
        }, "aircraft");

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
        const rawType = record.aircraftType ?? "";
        const readable = record.route ? record.aircraftType : typeName(rawType);

        // Route aus IATA-Codes zusammensetzen, falls vorhanden
        let route = record.route ?? "";
        if (!route && record.origin && record.destination) {
            route = `${record.origin} → ${record.destination}`;
        } else if (!route && record.destination) {
            route = `→ ${record.destination}`;
        }

        return {
            callsign: record.callsign || record.id,
            aircraftType: readable || rawType,
            typeCode: rawType,
            registration: record.registration ?? "",
            airline: record.airline ?? "",
            flightNumber: record.flightNumber ?? "",
            origin: record.origin ?? "",
            destination: record.destination ?? "",
            route,
            squawk: record.squawk ?? "",
            country: record.country ?? "",
            verticalRate: record.verticalRate ?? 0,
            onGround: !!record.onGround,
            // Welche Klasse ein 3D-Modell hat (sonst bleibt es beim Glyph)
            modelClass: modelClassFor(rawType),
            // Für die Bildsuche: Wikipedia-Artikel zum Flugzeugtyp
            wikipedia: record.wikipedia || typeWikipedia(rawType) || readable || "",
            live: this.mode === "live",
            military: !!record.military
        };
    }

    /** Entfernt ein Flugzeug vollständig. */
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
        const meta = obj.metadata;
        const px = SIZE_PX[sizeClass(meta.typeCode)] ?? SIZE_PX.medium;
        const spec = modelSpecFor(meta.modelClass);

        const definition = {
            id: obj.id,
            // CallbackProperty → Position wird pro Frame gelesen,
            // die Koppelnavigation schreibt nur ins Datenobjekt
            position: new Cesium.CallbackProperty(() =>
                Cesium.Cartesian3.fromDegrees(
                    obj.position.longitude,
                    obj.position.latitude,
                    obj.position.altitude
                ), false),
            billboard: {
                image: this._iconUrl,
                width: px,
                height: px,
                // Symbol in Flugrichtung drehen (Cesium dreht gegen den
                // Uhrzeigersinn, Kurse laufen im Uhrzeigersinn)
                rotation: new Cesium.CallbackProperty(
                    () => Cesium.Math.toRadians(-(obj.heading ?? 0)), false),
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 1.2e7, 0.45),
                disableDepthTestDistance: Number.POSITIVE_INFINITY,
                // Ohne Modell immer sichtbar; mit Modell nur, wenn das
                // Modell (noch) nicht übernommen hat
                show: spec
                    ? new Cesium.CallbackProperty(() => !this._isModelNear(obj), false)
                    : true
            },
            label: this._makeLabel(
                meta.callsign ?? obj.name,
                Cesium.Color.fromCssColorString(this._color)
            )
        };

        if (spec) {
            definition.model = {
                uri: spec.url,
                minimumPixelSize: spec.minimumPixelSize,
                maximumScale: spec.maximumScale,
                show: new Cesium.CallbackProperty(() => this._isModelNear(obj), false),
                orientation: new Cesium.CallbackProperty(() => {
                    Cesium.Cartesian3.fromDegrees(
                        obj.position.longitude,
                        obj.position.latitude,
                        obj.position.altitude,
                        Cesium.Ellipsoid.WGS84,
                        _scratchModelPos
                    );
                    _scratchHpr.heading = Cesium.Math.toRadians(
                        normalizeHeading((obj.__modelHeading ?? obj.heading ?? 0) + MODEL_HEADING_OFFSET_DEG)
                    );
                    _scratchHpr.pitch = 0;
                    _scratchHpr.roll = 0;
                    return Cesium.Transforms.headingPitchRollQuaternion(
                        _scratchModelPos, _scratchHpr, Cesium.Ellipsoid.WGS84);
                }, false)
            };
        }

        return this.dataSource.entities.add(definition);
    }

    /**
     * Ist dieses Flugzeug nah genug für das 3D-Modell statt des Glyphs?
     * Mit Hysterese (NEAR zum Umschalten, FAR zum Zurückschalten), damit
     * es an der Schwelle nicht flackert.
     */
    _isModelNear(obj) {
        Cesium.Cartesian3.fromDegrees(
            obj.position.longitude,
            obj.position.latitude,
            obj.position.altitude,
            Cesium.Ellipsoid.WGS84,
            _scratchModelPos
        );
        const distance = Cesium.Cartesian3.distance(
            this.viewer.camera.positionWC, _scratchModelPos);

        if (obj.__modelNear) {
            if (distance > MODEL_SWITCH_FAR_M) obj.__modelNear = false;
        } else if (distance <= MODEL_SWITCH_NEAR_M) {
            obj.__modelNear = true;
        }
        return !!obj.__modelNear;
    }

    /* ═══════════ Bewegung zwischen den Abrufen ═══════════ */

    /**
     * @param {number} simDeltaSeconds   Simulationszeit (Zeitraffer)
     * @param {number} realDeltaSeconds  echte vergangene Sekunden
     *
     * Im Live-Betrieb zählt die ECHTE Zeit: Die Flugzeuge sollen sich so
     * bewegen wie in der Wirklichkeit, unabhängig vom Zeitraffer-Regler.
     * Im Demo-Betrieb bleibt der Zeitraffer wirksam.
     */
    update(simDeltaSeconds, realDeltaSeconds = simDeltaSeconds) {
        if (!this.enabled) return;

        const delta = this.mode === "live" ? realDeltaSeconds : simDeltaSeconds;
        if (delta <= 0) return;

        for (const obj of this.objects) {
            const speedKmh = obj.speed || 0;
            if (speedKmh <= 0) continue;

            const distanceKm = (speedKmh / 3600) * delta;
            const next = movePosition(
                obj.position.latitude,
                obj.position.longitude,
                obj.heading,
                distanceKm
            );
            obj.position.latitude = next.latitude;
            obj.position.longitude = next.longitude;

            // Steig-/Sinkrate berücksichtigen (m/s)
            const vs = obj.metadata?.verticalRate ?? 0;
            if (vs) {
                obj.position.altitude = Math.max(0, obj.position.altitude + vs * delta);
            }

            this._recordTrailPoint(obj);
        }

        // Modell-Kurs weich nachführen (nur Flugzeuge mit 3D-Modell) –
        // sonst springt die Nase bei jedem Live-Update um mehrere Grad.
        for (const obj of this.objects) {
            if (!obj.metadata?.modelClass || !Number.isFinite(obj.heading)) continue;
            obj.__modelHeading = slewHeading(
                obj.__modelHeading ?? obj.heading, obj.heading, MODEL_HEADING_SLEW_DPS * delta);
        }
    }

    /**
     * Hinweistext in der Sidebar für Layer ohne eigenes Status-Panel
     * (z.B. den Militär-Layer, der kein flight-status-Element wie der
     * zivile Aircraft-Layer hat) – sauberer Leer-/Fehlerzustand statt
     * einer stillen, unerklärten leeren Ebene.
     */
    statusText() {
        if (this.allowDemo) return null;   // ziviler Layer hat eigenes Panel
        if (this.outOfRange) return "Zu weit herausgezoomt – näher heranzoomen.";
        if (this.mode === "live" && this.objects.length === 0 && !this.fetchPending) {
            return this.source.lastError
                ? `Keine Daten: ${this.source.lastError}`
                : "Aktuell keine sichtbaren Maschinen im Ausschnitt.";
        }
        if (this.mode !== "live" && this.source.lastError) {
            return this.source.lastError;
        }
        return null;
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
        this.stopPolling();      // ausgeblendet = keine Abrufe = kein Verbrauch
    }

    clear() {
        this.stopPolling();
        super.clear();
    }
}
