/**
 * app.js – Einstiegspunkt des World Viewers.
 *
 * Ablauf:
 *   1. 3D-Viewer + Satellitenkarte initialisieren (viewer.js, basemaps.js)
 *   2. Layer registrieren und laden (layerManager.js + layers/)
 *      – der Aircraft-Layer holt dabei Live-Flugdaten, falls der Server läuft
 *   3. UI, Suche, Timeline und KI-Assistent verdrahten
 *   4. Zentrale Update-Schleife starten
 */

import { WorldViewer } from "./viewer.js";
import { LayerManager } from "./layerManager.js";
import { UI } from "./ui.js";
import { Search } from "./search.js";
import { Timeline } from "./timeline.js";
import { Assistant } from "./ai/assistant.js";

import { CockpitView } from "./cockpit.js";

import { AircraftLayer } from "./layers/AircraftLayer.js";
import { ShipLayer } from "./layers/ShipLayer.js";
import { SatelliteLayer } from "./layers/SatelliteLayer.js";
import { CameraLayer } from "./layers/CameraLayer.js";
import { InfrastructureLayer } from "./layers/InfrastructureLayer.js";
import { EarthquakeLayer } from "./layers/EarthquakeLayer.js";
import { LaunchLayer } from "./layers/LaunchLayer.js";
import { FireLayer } from "./layers/FireLayer.js";

async function main() {
    /* 1 ── 3D-Globus mit Satellitenansicht */
    const worldViewer = new WorldViewer("cesiumContainer");
    await worldViewer.init();

    /* 2 ── Layer */
    const layerManager = new LayerManager();
    const aircraftLayer = new AircraftLayer(worldViewer);
    const satelliteLayer = new SatelliteLayer(worldViewer);

    layerManager.register(aircraftLayer);
    layerManager.register(new ShipLayer(worldViewer));
    layerManager.register(satelliteLayer);
    layerManager.register(new CameraLayer(worldViewer));
    layerManager.register(new InfrastructureLayer(worldViewer));
    layerManager.register(new EarthquakeLayer(worldViewer));
    layerManager.register(new LaunchLayer(worldViewer));
    layerManager.register(new FireLayer(worldViewer));

    /* 3 ── UI, Suche, Timeline, KI */
    const ui = new UI(worldViewer, layerManager);
    ui.aircraftLayer = aircraftLayer;
    ui.buildBasemapSwitcher();

    // Statusanzeige der Flugdaten aktuell halten
    aircraftLayer.onStatusChange((status) => ui.updateFlightStatus(status));

    await layerManager.loadAll();
    ui.buildLayerToggles();
    ui.updateFlightStatus(aircraftLayer.getStatus());

    new Search(worldViewer, layerManager, ui);

    /* Cockpit-Ansicht: mit der Kamera im Flugzeug mitfliegen */
    const cockpit = new CockpitView(worldViewer, ui);
    ui.cockpit = cockpit;
    cockpit.onStateChange = (active) => ui.setCockpitActive(active);

    // KI-Assistent (Button unten links)
    const assistant = new Assistant(worldViewer, layerManager, ui);
    ui.assistant = assistant;

    const timeline = new Timeline();
    timeline.onReset = async () => {
        // Simulation zurücksetzen: alle Layer neu laden
        ui.hideObjectDetails();
        for (const layer of layerManager.getAll()) layer.clear();
        await layerManager.loadAll();
        ui.buildLayerToggles();
        ui.updateFlightStatus(aircraftLayer.getStatus());
    };

    /* Klick auf Objekte → Auswahl + Detailpanel */
    worldViewer.onObjectPicked = (entity) => {
        if (cockpit.active) return;      // im Cockpit wird nicht ausgewählt
        if (entity && entity.worldViewerObject) {
            ui.selectEntity(entity, { fly: false });
            // Bahnring des ausgewählten Satelliten zeichnen
            if (entity.worldViewerObject.type === "satellite") {
                satelliteLayer.showOrbit(entity.worldViewerObject);
            } else {
                satelliteLayer.hideOrbit();
            }
        } else {
            ui.hideObjectDetails();
            satelliteLayer.hideOrbit();
        }
    };

    /* Escape verlässt die Cockpit-Ansicht */
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && cockpit.active) {
            e.preventDefault();
            cockpit.exit();
        }
    });

    /* Kamera bewegt → Flugzeuge für den neuen Ausschnitt nachladen.
       Der Layer selbst drosselt die Anfragen, zusätzlich cacht der Server. */
    worldViewer.camera.moveEnd.addEventListener(() => {
        aircraftLayer.refreshLive();
    });

    /* 4 ── Zentrale Update-Schleife */
    let lastFrame = performance.now();
    let lastPanelRefresh = 0;
    let lastCoordsUpdate = 0;
    let lastStatusUpdate = 0;

    function updateWorld(now) {
        const realDelta = Math.min((now - lastFrame) / 1000, 0.5); // Tab-Wechsel abfedern
        lastFrame = now;

        // Simulationszeit weiterschalten (0 wenn pausiert)
        const simDelta = timeline.tick(realDelta);

        // Layer aktualisieren. Live-Daten bewegen sich in ECHTER Zeit,
        // die Simulation (Schiffe, Satelliten, Demo-Flugzeuge) im Zeitraffer.
        // Pause hält beides an.
        if (simDelta > 0) {
            layerManager.update(simDelta, realDelta);
        }

        // Detailpanel gedrosselt aktualisieren (2×/Sekunde reicht)
        if (simDelta > 0 && now - lastPanelRefresh > 500) {
            ui.refreshDetailsIfOpen();
            lastPanelRefresh = now;
        }

        // Kamera-Koordinaten in der Statuszeile (4×/Sekunde)
        if (now - lastCoordsUpdate > 250) {
            ui.updateCameraCoords();
            lastCoordsUpdate = now;
        }

        // "vor N Sekunden aktualisiert" mitlaufen lassen
        if (now - lastStatusUpdate > 2000) {
            ui.updateFlightStatus(aircraftLayer.getStatus());
            lastStatusUpdate = now;
        }

        requestAnimationFrame(updateWorld);
    }
    requestAnimationFrame(updateWorld);

    /* Ladeanzeige ausblenden */
    const overlay = document.getElementById("loading-overlay");
    overlay.classList.add("fade");
    setTimeout(() => overlay.remove(), 600);

    console.info("World Viewer bereit. 🌍");
}

main().catch((err) => {
    console.error("World Viewer konnte nicht gestartet werden:", err);
    const overlay = document.getElementById("loading-overlay");
    if (overlay) {
        overlay.innerHTML = `<p style="color:#f87171;max-width:420px;text-align:center">
            Fehler beim Start: ${err.message}<br><br>
            Bitte die Seite über einen lokalen Webserver öffnen
            (z.B. <code>node server/server.mjs</code>) –
            nicht direkt als Datei.</p>`;
    }
});
