/**
 * viewer.js – Kapselt die CesiumJS-Initialisierung.
 *
 * Die Weltansicht ist standardmäßig eine echte SATELLITENANSICHT
 * (Esri World Imagery) – hochauflösende Luft-/Satellitenbilder bis auf
 * Straßen- und Hausebene, ganz ohne API-Key.
 *
 * Optionale Keys (config.js) erweitern das:
 *   • Cesium-Ion-Token → 3D-Gelände (Berge) + OSM-3D-Gebäude
 *   • Google-Maps-Key  → fotorealistische 3D-Tiles (Google-Earth-Optik)
 */

import { BasemapManager } from "./basemaps.js";

const CONFIG = () => window.WORLD_VIEWER_CONFIG || {};

export class WorldViewer {

    constructor(containerId) {
        this.containerId = containerId;
        this.viewer = null;
        this.scene = null;
        this.camera = null;
        this.basemaps = null;
        this.onObjectPicked = null;   // Callback: (entity | null) => void
        this._followedEntity = null;
        this._pickLocationCallback = null;
        this.inputSuppressed = false; // true während z.B. das Zeichenwerkzeug aktiv ist
    }

    /** Initialisiert den Cesium-Viewer. */
    async init() {
        const cfg = CONFIG();

        // Ion-Token setzen, falls vorhanden (leer = Ion wird nicht genutzt)
        Cesium.Ion.defaultAccessToken = cfg.cesiumIonToken || "";

        this.viewer = new Cesium.Viewer(this.containerId, {
            animation: false,
            timeline: false,
            baseLayerPicker: false,
            geocoder: false,
            homeButton: false,
            sceneModePicker: false,
            navigationHelpButton: false,
            infoBox: false,
            selectionIndicator: false,
            fullscreenButton: false,
            requestRenderMode: false,
            // Wir setzen die Basemap selbst (siehe BasemapManager)
            baseLayer: false,
            terrainProvider: new Cesium.EllipsoidTerrainProvider()
        });

        this.scene = this.viewer.scene;
        this.camera = this.viewer.camera;

        // Basemap-Verwaltung aufsetzen und Satellitenansicht laden
        this.basemaps = new BasemapManager(this.viewer);
        const wanted = cfg.defaultBasemap || "hybrid";
        const ok = await this.basemaps.setBasemap(wanted);
        if (!ok && wanted !== "streets") {
            // Notfallplan: Wenn die Satellitenkacheln nicht erreichbar sind,
            // wenigstens die OpenStreetMap-Karte zeigen.
            console.warn("[viewer] Satellitenkarte nicht verfügbar – nutze OpenStreetMap.");
            await this.basemaps.setBasemap("streets");
        }

        // 3D-Gelände (nur mit Ion-Token)
        await this.basemaps.enableTerrain();

        // Fotorealistische 3D-Gebäude (nur mit Google-Key)
        if (cfg.googleMapsApiKey && cfg.useGooglePhotorealistic) {
            await this.basemaps.enableGooglePhotorealistic();
        }

        this._configureScene();
        this._setupPicking();

        return this.viewer;
    }

