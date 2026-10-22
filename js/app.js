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
import { HistoryReplay } from "./historyReplay.js";
import { Assistant } from "./ai/assistant.js";
import { Watchlist } from "./watchlist.js";
import { WatchlistPanel } from "./watchlistPanel.js";
import { AnomalyAlerts } from "./anomalyAlerts.js";
import { DrawTools } from "./drawTools.js";
import { DrawToolsPanel } from "./drawToolsPanel.js";
import { RouteTool } from "./routeTool.js";
import { DeepSpacePanel } from "./deepSpace.js";
import { PanelDock } from "./panelDock.js";
import { StreetLevelPanel } from "./streetLevelPanel.js";

import { KeyStatusPanel } from "./keyStatusPanel.js";
import { SceneDirector } from "./sceneDirector.js";
import { SceneDirectorPanel } from "./sceneDirectorPanel.js";
import { ContactsRoster } from "./contactsRoster.js";
import { ContactsPanel } from "./contactsPanel.js";

import { CockpitView } from "./cockpit.js";
import { applyShareLinkFromUrl, buildShareUrl } from "./shareLink.js";
import { SensorStyles } from "./sensorStyles.js";
import { TacticalHUD } from "./hud.js";
import { KeyboardShortcuts } from "./keyboardShortcuts.js";
import { KeyboardReference } from "./keyboardReference.js";
import { FpsCounter } from "./fpsCounter.js";

import { AircraftLayer } from "./layers/AircraftLayer.js";
import { ShipLayer } from "./layers/ShipLayer.js";
import { SatelliteLayer } from "./layers/SatelliteLayer.js";
import { CameraLayer } from "./layers/CameraLayer.js";
import { AllskyLayer } from "./layers/AllskyLayer.js";
import { ALPRLayer } from "./layers/ALPRLayer.js";
import { InfrastructureLayer } from "./layers/InfrastructureLayer.js";
import { EarthquakeLayer } from "./layers/EarthquakeLayer.js";
import { VolcanoLayer } from "./layers/VolcanoLayer.js";
import { CycloneLayer } from "./layers/CycloneLayer.js";
import { LaunchLayer } from "./layers/LaunchLayer.js";
import { AsteroidLayer } from "./layers/AsteroidLayer.js";
import { CometLayer } from "./layers/CometLayer.js";
import { FireLayer } from "./layers/FireLayer.js";
import { RadioLayer } from "./layers/RadioLayer.js";
import { CableLayer } from "./layers/CableLayer.js";
import { AQILayer } from "./layers/AQILayer.js";
import { WeatherLayer } from "./layers/WeatherLayer.js";
import { GoesCloudLayer } from "./layers/GoesCloudLayer.js";
import { WorldWeatherLayer } from "./layers/WorldWeatherLayer.js";
import { HeatmapLayer } from "./layers/HeatmapLayer.js";
import { FuelReserveLayer } from "./layers/FuelReserveLayer.js";
import { EventLayer } from "./layers/EventLayer.js";
import { SpaceWeatherLayer } from "./layers/SpaceWeatherLayer.js";
import { TransitLayer } from "./layers/TransitLayer.js";
import { BikeShareLayer } from "./layers/BikeShareLayer.js";
import { StreetLevelLayer } from "./layers/StreetLevelLayer.js";
import { TrafficLayer } from "./layers/TrafficLayer.js";
import { RadiationLayer } from "./layers/RadiationLayer.js";

