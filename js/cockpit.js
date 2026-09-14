/**
 * cockpit.js – Mitflug-Ansicht: die Kamera sitzt im Cockpit.
 *
 * Portiert aus "God's Eye View" von Bilawal Sidhu (MIT-Lizenz,
 * https://github.com/bilawalsidhu/gods-eye-view, dort Klasse
 * CockpitViewController in src/ui.js und src/cockpitMath.js).
 *
 * Der schwierige Teil ist nicht das Setzen der Kamera, sondern dass es
 * nicht ruckelt. Live-Flugdaten kommen alle 20–30 Sekunden; jede neue
 * Meldung korrigiert die Position um mehrere hundert Meter. Würde die
 * Kamera dieser Korrektur direkt folgen, ergäbe das aus der Ich-Perspektive
 * einen Ruck oder sogar einen Rückwärtssprung.
 *
 * Die Lösung sind drei Kniffe:
 *   1. Ein TRÄGHEITSANKER: Die Kamera läuft eigenständig mit Kurs und
 *      Geschwindigkeit vorwärts und nähert sich der gemeldeten Position
 *      nur mit begrenzter Rate an (nie schneller als 22 % der
 *      Eigengeschwindigkeit) – dadurch ist die Korrektur unsichtbar.
 *   2. Ein KURS-BEGRENZER: Der Blick dreht maximal 28°/s.
 *   3. Eine BODENFREIHEIT: Die Kamera bleibt mindestens 12 m über Grund.
 */

/* Konstanten wie im Referenzprojekt */
const HEADING_SLEW_DPS = 28;      // maximale Blickdrehung pro Sekunde
const FORWARD_OFFSET_M = 7;       // Kamera sitzt 7 m vor dem Ankerpunkt
const UP_OFFSET_M = 2.6;          // und 2,6 m darüber
const MIN_GROUND_CLEARANCE_M = 12;
const VIEW_PITCH_DEG = -4;        // leicht nach unten geneigt
const UPDATE_MS = 50;             // 20 Bilder pro Sekunde reichen

/* ═══════════ Reine Rechenfunktionen ═══════════ */

export function normalizeHeading(deg) {
    const value = Number(deg);
    if (!Number.isFinite(value)) return 0;
    return ((value % 360) + 360) % 360;
}

/** Dreht `current` höchstens um `maxStepDeg` in Richtung `target`. */
export function slewHeading(current, target, maxStepDeg) {
    const from = normalizeHeading(current);
    const to = normalizeHeading(target);
    if (!Number.isFinite(maxStepDeg) || maxStepDeg <= 0) return from;
    const delta = ((to - from + 540) % 360) - 180;   // kürzester Weg
    const step = Math.max(-maxStepDeg, Math.min(maxStepDeg, delta));
    return normalizeHeading(from + step);
}

/**
 * Wie weit darf sich der Anker in diesem Bild an die gemeldete Position
 * annähern? Drei Grenzen gleichzeitig – die dritte ist die wichtige:
 * Die Korrektur ist nie schneller als ein Fünftel der Reisegeschwindigkeit
 * und damit für das Auge nicht als Ruck erkennbar.
 */
export function anchorCorrectionStep(distanceM, speedMps, dtSec) {
    if (!Number.isFinite(distanceM) || distanceM <= 0) return 0;
    if (!Number.isFinite(dtSec) || dtSec <= 0) return 0;

    const dt = Math.min(0.1, dtSec);
    const speed = Number.isFinite(speedMps) ? Math.max(0, speedMps) : 0;
    const eased = distanceM * (1 - Math.exp(-1.25 * dt));
    const correctionRateMps = Math.max(0.75, speed * 0.22);

    return Math.min(distanceM, eased, correctionRateMps * dt);
}

/** Hebt eine Höhe an, damit ein Mindestabstand zum Boden bleibt. */
export function groundSafeHeight(proposedHeightM, groundHeightM, clearanceM) {
    if (!Number.isFinite(proposedHeightM)) return proposedHeightM;
    if (!Number.isFinite(groundHeightM)) return proposedHeightM;
    const clearance = Number.isFinite(clearanceM) ? Math.max(0, clearanceM) : 0;
    return Math.max(proposedHeightM, groundHeightM + clearance);
}

/* ═══════════ Steuerung ═══════════ */

export class CockpitView {

