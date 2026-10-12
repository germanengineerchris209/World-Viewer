/**
 * sceneDirector.js – Kamerafahrten aufnehmen und abspielen ("Szenen-Regisseur").
 *
 * Konzept aus "God's Eye View" (Bilawal Sidhu, MIT-Lizenz,
 * https://github.com/bilawalsidhu/gods-eye-view) übernommen: Kamerapositionen
 * als Stationen einer Fahrt merken, dazwischen weich fliegen.
 *
 * Die Interpolation nutzt bewusst Cesiums eigenes camera.flyTo() statt einer
 * eigenen Spline-Berechnung – das liefert dieselbe weiche Ein-/Ausschwing-
 * Bewegung wie der Rest der App (z.B. "Hinfliegen") und bleibt dadurch mit
 * wenig Code robust.
 *
 * Der Routen-Flythrough (WEB-92) ist ein Spezialfall derselben Maschinerie:
 * die Punkte einer schon berechneten OSRM-Route (js/routeTool.js) werden zu
 * Stationen mit Blickrichtung in Fahrtrichtung, ohne Haltezeit.
 */

const MIN_LEG_SECONDS = 1.5;
const MAX_LEG_SECONDS = 6;
const LEG_SPEED_MPS = 4000; // Reisegeschwindigkeit für die Flugdauer zwischen Stationen

const EARTH_RADIUS_M = 6_371_000;

let nextStationId = 1;

/** Flugdauer zwischen zwei Stationen aus ihrem Abstand ableiten (weich, aber nicht endlos lang). */
export function legDurationFor(distanceMeters) {
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return MIN_LEG_SECONDS;
    const seconds = distanceMeters / LEG_SPEED_MPS;
    return Math.min(MAX_LEG_SECONDS, Math.max(MIN_LEG_SECONDS, seconds));
}

/** Distanz zwischen zwei {longitude, latitude} in Metern (Haversine, reicht für Flugdauern). */
export function haversineMeters(lat0, lon0, lat1, lon1) {
    const toRad = Cesium.Math.toRadians;
    const dLat = toRad(lat1 - lat0);
    const dLon = toRad(lon1 - lon0);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat0)) * Math.cos(toRad(lat1)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Peilung (Grad, 0 = Nord) von Punkt 0 zu Punkt 1. */
export function bearingDegrees(lat0, lon0, lat1, lon1) {
    const toRad = Cesium.Math.toRadians;
    const y = Math.sin(toRad(lon1 - lon0)) * Math.cos(toRad(lat1));
    const x = Math.cos(toRad(lat0)) * Math.sin(toRad(lat1)) -
        Math.sin(toRad(lat0)) * Math.cos(toRad(lat1)) * Math.cos(toRad(lon1 - lon0));
    return Cesium.Math.toDegrees(Math.atan2(y, x));
}

/**
 * Baut aus den Koordinaten einer geplanten Route (routeTool.js, [lon,lat]-Paare
 * im GeoJSON-Format) Stationen für einen Flythrough: in ungefähr gleichen
 * Abständen entlang der Route, mit Blick in Fahrtrichtung, ohne Haltezeit.
 */
export function buildStationsFromRoute(coordinates, options = {}) {
    const { height = 450, pitch = -22, sampleEveryMeters = 400 } = options;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];

    const sampled = [coordinates[0]];
    let accDistance = 0;
    for (let i = 1; i < coordinates.length; i++) {
        const [lon0, lat0] = coordinates[i - 1];
        const [lon1, lat1] = coordinates[i];
        accDistance += haversineMeters(lat0, lon0, lat1, lon1);
        if (accDistance >= sampleEveryMeters || i === coordinates.length - 1) {
            sampled.push(coordinates[i]);
            accDistance = 0;
        }
    }

    return sampled.map((coord, i) => {
        const [lon, lat] = coord;
        const next = sampled[i + 1] ?? coord;
        const heading = (next[0] === lon && next[1] === lat)
            ? 0
            : bearingDegrees(lat, lon, next[1], next[0]);
        return {
            id: nextStationId++,
            longitude: lon,
            latitude: lat,
            height,
            heading,
            pitch,
            roll: 0,
            holdSeconds: 0
        };
    });
}

export class SceneDirector {

    /** @param {WorldViewer} worldViewer */
    constructor(worldViewer) {
        this.worldViewer = worldViewer;
        this.viewer = worldViewer.viewer;
        this.camera = worldViewer.viewer.camera;

        this.stations = [];
        this.playing = false;

        this.onChange = null;          // (stations) => void – Stationenliste geändert
        this.onPlaybackChange = null;  // (playing: boolean) => void

        this._aborted = false;
        this._holdTimer = null;
        this._pendingResolve = null;
    }

    /* ─────────── Stationen verwalten ─────────── */