async function main() {
    /* 1 ── 3D-Globus mit Satellitenansicht */
    const worldViewer = new WorldViewer("cesiumContainer");
    await worldViewer.init();

    /* 2 ── Layer */
    const layerManager = new LayerManager();
    const aircraftLayer = new AircraftLayer(worldViewer);
    // Militärflüge (WEB-90): eigener Layer, bernsteinfarben, weltweiter
    // adsb.lol-Feed ohne Bounding-Box und ohne Demo-Rückfall. dedupeAgainst
    // verhindert, dass ein Flugzeug, das in beiden Feeds steckt, doppelt
    // gezeichnet wird.
    const militaryAircraftLayer = new AircraftLayer(worldViewer, {
        id: "militaryAircraft",
        name: "Militärflüge",
        icon: "🎖️",
        color: "#fbbf24",
        configKey: "militaryFlights",
        allowDemo: false,
        boundsInQuery: false,
        dedupeAgainst: aircraftLayer
    });
    const shipLayer = new ShipLayer(worldViewer);
    const satelliteLayer = new SatelliteLayer(worldViewer);
    const alprLayer = new ALPRLayer(worldViewer);

    layerManager.register(aircraftLayer);
    layerManager.register(militaryAircraftLayer);
    layerManager.register(shipLayer);
    layerManager.register(satelliteLayer);
    layerManager.register(new CameraLayer(worldViewer));
    layerManager.register(new AllskyLayer(worldViewer));
    layerManager.register(alprLayer);
    layerManager.register(new InfrastructureLayer(worldViewer));
    layerManager.register(new CableLayer(worldViewer));
    layerManager.register(new EarthquakeLayer(worldViewer));
    layerManager.register(new VolcanoLayer(worldViewer));
    layerManager.register(new CycloneLayer(worldViewer));
    layerManager.register(new LaunchLayer(worldViewer));
    layerManager.register(new AsteroidLayer(worldViewer));
    layerManager.register(new CometLayer(worldViewer));
    layerManager.register(new FireLayer(worldViewer));
    layerManager.register(new RadioLayer(worldViewer));
    layerManager.register(new AQILayer(worldViewer));
    layerManager.register(new RadiationLayer(worldViewer));
    layerManager.register(new WeatherLayer(worldViewer));
    layerManager.register(new GoesCloudLayer(worldViewer));
    layerManager.register(new WorldWeatherLayer(worldViewer));
    layerManager.register(new FuelReserveLayer(worldViewer));
    layerManager.register(new EventLayer(worldViewer));
    layerManager.register(new HeatmapLayer(worldViewer, layerManager));
    const spaceWeatherLayer = new SpaceWeatherLayer(worldViewer);
    layerManager.register(spaceWeatherLayer);
    layerManager.register(new TransitLayer(worldViewer));
    layerManager.register(new BikeShareLayer(worldViewer));
    layerManager.register(new TrafficLayer(worldViewer));
    const streetLevelLayer = new StreetLevelLayer(worldViewer);
    layerManager.register(streetLevelLayer);

    /* 3 ── UI, Suche, Timeline, KI */
    // Zentrale Tastenkürzel-Verwaltung: eine Stelle statt verstreuter
    // keydown-Handler (WEB-88). Wird an Module weitergegeben, die eigene
    // Kürzel oder einen Schritt der Esc-Kette beitragen.
    const shortcuts = new KeyboardShortcuts();
    new KeyboardReference(shortcuts);

    const ui = new UI(worldViewer, layerManager, shortcuts);
    ui.aircraftLayer = aircraftLayer;
    ui.buildBasemapSwitcher();

    // Statusanzeige der Flugdaten aktuell halten
    aircraftLayer.onStatusChange((status) => ui.updateFlightStatus(status));

    // Kp-Index/Sonnenwind-Kennzahlen in der Sidebar aktuell halten (WEB-68)
    spaceWeatherLayer.onStatusChange((status) => ui.updateSpaceWeatherStatus(status));

    await layerManager.loadAll();
    await applyShareLinkFromUrl(worldViewer, layerManager);
    ui.buildLayerToggles();
    ui.updateFlightStatus(aircraftLayer.getStatus());
    ui.updateSpaceWeatherStatus(spaceWeatherLayer.getStatus());
    ui.buildShareUrl = () => buildShareUrl(worldViewer, layerManager);

    new Search(worldViewer, layerManager, ui);

    /* Beobachtungszonen: Geofence-Alarme auf Basis der bereits geladenen
       öffentlichen Live-Positionen (Flugzeuge, Schiffe, ...) */
    const watchlist = new Watchlist(worldViewer, layerManager);

    /* Anomalie-Alarme: Notfall-Squawk (7500/7600/7700) und auffällige
       AIS-Muster (Stopp, Positionssprung) – zweite Alarmkategorie im
       selben Panel, ebenfalls ohne neue Datenquelle (WEB-54) */
    const anomalyAlerts = new AnomalyAlerts(layerManager);

    new WatchlistPanel(watchlist, worldViewer, ui, anomalyAlerts);

    /* Kontakte-Liste: alle Objekte aktiver Layer im Radius um das
       Kamerazentrum, nach Entfernung sortiert (WEB-91). Klick auf eine
       Zeile nutzt die Auswahl-/Tracking-Logik von ui.js (ui.selectEntity). */
    const contactsRoster = new ContactsRoster(worldViewer, layerManager);
    const contactsPanel = new ContactsPanel(contactsRoster, ui);

    /* Zeichnen & Messen: Freihand/Grenzen/Punkte zeichnen, Distanzen messen;
       Route Fuß/Rad/Auto über den öffentlichen OSRM-Demo-Server (WEB-71) */
    const drawTools = new DrawTools(worldViewer);
    const routeTool = new RouteTool(worldViewer);
    new DrawToolsPanel(drawTools, routeTool, ui, shortcuts);

    /* Szenen-Regisseur: Kamerafahrten aufnehmen/abspielen, Flythrough
       entlang der oben geplanten Route als Spezialfall (WEB-92) */
    const sceneDirector = new SceneDirector(worldViewer);
    new SceneDirectorPanel(sceneDirector, routeTool);

    /* Cockpit-Ansicht: mit der Kamera im Flugzeug mitfliegen */
    const cockpit = new CockpitView(worldViewer, ui);
    ui.cockpit = cockpit;
    cockpit.onStateChange = (active) => ui.setCockpitActive(active);

    // KI-Assistent (Button unten links)
    const assistant = new Assistant(worldViewer, layerManager, ui, shortcuts);
    ui.assistant = assistant;

    /* Andockbare Panel-Rail rechts: Detail-, Graph- und KI-Panel verschieb-
       und skalierbar machen, Position/Größe merken, beim Öffnen stapeln
       statt überdecken (WEB-86). Unterhalb von 821px bleibt pro Panel
       das bisherige Vollbild-Verhalten (siehe panelDock.js). */
    const panelDock = new PanelDock("#panel-rail-right");
    panelDock.register({
        id: "detail",
        el: document.getElementById("detail-panel"),
        header: document.getElementById("detail-header"),
        minWidth: 260, minHeight: 200,
        close: () => ui.hideObjectDetails()
    });
    panelDock.register({
        id: "graph",
        el: document.getElementById("graph-panel"),
        header: document.getElementById("graph-header"),
        minWidth: 280, minHeight: 240,
        close: () => ui.closeGraphView()
    });
    panelDock.register({
        id: "ai",
        el: document.getElementById("ai-panel"),
        header: document.getElementById("ai-header"),
        minWidth: 280, minHeight: 240,
        close: () => assistant.close()
    });
    panelDock.register({
        id: "contacts",
        el: document.getElementById("contacts-panel"),
        header: document.getElementById("contacts-header"),
        minWidth: 240, minHeight: 200,
        close: () => contactsPanel.hide()
    });

    /* Street-Level (Mapillary): Abdeckungslinien + Bildkegel, eingebetteter
       Betrachter im Panel rechts (WEB-95). Ohne MAPILLARY_TOKEN bleibt der
       Layer leer (siehe StreetLevelLayer.statusText()); das Panel öffnet sich
       dann schlicht nie, weil keine Bildkegel zum Anklicken entstehen. */
    const streetLevelPanel = new StreetLevelPanel(streetLevelLayer);
    panelDock.register({
        id: "streetlevel",
        el: document.getElementById("streetlevel-panel"),
        header: document.getElementById("streetlevel-header"),
        minWidth: 300, minHeight: 280,
        close: () => streetLevelPanel.close()
    });

    panelDock.applySavedOrder();

    // POWER-UP: Schlüssel & Dienste (Chip unten rechts, WEB-87)
    ui.keyPanel = new KeyStatusPanel(ui);

    /* Sensor-Stile (CRT/NVG/FLIR/Noir/Schnee/HUD) über CSS-Filter */
    const sensorStyles = new SensorStyles(worldViewer);
    ui.sensorStyles = sensorStyles;

    /* Taktisches HUD: Ziel-Boxen (Taste D, "Erkennung") + Eckmarken/Statuszeile
       (Taste H, "HUD") über dem Viewport. Der Sensor-Stil "Tactical HUD"
       (Taste 7) schaltet komfortabel beide zusammen. */
    const tacticalHud = new TacticalHUD(worldViewer, layerManager);

    /* FPS-Zähler, Taste ` (Backtick) */
    const fpsCounter = new FpsCounter();

    sensorStyles.onChange = (key, label) => {
        tacticalHud.setActive(key === "hud");
        const btn = document.getElementById("btn-sensor-style");
        if (!btn) return;
        btn.textContent = `🎛️ ${label}`;
        btn.classList.toggle("active", key !== "normal");
    };

    /* ── Zentrale Tastenkürzel: 1–7 Sensorstile, H HUD, D Erkennung,
       C Cockpit, ` FPS-Zähler (Parität zu "God's Eye View", WEB-88) ── */
    for (let digit = 1; digit <= 7; digit++) {
        shortcuts.register({
            key: String(digit),
            label: `Sensorstil „${digit}" wählen`,
            category: "Sensorstile (1–7)",
            handler: () => sensorStyles.applyByDigit(digit)
        });
    }

    shortcuts.register({
        key: "h",
        label: "Tactical-HUD-Rahmen (Eckmarken + Statuszeile) ein/aus",
        category: "Overlays",
        handler: () => tacticalHud.setHudActive(!tacticalHud.hudActive)
    });

    shortcuts.register({
        key: "d",
        label: "Erkennungs-Overlay (Ziel-Boxen + Telemetrie) ein/aus",
        category: "Overlays",
        handler: () => tacticalHud.setDetectionActive(!tacticalHud.detectionActive)
    });

    shortcuts.register({
        key: "c",
        label: "Cockpit-Ansicht für das ausgewählte Flugzeug ein/aus",
        category: "Ansicht",
        handler: () => {
            if (cockpit.active) { cockpit.exit(); return; }
            const entity = ui.selectedObject && layerManager.findEntityById(ui.selectedObject.id);
            if (!entity) return;
            if (!cockpit.enter(entity)) {
                alert("In dieses Flugzeug kann gerade nicht eingestiegen werden.");
            }
        }
    });

    shortcuts.register({
        key: "`",
        label: "FPS-Zähler ein/aus",
        category: "Ansicht",
        handler: () => fpsCounter.toggle()
    });

    /* ── Esc-Kette: Panel schließen (10er) → Verfolgen beenden (20er) →
       Cockpit verlassen (30er). Der erste zutreffende Schritt gewinnt. ── */
    shortcuts.registerEscapeStep(20, () => {
        if (!worldViewer.followedEntity) return false;
        worldViewer.stopFollowing();
        return true;
    });
    shortcuts.registerEscapeStep(30, () => {
        if (!cockpit.active) return false;
        cockpit.exit();
        return true;
    });

    const timeline = new Timeline();
    timeline.onReset = async () => {
        // Simulation zurücksetzen: alle Layer neu laden
        ui.hideObjectDetails();
        for (const layer of layerManager.getAll()) layer.clear();
        await layerManager.loadAll();
        ui.buildLayerToggles();
        ui.updateFlightStatus(aircraftLayer.getStatus());
        ui.updateSpaceWeatherStatus(spaceWeatherLayer.getStatus());
    };

    /* Zeitleisten-Replay: historische Erdbeben/Brände/Starts abspielen
       (Play/Pause/Scrub), unabhängig vom Zeitraffer der Simulation oben */
    const historyReplay = new HistoryReplay(worldViewer, layerManager, ui);

    /* Deep-Space-Missionen (Voyager, New Horizons, JWST, Parker Solar Probe,
       Juno): echte Ephemeriden aus NASA/JPL Horizons. Kein Globus-Layer,
       sondern eine eigene kompakte Ansicht in der Sidebar – die Distanzen
       (bis 172 AE) sprengen jeden Globusmaßstab (WEB-79) */
    new DeepSpacePanel().start();

    /* Klick auf Objekte → Auswahl + Detailpanel */
    worldViewer.onObjectPicked = (entity) => {
        if (cockpit.active) return;      // im Cockpit wird nicht ausgewählt

        // Street-Level-Bildkegel öffnen das eigene Rail-Panel (Betrachter +
        // Filter) statt des generischen Detailpanels (WEB-95)
        if (entity?.streetLevelImage) {
            streetLevelPanel.openImage(entity.streetLevelImage);
            return;
        }

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

    /* Kamera bewegt → Flugzeuge für den neuen Ausschnitt nachladen.
       Der Layer selbst drosselt die Anfragen, zusätzlich cacht der Server. */
    worldViewer.camera.moveEnd.addEventListener(() => {
        aircraftLayer.refreshLive();
        militaryAircraftLayer.refreshLive();
        shipLayer.refreshLive();
        alprLayer.refresh();
        streetLevelLayer.refreshForView();
    });

    /* 4 ── Zentrale Update-Schleife */
    let lastFrame = performance.now();
    let lastPanelRefresh = 0;
    let lastCoordsUpdate = 0;
    let lastStatusUpdate = 0;
    let lastWatchlistCheck = 0;

    function updateWorld(now) {
        const realDelta = Math.min((now - lastFrame) / 1000, 0.5); // Tab-Wechsel abfedern
        lastFrame = now;

        // Simulationszeit weiterschalten (0 wenn pausiert)
        const simDelta = timeline.tick(realDelta);

        // Zeitleisten-Replay: historische Ereignisse nach Scrubber-Position einblenden
        historyReplay.tick(realDelta);

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

        // Taktisches HUD neu zeichnen (nur wenn aktiv, siehe TacticalHUD.update)
        tacticalHud.update(ui.selectedObject?.id ?? null);

        // FPS-Zähler (nur wenn eingeblendet, siehe FpsCounter.tick)
        fpsCounter.tick(now);

        // "vor N Sekunden aktualisiert" mitlaufen lassen
        if (now - lastStatusUpdate > 2000) {
            ui.updateFlightStatus(aircraftLayer.getStatus());
            ui.refreshLayerCounts();
            lastStatusUpdate = now;
        }

        // Beobachtungszonen auf Ein-/Austritte sowie Notfall-Squawk/AIS-
        // Auffälligkeiten prüfen (gedrosselt)
        if (now - lastWatchlistCheck > 2000) {
            watchlist.check();
            anomalyAlerts.check();
            lastWatchlistCheck = now;
        }

        // Kontakte-Liste: drosselt sich selbst, wenn sichtbar (siehe
        // ContactsPanel.refresh) – kein voller Listen-Rebuild pro Frame.
        contactsPanel.refresh(false, now);

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
