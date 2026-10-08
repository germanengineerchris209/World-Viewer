/**
 * World Viewer – Konfiguration
 * ─────────────────────────────────────────────────────────────
 * Diese Datei wird VOR der App geladen und stellt alle
 * Einstellungen global bereit.
 *
 * ⚠️  Diese Datei nicht in ein öffentliches Git-Repository
 *     einchecken, sobald echte Keys eingetragen sind!
 *
 * Die App läuft komplett OHNE Keys:
 *   • Satellitenansicht: Esri World Imagery (frei, kein Key)
 *   • Objektbilder:      Wikipedia (frei, kein Key)
 *   • Ortsnamen:         OpenStreetMap/Nominatim (frei, kein Key)
 * Keys verbessern nur einzelne Zusatzfunktionen.
 */
window.WORLD_VIEWER_CONFIG = {

    /* ═══════════ Karten & Gelände ═══════════ */

    // Beim Start aktive Kartenansicht:
    // "satellite" | "hybrid" | "streets" | "terrain"
    defaultBasemap: "hybrid",

    // Cesium Ion Access Token
    // Bringt: echtes 3D-Gelände (Berge), weltweite OSM-3D-Gebäude und
    // die zusätzliche Kartenansicht "Bing (Ion)".
    //
    // Dieser Token gehört bewusst in den Browser – Cesium ist darauf
    // ausgelegt. Er ist an die Audience "World Viewer" gebunden.
    // Wird er einmal öffentlich gehostet: in ion.cesium.com den Token
    // auf die eigene Domain beschränken.
    cesiumIonToken: "",

    // Google Maps API Key – OPTIONAL
    // Bringt: fotorealistische 3D-Gebäude (Google-Earth-Optik)
    // Google Cloud Console → "Map Tiles API" aktivieren → Key erstellen
    googleMapsApiKey: "",

    // Google-3D-Tiles automatisch laden, sobald ein Key vorhanden ist
    useGooglePhotorealistic: true,


    /* ═══════════ KI-Assistent (Claude API) ═══════════ */

    ai: {
        // "proxy"  = sicher: Key liegt auf dem Server (server/claude-proxy.mjs)
        // "direct" = bequem: Browser ruft die API direkt auf (Key im Browser!)
        mode: "proxy",

        // Bei mode "proxy": Adresse des eigenen Endpunkts
        proxyUrl: "/api/chat",

        // Bei mode "direct": Anthropic-API-Key.
        // Leer lassen und den Key stattdessen im Chatfenster eintragen –
        // dann liegt er nur lokal im Browser und nicht in dieser Datei.
        apiKey: "",

        // Verfügbare Modelle: claude-sonnet-5 (empfohlen),
        // claude-opus-5 (stärker), claude-haiku-4-5-20251001 (schnell/günstig)
        model: "claude-sonnet-5",

        maxTokens: 1024
    },


    /* ═══════════ Sprachein- und -ausgabe ═══════════ */

    voice: {
        // Sprache für Diktat und Vorlesen
        language: "de-DE",

        // Antworten automatisch vorlesen (auch im Chatfenster umschaltbar)
        speakByDefault: false,

        // Freisprechen: Nach dem Vorlesen automatisch wieder zuhören.
        // Bequem, verbraucht aber laufend Anfragen – deshalb standardmäßig aus.
        handsFree: false,

        // Diktiertes sofort abschicken (sonst landet es nur im Eingabefeld)
        autoSend: true,

        // Stimme: leer = automatisch passend zur Sprache.
        // Verfügbare Namen in der Browserkonsole:
        //   speechSynthesis.getVoices().map(v => v.name)
        voiceName: "",

        rate: 1.05,     // Sprechtempo (0.5–2)
        pitch: 1.0,     // Tonhöhe
        volume: 1.0     // Lautstärke
    },


    /* ═══════════ Live-Flugdaten ═══════════ */

    flights: {
        // "auto" = Live-Daten nutzen, wenn der Server sie liefert,
        //          sonst automatisch die Demo-Daten
        // "demo" = immer die Beispieldaten aus data/aircraft.json
        mode: "auto",

        // Endpunkt des eigenen Servers (server/server.mjs).
        // Der Anbieter (Flightradar24 oder OpenSky) wird DORT eingestellt –
        // über Umgebungsvariablen, damit keine Zugangsdaten im Browser landen.
        apiUrl: "/api/flights",

        // Wie oft neue Positionen geholt werden (Sekunden).
        // Achtung: Bei Flightradar24 kostet jeder Abruf Guthaben.
        refreshSeconds: 20,

        // Mindestabstand zwischen zwei Anfragen beim Kameraschwenken
        minRequestGapSeconds: 3,

        // Größter abgefragter Kartenausschnitt in Grad.
        // DAS ist die eigentliche Bremse: Auch in der Weltansicht wird
        // nur ein Kasten dieser Größe um den Blickpunkt abgefragt –
        // niemals die ganze Erde.
        maxSpanDegrees: 40,

        // Ab dieser Kamerahöhe werden gar keine Live-Daten mehr geholt
        maxHeightKm: 30000,

        // Obergrenze für gleichzeitig dargestellte Flugzeuge
        maxAircraft: 400,

        // Flugzeug entfernen, wenn es so lange nicht mehr geliefert wurde
        removeAfterSeconds: 75,

        // Quelle für den Demo-Betrieb
        demoUrl: "./data/aircraft.json"
    },


    /* ═══════════ Live-Schiffsdaten (AIS) ═══════════ */

    ships: {
        // "auto" = Live-AIS-Daten nutzen, wenn der Server einen
        //          AISSTREAM_API_KEY hat, sonst automatisch die Demo-Daten
        // "demo" = immer die Beispieldaten aus data/ships.json
        mode: "auto",

        // Endpunkt des eigenen Servers (server/server.mjs). Der hält die
        // eigentliche WebSocket-Verbindung zu AISStream.io.
        apiUrl: "/api/ships",

        // Wie oft neue Positionen geholt werden (Sekunden)
        refreshSeconds: 15,

        // Mindestabstand zwischen zwei Anfragen beim Kameraschwenken
        minRequestGapSeconds: 3,

        // Größter abgefragter Kartenausschnitt in Grad
        maxSpanDegrees: 60,

        // Ab dieser Kamerahöhe werden gar keine Live-Daten mehr geholt
        maxHeightKm: 30000,

        // Obergrenze für gleichzeitig dargestellte Schiffe
        maxShips: 600,

        // Schiff entfernen, wenn es so lange nicht mehr gemeldet wurde
        // (AIS-Meldungen kommen unregelmäßig – deshalb großzügig)
        removeAfterSeconds: 1200,

        // Quelle für den Demo-Betrieb
        demoUrl: "./data/ships.json"
    },


    /* ═══════════ Satelliten, Erdbeben, Starts, Brände ═══════════ */

    satellites: {
        // "auto" = echte Bahndaten (TLE) über den Server, sonst Beispieldaten
        mode: "auto",
        // Welche CelesTrak-Gruppen geladen werden.
        // "starlink" ist möglich, bringt aber tausende Objekte.
        groups: ["stations", "visual", "gps-ops", "galileo", "geo"],
        // Obergrenze je Gruppe – hält die Karte lesbar
        maxPerGroup: 60
    },

    earthquakes: {
        minMagnitude: 2.5,      // schwächere Beben ausblenden
        refreshSeconds: 300
    },

    volcanoes: {
        // Ampel aus Smithsonian GVP + amtlichen USGS-Warnstufen.
        // Warnstufen werden im Tagesrhythmus herausgegeben, häufigeres
        // Abrufen bringt nichts. Ohne laufenden Server greift der Layer
        // auf data/volcanoes.json zurück.
        refreshSeconds: 3600,
        maxVolcanoes: 600       // aktive Vulkane werden zuerst gezeichnet
    },

    launches: {
        apiUrl: "/api/launches",
        refreshSeconds: 900
    },

    asteroids: {
        // Erdnahe Asteroiden der nächsten 7 Tage, NASA NeoWs. Läuft ohne
        // eigenen Key mit DEMO_KEY (serverseitig, siehe .env.example).
        apiUrl: "/api/asteroids",
        refreshSeconds: 3600    // NeoWs-Feed ändert sich nur täglich
    },

    cyclones: {
        // Aktive tropische Wirbelstürme, NOAA National Hurricane Center.
        // Zuständig nur für Atlantik/Ost-/Zentralpazifik. Außerhalb der
        // Hurrikansaison (meist) leer – das zeigt die Sidebar klar an.
        apiUrl: "/api/storms",
        refreshSeconds: 1200    // 20 Min., siehe NHC-Aktualisierungsrhythmus
    },

    fires: {
        apiUrl: "/api/fires",
        refreshSeconds: 900,
        maxFires: 1500          // weltweit können es zehntausende sein
    },

    events: {
        // GDELT Project GEO 2.0 API – frei, kein Key. Server-Proxy, weil
        // GDELT keine CORS-Header sendet. GDELT selbst aktualisiert seine
        // Kartendaten alle 15 Minuten, öfter abfragen bringt nichts.
        apiUrl: "/api/events",
        refreshSeconds: 900,
        maxEvents: 800
    },

    // Zeitleisten-Replay: dieselben Quellen wie oben, nur über die
    // "history"-Endpunkte (7-/30-Tage-Feeds statt nur "aktuell")
    history: {
        defaultRangeDays: 7,
        fires: { apiUrl: "/api/fires/history", maxFires: 4000 },
        launches: { apiUrl: "/api/launches/history" }
    },

    radio: {
        // Radio Browser API – frei, kein Key. Die Mirrors rotieren per
        // DNS; "all.api.radio-browser.info" reicht als fester Einstieg.
        apiUrl: "https://all.api.radio-browser.info/json/stations/search",
        userAgent: "WorldViewer/1.0",
        limit: 300,           // Sender mit Geo-Koordinaten, nach Beliebtheit
        order: "votes"
    },

    aqi: {
        // Open-Meteo Air Quality API – frei, kein Key für nicht-kommerzielle
        // Nutzung. Städteliste liegt in data/aqi-locations.json; alle
        // Koordinaten werden in EINER Anfrage abgefragt (kommaseparierte
        // Listen). Aktualisiert sich stündlich, öfter abfragen bringt nichts.
        apiUrl: "https://air-quality-api.open-meteo.com/v1/air-quality",
        refreshSeconds: 1800
    },

    weather: {
        // Open-Meteo Forecast API – dieselbe Quelle wie der AQI-Layer,
        // frei, kein Key für nicht-kommerzielle Nutzung. Städteliste liegt
        // in data/weather-locations.json, alle Koordinaten werden in EINER
        // Anfrage abgefragt (kommaseparierte Listen).
        apiUrl: "https://api.open-meteo.com/v1/forecast",
        refreshSeconds: 900
    },

    heatmap: {
        // Pattern-of-Life-Heatmap: reine Weiterverarbeitung der bereits
        // geladenen Live-Positionen von Aircraft/Ships, keine neue Quelle.
        windowMinutes: 30,        // rollierendes Zeitfenster für Stichproben
        sampleIntervalSeconds: 15, // wie oft Positionen ins Fenster übernommen werden
        rebuildSeconds: 5,        // wie oft das Gitter neu gezeichnet wird
        gridCells: 24             // Gitterauflösung (Zellen je Achse)
    },

    spaceWeather: {
        // NOAA Space Weather Prediction Center – öffentliche US-Regierungsdaten
        // (public domain), kein Key, CORS gesetzt (per curl verifiziert, WEB-68).
        refreshSeconds: 600
    },


    /* ═══════════ Kameras ═══════════ */

    cameras: {
        // Öffentliche Verkehrskamera-Kataloge (TfL London, Caltrans,
        // City of Austin) über den Server mitladen – mehrere hundert
        // Kameras, die sich selbst aktuell halten.
        usePublicCatalog: true,
        catalogUrl: "/api/cctv",

        // Viele Webcam-Betreiber sperren fremde Seiten aus (Hotlink-Schutz
        // oder fehlende CORS-Header). Läuft der mitgelieferte Server, holt
        // er das Bild stattdessen serverseitig und setzt einen passenden
        // Referer. Die App versucht immer ZUERST den direkten Weg und
        // schaltet nur bei einem Fehler automatisch auf den Proxy um.
        useProxy: true,
        proxyUrl: "/api/camera"
    },


    /* ═══════════ Objektbilder ═══════════ */

    images: {
        // Fotos von Wikipedia laden (sonst nur generierte Illustrationen)
        useWikipedia: true,
        // Sprachreihenfolge für die Bildsuche
        wikipediaLanguages: ["de", "en"],
        // Abbruch, wenn Wikipedia zu lange braucht (ms)
        timeoutMs: 6000
    },


    /* ═══════════ Simulation ═══════════ */

    simulation: {
        defaultSpeed: 10,       // Standard-Zeitraffer
        updateIntervalMs: 100   // Takt der Positionsberechnung
    }
};