    /**
     * @param {WorldViewer} worldViewer
     * @param {UI} ui
     */
    constructor(worldViewer, ui) {
        this.worldViewer = worldViewer;
        this.viewer = worldViewer.viewer;
        this.ui = ui;

        this.active = false;
        this.entity = null;
        this.heading = null;

        this.onStateChange = null;   // (active, object) => void

        this._anchor = new Cesium.Cartesian3();
        this._anchorValid = false;
        this._lastFrameMs = 0;
        this._lastUpdateMs = 0;
        this._entityWasShown = true;
        this._removeListener = null;

        // Wiederverwendete Objekte – im Renderloop soll nichts
        // neu angelegt werden
        this._s = {
            enu: new Cesium.Matrix4(),
            local: new Cesium.Cartesian3(),
            horizontal: new Cesium.Cartesian3(),
            forward: new Cesium.Cartesian3(),
            up: new Cesium.Cartesian3(),
            camera: new Cesium.Cartesian3(),
            target: new Cesium.Cartesian3(),
            advance: new Cesium.Cartesian3(),
            correction: new Cesium.Cartesian3()
        };
    }

    /**
     * Lebt die verfolgte Entity noch?
     *
     * Achtung: Jeder Layer hat seine EIGENE CustomDataSource, die Objekte
     * liegen also NICHT in viewer.entities. Deshalb wird die Sammlung
     * gefragt, zu der die Entity selbst gehört.
     */
    _entityAlive(entity = this.entity) {
        if (!entity) return false;
        const collection = entity.entityCollection;
        if (collection?.contains) return collection.contains(entity);
        // Notnagel, falls Cesium die Sammlung einmal nicht mitgibt
        return !!entity.position;
    }

    /* ─────────── Ein- und Aussteigen ─────────── */

    /**
     * Steigt in ein Flugzeug ein.
     * @param {Cesium.Entity} entity
     * @returns {boolean} ob es geklappt hat
     */
    enter(entity) {
        if (this.active) this.exit();

        const obj = entity?.worldViewerObject;
        if (!obj || obj.type !== "aircraft") return false;

        const position = entity.position?.getValue(this.viewer.clock.currentTime);
        if (!position) return false;

        // Laufenden Kameraflug abbrechen, sonst kämpfen zwei Steuerungen
        this.viewer.camera.cancelFlight();
        this.worldViewer.stopFollowing();

        this.entity = entity;
        this._entityWasShown = entity.show;
        entity.show = false;              // sonst sitzt man im eigenen Rumpf

        this.heading = normalizeHeading(obj.heading ?? 0);
        Cesium.Cartesian3.clone(position, this._anchor);
        this._anchorValid = true;
        this._lastFrameMs = performance.now();
        this._lastUpdateMs = 0;

        this.active = true;
        this.viewer.trackedEntity = undefined;
        this.viewer.scene.screenSpaceCameraController.enableInputs = false;
        document.body.classList.add("cockpit-mode");

        // Kameraänderungen gehören VOR die Szenenaktualisierung. Aus
        // preRender heraus würde der Detailgrad der 3D-Kacheln in eine
        // Endlosschleife geraten.
        this._removeListener = this.viewer.scene.preUpdate.addEventListener(
            () => this._update());

        this.onStateChange?.(true, obj);
        return true;
    }

    /** Verlässt die Cockpit-Ansicht. */
    exit({ restoreTracking = true } = {}) {
        if (!this.active) return false;

        const entity = this.entity;
        this.active = false;
        this.entity = null;
        this.heading = null;
        this._anchorValid = false;

        this._removeListener?.();
        this._removeListener = null;

        this.viewer.scene.screenSpaceCameraController.enableInputs = true;
        document.body.classList.remove("cockpit-mode");

        if (entity && this._entityAlive(entity)) {
            entity.show = this._entityWasShown;
            if (restoreTracking) this.worldViewer.flyToEntity(entity, 20_000);
        }
        this._entityWasShown = true;

        this.onStateChange?.(false, null);
        return true;
    }

    toggle(entity) {
        return this.active ? this.exit() : this.enter(entity);
    }

    /* ─────────── Kameraführung ─────────── */