    /** Nimmt die aktuelle Kameraposition als neue Station auf. */
    addStation(holdSeconds = 2) {
        const pos = this.worldViewer.getCameraPosition();
        const rot = this.worldViewer.getCameraOrientation();
        if (!pos || !rot) return null;

        const station = {
            id: nextStationId++,
            longitude: pos.longitude,
            latitude: pos.latitude,
            height: pos.height,
            heading: rot.heading,
            pitch: rot.pitch,
            roll: rot.roll,
            holdSeconds
        };
        this.stations.push(station);
        this._emit();
        return station;
    }

    removeStation(id) {
        this.stations = this.stations.filter(s => s.id !== id);
        this._emit();
    }

    /** Verschiebt eine Station um +1/-1 Position in der Reihenfolge. */
    moveStation(id, direction) {
        const i = this.stations.findIndex(s => s.id === id);
        if (i < 0) return;
        const j = i + direction;
        if (j < 0 || j >= this.stations.length) return;
        [this.stations[i], this.stations[j]] = [this.stations[j], this.stations[i]];
        this._emit();
    }

    setHoldSeconds(id, seconds) {
        const station = this.stations.find(s => s.id === id);
        if (!station) return;
        station.holdSeconds = Math.max(0, Number(seconds) || 0);
        this._emit();
    }

    clear() {
        if (this.playing) this.stop();
        this.stations = [];
        this._emit();
    }

    /** Ersetzt die Stationenliste (z.B. nach dem Laden eines gespeicherten Szenen-Links). */
    setStations(stations) {
        if (this.playing) this.stop();
        this.stations = stations.map(s => ({ ...s, id: nextStationId++ }));
        this._emit();
    }

    /** Fliegt (weich, ohne die Fahrt zu starten) zu einer Station – für die Vorschau in der Liste. */
    previewStation(id) {
        const station = this.stations.find(s => s.id === id);
        if (!station || this.playing) return;
        this.worldViewer.stopFollowing();
        this._flyTo(station, 2);
    }

    /* ─────────── Abspielen ─────────── */

    /** Spielt die aufgenommene Fahrt ab (mind. 2 Stationen nötig). */
    async play() {
        if (this.playing || this.stations.length < 2) return false;
        return this._runSequence(this.stations);
    }

    /** Flythrough entlang einer geplanten Route (Spezialfall, nutzt dieselbe Abspiel-Logik). */
    async playRoute(coordinates, options = {}) {
        if (this.playing) return false;
        const stations = buildStationsFromRoute(coordinates, options);
        if (stations.length < 2) return false;
        return this._runSequence(stations);
    }

    /** Bricht eine laufende Fahrt sofort ab (z.B. durch Esc). */
    stop() {
        if (!this.playing || this._aborted) return;
        this._aborted = true;
        if (this._holdTimer) {
            clearTimeout(this._holdTimer);
            this._holdTimer = null;
        }
        this.camera.cancelFlight();
        this._pendingResolve?.();
        this._pendingResolve = null;
    }

    async _runSequence(stations) {
        this.playing = true;
        this._aborted = false;
        this.onPlaybackChange?.(true);
        document.body.classList.add("scene-director-playing");

        try {
            const startPos = this.worldViewer.getCameraPosition();
            const firstLegDistance = startPos
                ? haversineMeters(startPos.latitude, startPos.longitude, stations[0].latitude, stations[0].longitude)
                : null;

            await this._flyTo(stations[0], legDurationFor(firstLegDistance));
            if (!this._aborted) await this._hold(stations[0].holdSeconds);

            for (let i = 1; i < stations.length && !this._aborted; i++) {
                const distance = haversineMeters(
                    stations[i - 1].latitude, stations[i - 1].longitude,
                    stations[i].latitude, stations[i].longitude
                );
                await this._flyTo(stations[i], legDurationFor(distance));
                if (this._aborted) break;
                await this._hold(stations[i].holdSeconds);
            }
        } finally {
            this.playing = false;
            document.body.classList.remove("scene-director-playing");
            this.onPlaybackChange?.(false);
        }
        return !this._aborted;
    }

    _flyTo(station, duration) {
        return new Promise((resolve) => {
            this._pendingResolve = resolve;
            this.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(station.longitude, station.latitude, station.height),
                orientation: {
                    heading: Cesium.Math.toRadians(station.heading ?? 0),
                    pitch: Cesium.Math.toRadians(station.pitch ?? -90),
                    roll: Cesium.Math.toRadians(station.roll ?? 0)
                },
                duration,
                complete: () => { this._pendingResolve = null; resolve(); },
                cancel: () => { this._pendingResolve = null; resolve(); }
            });
        });
    }

    _hold(seconds) {
        if (!seconds || this._aborted) return Promise.resolve();
        return new Promise((resolve) => {
            this._pendingResolve = resolve;
            this._holdTimer = setTimeout(() => {
                this._holdTimer = null;
                this._pendingResolve = null;
                resolve();
            }, seconds * 1000);
        });
    }

    _emit() {
        this.onChange?.(this.stations);
    }
}