    /** Grundlegende Szene-Einstellungen (Atmosphäre, Performance). */
    _configureScene() {
        const scene = this.scene;

        scene.globe.enableLighting = false;          // per Button umschaltbar
        scene.globe.showGroundAtmosphere = true;
        scene.skyAtmosphere.show = true;
        scene.fog.enabled = true;

        // Objekte sollen nicht hinter Bergen verschwinden
        scene.globe.depthTestAgainstTerrain = false;
        scene.screenSpaceCameraController.enableCollisionDetection = true;

        // Beim Herauszoomen mehr Details behalten (weicherer Übergang)
        scene.globe.maximumScreenSpaceError = 1.8;

        // Startansicht: Erde aus dem Weltraum
        this.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(10.0, 30.0, 25_000_000)
        });
    }

    /** Klick-Erkennung auf Objekte. */
    _setupPicking() {
        const handler = new Cesium.ScreenSpaceEventHandler(this.scene.canvas);
        handler.setInputAction((movement) => {
            // Ein ausstehender Standort-Klick (z.B. für eine neue
            // Beobachtungszone) hat Vorrang vor der Objektauswahl.
            if (this._pickLocationCallback) {
                const callback = this._pickLocationCallback;
                this._pickLocationCallback = null;
                const cartesian = this.camera.pickEllipsoid(movement.position, this.scene.globe.ellipsoid);
                if (!cartesian) { callback(null, null); return; }
                const carto = Cesium.Cartographic.fromCartesian(cartesian);
                callback(Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude));
                return;
            }

            // Solange ein anderes Werkzeug (z.B. Zeichnen/Messen) die Klicks
            // selbst auswertet, keine Objektauswahl auslösen.
            if (this.inputSuppressed) return;

            const picked = this.scene.pick(movement.position);
            const entity = (picked && picked.id instanceof Cesium.Entity) ? picked.id : null;
            if (this.onObjectPicked) this.onObjectPicked(entity);
        }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    /**
     * Wartet auf den nächsten Klick auf den Globus und liefert die
     * Koordinate statt eine Objektauswahl auszulösen. Für Werkzeuge wie
     * "Beobachtungszone hinzufügen" gedacht.
     * @param {(lon: number|null, lat: number|null) => void} callback
     */
    requestLocationPick(callback) {
        this._pickLocationCallback = callback;
    }

    cancelLocationPick() {
        this._pickLocationCallback = null;
    }

    /* ───────────── Kamera-Funktionen ───────────── */

    /** Sanfter Flug zu einer Koordinate. */
    flyTo(longitude, latitude, height = 200_000, duration = 2.5) {
        this.stopFollowing();
        this.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
            duration
        });
    }

    /** Sanfter Flug zu einer Entity (Objekt bleibt im Fokus). */
    flyToEntity(entity, height = 60_000) {
        if (!entity) return;
        const pos = entity.position?.getValue(this.viewer.clock.currentTime);
        if (!pos) return;
        const carto = Cesium.Cartographic.fromCartesian(pos);
        const lon = Cesium.Math.toDegrees(carto.longitude);
        const lat = Cesium.Math.toDegrees(carto.latitude);

        // Statische Objekte (Kameras, Gebäude) näher anfliegen als Satelliten
        const obj = entity.worldViewerObject;
        const target = obj && (obj.type === "camera" || obj.type === "infrastructure")
            ? 1_500
            : Math.max(carto.height + height, height);

        this.flyTo(lon, lat, target);
    }

    /** Kamera an ein Objekt heften (Verfolgen). */
    followEntity(entity) {
        this.viewer.trackedEntity = entity || undefined;
        this._followedEntity = entity || null;
    }

    stopFollowing() {
        this.viewer.trackedEntity = undefined;
        this._followedEntity = null;
    }

    get followedEntity() { return this._followedEntity; }

    /** Zur Weltansicht zurückkehren. */
    flyHome(duration = 2.0) {
        this.stopFollowing();
        this.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(10.0, 30.0, 25_000_000),
            duration
        });
    }

    /** Zwischen 3D-Globus und 2D-Karte wechseln. */
    toggleSceneMode() {
        if (this.scene.mode === Cesium.SceneMode.SCENE3D) {
            this.scene.morphTo2D(1.2);
        } else {
            this.scene.morphTo3D(1.2);
        }
    }

    /** Tag/Nacht-Beleuchtung umschalten. */
    toggleLighting() {
        this.scene.globe.enableLighting = !this.scene.globe.enableLighting;
        return this.scene.globe.enableLighting;
    }

    /** Aktuelle Kameraposition als {lat, lon, height} in Grad/Metern. */
    getCameraPosition() {
        const carto = this.camera.positionCartographic;
        if (!carto) return null;
        return {
            latitude: Cesium.Math.toDegrees(carto.latitude),
            longitude: Cesium.Math.toDegrees(carto.longitude),
            height: carto.height
        };
    }

    /** Aktuelle Kamera-Ausrichtung in Grad (für Share-Links). */
    getCameraOrientation() {
        return {
            heading: Cesium.Math.toDegrees(this.camera.heading),
            pitch: Cesium.Math.toDegrees(this.camera.pitch),
            roll: Cesium.Math.toDegrees(this.camera.roll)
        };
    }

    /** Kamera direkt (ohne Flug-Animation) auf eine gespeicherte Sicht setzen. */
    setCameraView({ longitude, latitude, height, heading = 0, pitch = -90, roll = 0 }) {
        this.stopFollowing();
        this.camera.setView({
            destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
            orientation: {
                heading: Cesium.Math.toRadians(heading),
                pitch: Cesium.Math.toRadians(pitch),
                roll: Cesium.Math.toRadians(roll)
            }
        });
    }
}