    _update() {
        const nowMs = performance.now();

        // Ziel verloren? Dann sauber aussteigen.
        const obj = this.entity?.worldViewerObject;
        if (!obj || !this._entityAlive()) {
            this.exit({ restoreTracking: false });
            return;
        }

        // Auf 20 Bilder pro Sekunde begrenzen
        if (nowMs - this._lastUpdateMs < UPDATE_MS) return;

        const dtSec = Math.min(0.1, Math.max(0, (nowMs - this._lastFrameMs) / 1000));
        this._lastFrameMs = nowMs;
        this._lastUpdateMs = nowMs;

        const target = this.entity.position?.getValue(this.viewer.clock.currentTime);
        if (!target) return;

        // Kurs sanft nachführen
        if (Number.isFinite(obj.heading)) {
            this.heading = slewHeading(
                this.heading ?? obj.heading, obj.heading, HEADING_SLEW_DPS * dtSec);
        }

        const headingRad = Cesium.Math.toRadians(this.heading ?? 0);
        const pitchRad = Cesium.Math.toRadians(VIEW_PITCH_DEG);
        const speedMps = Math.max(0, (obj.speed ?? 0) / 3.6);   // km/h → m/s

        if (!this._anchorValid) {
            Cesium.Cartesian3.clone(target, this._anchor);
            this._anchorValid = true;
        }

        const s = this._s;

        /* 1. Anker eigenständig vorwärts bewegen (Trägheit) */
        Cesium.Transforms.eastNorthUpToFixedFrame(
            this._anchor, Cesium.Ellipsoid.WGS84, s.enu);

        s.local.x = Math.sin(headingRad);   // Ost
        s.local.y = Math.cos(headingRad);   // Nord
        s.local.z = 0;
        Cesium.Matrix4.multiplyByPointAsVector(s.enu, s.local, s.horizontal);
        Cesium.Cartesian3.normalize(s.horizontal, s.horizontal);

        Cesium.Cartesian3.multiplyByScalar(s.horizontal, speedMps * dtSec, s.advance);
        Cesium.Cartesian3.add(this._anchor, s.advance, this._anchor);

        /* 2. Gebremst zur gemeldeten Position hin korrigieren */
        Cesium.Cartesian3.subtract(target, this._anchor, s.correction);
        const distance = Cesium.Cartesian3.magnitude(s.correction);
        const step = anchorCorrectionStep(distance, speedMps, dtSec);

        if (step > 0 && distance > 0) {
            Cesium.Cartesian3.multiplyByScalar(s.correction, step / distance, s.correction);
            Cesium.Cartesian3.add(this._anchor, s.correction, this._anchor);
        }

        /* 3. Mindestabstand zum Boden einhalten */
        const carto = Cesium.Cartographic.fromCartesian(this._anchor);
        if (carto) {
            const ground = this.viewer.scene.globe.getHeight(carto) ?? 0;
            const safe = groundSafeHeight(
                carto.height, ground, MIN_GROUND_CLEARANCE_M - UP_OFFSET_M);
            if (safe !== carto.height) {
                carto.height = safe;
                Cesium.Ellipsoid.WGS84.cartographicToCartesian(carto, this._anchor);
            }
        }

        /* 4. Blickrichtung und Oben-Vektor im lokalen Horizontsystem bauen */
        Cesium.Transforms.eastNorthUpToFixedFrame(
            this._anchor, Cesium.Ellipsoid.WGS84, s.enu);

        s.local.x = Math.sin(headingRad);
        s.local.y = Math.cos(headingRad);
        s.local.z = 0;
        Cesium.Matrix4.multiplyByPointAsVector(s.enu, s.local, s.horizontal);
        Cesium.Cartesian3.normalize(s.horizontal, s.horizontal);

        s.local.x = Math.sin(headingRad) * Math.cos(pitchRad);
        s.local.y = Math.cos(headingRad) * Math.cos(pitchRad);
        s.local.z = Math.sin(pitchRad);
        Cesium.Matrix4.multiplyByPointAsVector(s.enu, s.local, s.forward);
        Cesium.Cartesian3.normalize(s.forward, s.forward);

        s.local.x = -Math.sin(headingRad) * Math.sin(pitchRad);
        s.local.y = -Math.cos(headingRad) * Math.sin(pitchRad);
        s.local.z = Math.cos(pitchRad);
        Cesium.Matrix4.multiplyByPointAsVector(s.enu, s.local, s.up);
        Cesium.Cartesian3.normalize(s.up, s.up);

        /* 5. Kameraposition = Anker + Vorwärts- + Höhenversatz */
        Cesium.Cartesian3.multiplyByScalar(s.horizontal, FORWARD_OFFSET_M, s.camera);
        Cesium.Cartesian3.add(this._anchor, s.camera, s.camera);

        Cesium.Matrix4.getTranslation(s.enu, s.target);
        Cesium.Cartesian3.normalize(s.target, s.target);
        Cesium.Cartesian3.multiplyByScalar(s.target, UP_OFFSET_M, s.target);
        Cesium.Cartesian3.add(s.camera, s.target, s.camera);

        this.viewer.camera.setView({
            destination: s.camera,
            orientation: { direction: s.forward, up: s.up }
        });
    }

    /** Aktuelle Werte für die Anzeige im Cockpit. */
    readout() {
        const obj = this.entity?.worldViewerObject;
        if (!obj) return null;
        const m = obj.metadata ?? {};
        return {
            callsign: m.callsign ?? obj.name,
            aircraftType: m.aircraftType ?? "",
            route: m.route ?? "",
            altitude: obj.position.altitude,
            speed: obj.speed,
            heading: this.heading ?? obj.heading,
            verticalRate: m.verticalRate ?? 0,
            latitude: obj.position.latitude,
            longitude: obj.position.longitude
        };
    }
}
