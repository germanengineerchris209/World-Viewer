# Vergleich mit „God's Eye View" & Verbesserungsvorschläge

Stand: 05.11.2026 (WEB-164) · Referenzprojekt: [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT-Lizenz)

Dieses Dokument vergleicht den **Stand von ARGUS (`origin/main`, Commit
`7552fe6`)** mit dem **Stand von God's Eye View (GEV) `main`**
(README-Stand Oktober 2026).

**Was sich seit der Fassung vom 12.10.2026 geändert hat:** Tier 2 ist
abgeschlossen – ÖPNV (WEB-94), Verkehr (WEB-93), Satelliten-Katalogtiefe
(WEB-89) und Infrastruktur in Masse (WEB-142) sind gemerged, ebenso die
damals noch offenen Branches Regenradar (WEB-67), Leihräder (WEB-70) und
Kamera-Sichtfeld (WEB-72). Aus Tier 3 sind Szenen-Regisseur,
3D-Flugzeugmodelle und Militärflüge (WEB-90) fertig. Street-Level (WEB-95)
und ALPR-Standorte (WEB-99) sind dazugekommen – letzteres ist eine
**Revision einer früheren Entscheidung**, siehe Abschnitt 5.

**Damit sind die Feature-Lücken gegenüber GEV bis auf drei Punkte
geschlossen:** Militär-Standorte, Blitzdichte (WEB-131) und alles
Sprachgesteuerte (Tier 3, Freigabe offen).

Zusätzlich hat ARGUS mehrere Layer, die **GEV gar nicht kennt**
(Asteroiden, Kometen, Tiefraum-Sonden, Weltraumschrott, Weltraumwetter,
Vulkane, Luftqualität, Kraftstoffreserven, Lage/GDELT, Pattern-of-Life,
Link-Analyse, Strahlungsmessnetz, Tsunami-Warnungen) – siehe Abschnitt 4.

> **Lesehinweis:** Alle Aussagen beziehen sich auf **`origin/main`**, den
> tatsächlich gemergten Stand. Der lokale Checkout dieses Arbeitsbaums
> wird von mehreren Agenten parallel genutzt und liegt regelmäßig hinter
> `origin/main`; er ist als Grundlage für diesen Vergleich nicht geeignet.

## 1. Architektur im Vergleich

| | ARGUS (World Viewer) | God's Eye View |
|---|---|---|
| Frontend | Vanilla JS (ES6-Module), kein Build-Schritt, CesiumJS via CDN | Vanilla JS + **Vite**-Build, CesiumJS + Google Photorealistic 3D Tiles |
| Node | 18+, keine npm-Pakete im Projekt | 24.x/26.x erforderlich, npm-Paket-Set |
| Server | ein Proxy-Server für Schlüssel/CORS, SSRF-Schutz für Kamera- und sonstige Proxys | gehärteter Proxy mit SSRF-Schutz, Antwortgrößen-Limits, Ratenbegrenzung pro IP |
| KI | Claude-Text-Chat (Anthropic API, serverseitig per Proxy), Diktat/Vorlesen über Browser Web-Speech-API | OpenAI Realtime API – Sprachgespräch, 30+ Voice-Tools, Kamera-Regie per Sprache, KI-HUD-Kurzfassung |
| Installationswege | `python3 -m http.server` + optional `node server/server.mjs` | `npm ci && npm run doctor && npm run dev`, alternativ Pinokio-Installer |
| Doku-Prozess | Markdown-Dateien im Root (`DOKUMENTATION.md`, `DATENQUELLEN.md`, `DEPLOYMENT.md`) + `docs/`-Ordner für Task-Dossiers | `docs/`-Ordner + `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `TESTING.md`, CI-Workflow |

**Bewertung unverändert:** Der fehlende Build-Schritt ist eine bewusste
Stärke von ARGUS und wird **nicht** aufgegeben (siehe Abschnitt 5).

## 2. Layer/Feature-Gegenüberstellung

Spalten: **Status** (✅ vorhanden / 🟡 teilweise / ❌ fehlt) ·
**Datenquelle** · **Schlüssel** nötig? · **Kostenrisiko** · **Datei(en) in ARGUS**.

### 2.1 Bewegte Objekte

| Feature (GEV) | Status | Datenquelle (ARGUS) | Schlüssel | Kostenrisiko | Datei(en) |
|---|---|---|---|---|---|
| Live-Flugzeuge (GEV: 11.000+, OpenSky+adsb.lol) | 🟡 teilweise | OpenSky, adsb.lol, optional FR24 | optional (mehr Kontingent/FR24) | FR24 kostenpflichtig, Rest kostenlos | `js/layers/AircraftLayer.js`, `js/flightData.js`, `server/flightProviders.mjs` — Begründung: funktional gleich (live, Koppelnavigation), aber Objektzahl clientseitig gedeckelt (keine 11.000 gleichzeitig) |
| Militärflüge amber-markiert | ✅ vorhanden | adsb.lol (weltweiter Mil-Feed) | nein | kostenlos | Eigener Layer `militaryAircraft` (WEB-90): zweite `AircraftLayer`-Instanz in Bernstein `#fbbf24` über `/api/flights/military`, ohne Bounding-Box und ohne Demo-Rückfall, dedupliziert gegen den Zivil-Layer |
| Live-Schiffe (AIS) | ✅ vorhanden | AISStream | ja (kostenlos) | kostenlos | `js/layers/ShipLayer.js`, `js/shipData.js`, `server/aisStream.mjs` |
| Satelliten (GEV: 838-Katalog, SGP4, Orbit-Ringe) | 🟡 teilweise | CelesTrak TLE + `satellite.js` (SGP4) | nein | kostenlos | `js/layers/SatelliteLayer.js` — Begründung: **echte SGP4-Propagation ist seit WEB-31 umgesetzt** (nicht mehr die alte Kreisbahn-Näherung), inkl. eigener Weltraumschrott-Gruppe; live bis zu 5 Gruppen × 60 Objekte (≈300) gegen GEV 838. Nur der **Demo-Fallback** ohne Netz nutzt noch 12 Objekte mit vereinfachter Kreisbahn (`data/satellites.json`) |
| 3D-Flugzeugmodelle je Klasse (787, ATR-72, Citation, Bell 206, MQ-9) | ✅ vorhanden | clientseitig (glTF über CDN) | nein | kostenlos | `js/aircraftModels.js` — dieselben fünf Klassen wie GEV, Glyph→Modell-Wechsel ab Zoomschwelle; alle anderen Typen bleiben Glyph |

### 2.2 Infrastruktur & feste Objekte

| Feature (GEV) | Status | Datenquelle (ARGUS) | Schlüssel | Kostenrisiko | Datei(en) |
|---|---|---|---|---|---|
| Rechenzentren (GEV: 4.351) | ✅ vorhanden | OpenStreetMap via Overpass (ODbL) | nein | kostenlos | `data/datacenters.json` mit **4.813** Objekten (WEB-142), eingecheckt, mit Clustering — damit über GEV-Niveau |
| Staudämme (GEV: 704) | ✅ vorhanden | OpenStreetMap via Overpass (ODbL) | nein | kostenlos | `data/dams.json` mit **16.630** Objekten (WEB-142) — enthält allerdings auch Kleinstwehre, Nachfilterung über Wikidata offen (WEB-151) |
| Unterseekabel (GEV: 712 Trassen) | 🟡 teilweise | handkuratiert + OpenStreetMap (ODbL) | nein | kostenlos | `data/cables.json` (16) + `data/cables-osm.json` (195) = 211 Trassen gegen 712. Bewusst **nicht** TeleGeography, dessen Submarine Cable Map CC BY-NC-SA 3.0 (nicht-kommerziell) ist und nicht zur Lizenzlage des Projekts passt |
| Militär-Standorte (OSM-Community-Mapping) | ❌ fehlt | — | — | — | – (einzige verbleibende Infrastruktur-Lücke gegenüber GEV) |
| ALPR-Kamera-Standorte (OSM-Tags) | ✅ vorhanden | DeFlock/OSM über `/api/alpr` | nein | kostenlos | `js/layers/ALPRLayer.js` (WEB-99) — zeigt **nur Standorte und Gerätetags**, Feld-Whitelist im Server. Die frühere Zurückhaltung wurde revidiert, Begründung in Abschnitt 5 |

### 2.3 Verkehr & Mobilität

| Feature (GEV) | Status | Datenquelle (ARGUS) | Schlüssel | Kostenrisiko | Datei(en) |
|---|---|---|---|---|---|
| Verkehrssimulation (OSM-Fahrzeuge + TomTom-Live-Stauwerte) | ✅ vorhanden | OSM-Simulation, TomTom optional | optional (TomTom) | TomTom mit Tagesbudget gedeckelt (`TOMTOM_DAILY_BUDGET`) | `js/layers/TrafficLayer.js`, `/api/traffic/flow` (WEB-93) |
| ÖPNV live (Bus/Tram/Metro/Fähre, GTFS-Realtime) | ✅ vorhanden | GTFS-Realtime ausgewählter Städte | optional (TfL) | kostenlos | `js/layers/TransitLayer.js`, `/api/transit/` (WEB-94) — Protobuf wird mit eigenem Decoder gelesen (`server/gtfsRealtime.mjs`), um die npm-Freiheit zu halten |
| Leihräder/E-Scooter (GBFS) | ✅ vorhanden | GBFS (9 Systeme handkuratiert) | nein | kostenlos | `js/layers/BikeShareLayer.js`, `data/bikeshare-systems.json` (WEB-70) |
| Routenplanung (Fuß/Rad/Auto) | ✅ vorhanden | OSRM (FOSSGIS-Demo-Server) | nein | kostenlos | `js/routeTool.js`, `js/drawToolsPanel.js` |

### 2.4 Kameras & Beobachtung

| Feature (GEV) | Status | Datenquelle (ARGUS) | Schlüssel | Kostenrisiko | Datei(en) |
|---|---|---|---|---|---|
| CCTV-Mesh (GEV: ~3.900, 11 Regionen) | 🟡 teilweise | TfL London, Caltrans, Austin + eigene Kameras | nein | kostenlos | `js/layers/CameraLayer.js`, `server/dataProxies.mjs`, `server/cameraProxy.mjs` — Begründung: 17 eigene + Katalog-Kameras aus 3 Regionen gegen 11 Regionen/~3.900 bei GEV; Proxy-Härtung (SSRF-Schutz, Allowlist) ist bereits auf GEV-Niveau |
| Allsky-Kameras weltweit | ✅ vorhanden (ARGUS-exklusiv, kein GEV-Äquivalent) | handkuratiert | nein | kostenlos | `js/layers/AllskyLayer.js`, `data/allsky-cameras.json` |
| Street-Level (Mapillary + Viewer + FOLLOW-Modus) | ✅ vorhanden | Mapillary über Server-Proxy | ja (kostenlos) | kostenlos | `js/layers/StreetLevelLayer.js`, `js/streetLevelPanel.js` (WEB-95) — Abdeckungslinien + Bildkegel; der Token geht nie in `config.js`, der Betrachter holt ihn einmalig über `/api/mapillary/token` |
| Kamera-Sichtfeld (Viewshed) | ✅ vorhanden | rein geometrisch, aus Kameraposition/Blickrichtung | nein | kostenlos | `js/cameraViewshed.js` (WEB-72) — Sektor aus `heading`/`fovDegrees`/`rangeMeters`, derzeit bei 3 der 17 Kameras gesetzt. Keine Geländeverschattung |

### 2.5 Ereignisse & Umwelt

| Feature (GEV) | Status | Datenquelle (ARGUS) | Schlüssel | Kostenrisiko | Datei(en) |
|---|---|---|---|---|---|
| Erdbeben (24 h) | ✅ vorhanden | USGS | nein | kostenlos | `js/layers/EarthquakeLayer.js` |
| Aktive Brände (24 h) | ✅ vorhanden | NASA FIRMS | ja (kostenlos) | kostenlos | `js/layers/FireLayer.js` |
| Raketenstarts (30 Tage) | ✅ vorhanden | Launch Library 2 | nein (mehr Kontingent optional) | kostenlos | `js/layers/LaunchLayer.js` |
| Wind (animiertes Vorhersagefeld, NOAA GFS/ECMWF) | 🟡 teilweise | Open-Meteo (Städtepunkte + 15°-Raster) | nein | kostenlos | `js/layers/WeatherLayer.js` (40 kuratierte Städte) und `js/layers/WorldWeatherLayer.js` (flächiges 15°-Gradnetz, 264 Zellen, WEB-102). Weiterhin **kein animiertes Windfeld**: Open-Meteo rechnet jede Rasterzelle als eigenen Abruf gegen das Kontingent, ein dichteres Raster sprengt den Fair-Use-Rahmen |
| Regenradar / Satellitenwolken / Blitzdichte (Timeline) | 🟡 teilweise | RainViewer, NASA GIBS (GOES) | nein | kostenlos | `js/layers/RadarLayer.js` (Regenradar mit Zeitschieber, WEB-67) und `js/layers/GoesCloudLayer.js` (Infrarot-Wolken GOES East/West). **Blitzdichte fehlt weiterhin** — Quelle verifiziert, Aufwand groß, liegt als WEB-131 im `backlog` |
| Tropische Wirbelstürme (Vorhersagekegel) | ✅ vorhanden | NOAA National Hurricane Center | nein | kostenlos | `js/layers/CycloneLayer.js` |
| Cockpit-Wettermodus (volumetrische Wolken) | ❌ fehlt | — | — | — | – |

### 2.6 Audio & KI/Steuerung

| Feature (GEV) | Status | Datenquelle (ARGUS) | Schlüssel | Kostenrisiko | Datei(en) |
|---|---|---|---|---|---|
| Radio (GEV: bis 750 Sender, Tuner-UI) | 🟡 teilweise | Radio Browser API | nein | kostenlos | `js/layers/RadioLayer.js` — Begründung: Kontingent serverseitig auf 300 Sender gedeckelt gegen 750 bei GEV, UI-Konzept (Tuner/Audioplayer im Detailpanel) gleichwertig |
| Sensor-Stile CRT/NVG/FLIR/Noir/Snow (+ Tastatur-Shortcuts) | ✅ vorhanden | clientseitig (CSS-Filter) | — | kostenlos | `js/sensorStyles.js` — 6 Stile inkl. „Normal" und „Tactical HUD"-Umschaltung, per Zifferntaste wie bei GEV |
| Erkennungs-Overlay (Bounding Boxes) | ✅ vorhanden | clientseitig, aus geladenen Layer-Objekten | — | kostenlos | `js/hud.js` (`TacticalHUD`) — rein dekorativ auf Basis bereits geladener Objektdaten, keine echte Bilderkennung (wie bei GEV) |
| Taktisches HUD (Telemetrie-Einblendung) | ✅ vorhanden | wie oben | — | kostenlos | `js/hud.js` — in ARGUS mit Erkennungs-Overlay zu einer Komponente zusammengefasst |
| Zeichnen/Whiteboard (Fläche/Linie/Pin) | 🟡 teilweise | clientseitig | — | kostenlos | `js/drawTools.js`, `js/drawToolsPanel.js` — Begründung: manuelle Werkzeuge vollständig vorhanden (Freihand, Grenzen, Distanzmessung), aber **keine Sprachsteuerung** des Whiteboards wie bei GEV |
| Szenen-Regisseur (Kamerafahrten aufzeichnen/teilen) | ✅ vorhanden | clientseitig | — | kostenlos | `js/sceneDirector.js`, `js/sceneDirectorPanel.js` — Stationen aufnehmen, Reihenfolge/Haltedauer bearbeiten, weich abspielen; Speichern/Teilen über denselben Share-Link-Mechanismus. Eine OSRM-Route lässt sich als Flythrough abspielen |
| Share-Links (Kamera+Stil+Layer+Ziel in URL) | ✅ vorhanden | clientseitig | — | kostenlos | `js/shareLink.js` |
| Sprachsteuerung (Kamera/Layer per Zuruf, 30+ Voice-Tools) | ❌ fehlt | — | — | kostenpflichtig bei Umsetzung (OpenAI Realtime) | ARGUS hat nur Diktat/Vorlesen für den Text-Chat (`js/ai/voice.js`, Browser Web-Speech-API) – keine Kamera-/Layersteuerung per Sprache |
| KI-HUD-Kurzfassung (5-Wort-Szenenbeschreibung) | ❌ fehlt | — | — | kostenpflichtig bei Umsetzung | ARGUS hat Objekt-Kontext für den Chat (`ai/locationContext.js`), aber keine automatische HUD-Kurzfassung |
| Setup-Diagnose (`npm run doctor`) | ✅ vorhanden | — | — | kostenlos | `server/doctor.mjs` – prüft Node-Version und meldet gefundene `.env`-Schlüssel ohne Werte auszugeben |

## 3. Priorisierte Vorschläge (fortgeschrieben)

> **Stand 05.11.2026 (WEB-164):** Tier 1 und Tier 2 sind vollständig
> abgeschlossen, Tier 3 bis auf die beiden Sprach-Punkte. Die Abschnitte
> unten sind entsprechend fortgeschrieben.

### Tier 1 – abgeschlossen
Alle fünf ursprünglichen Punkte (Share-Links, Sensor-Stile, zusätzliche
Infrastruktur-Kategorien, Setup-Diagnose, Kamera-Sichtfeld) liegen auf
`origin/main`; das Kamera-Sichtfeld kam mit WEB-72 dazu.

### Tier 2 – abgeschlossen

| Punkt | Umgesetzt als |
|---|---|
| Routenplanung (OSRM) | `js/routeTool.js` (WEB-71) |
| Radio, Wetter | `RadioLayer.js`, `WeatherLayer.js` |
| Leihräder | `BikeShareLayer.js` über GBFS (WEB-70) |
| Regenradar | `RadarLayer.js` über RainViewer (WEB-67) |
| ÖPNV-Layer | `TransitLayer.js`, GTFS-Realtime mit eigenem Protobuf-Decoder (WEB-94) |
| Verkehr | `TrafficLayer.js`, TomTom optional für Live-Werte (WEB-93) |
| Satelliten-Katalogtiefe | mehr CelesTrak-Gruppen (WEB-89) |
| Infrastruktur in Masse | 4.813 Rechenzentren, 16.630 Dämme, 195 OSM-Seekabel aus Overpass, eingecheckt (WEB-142) |

Beim letzten Punkt ist ARGUS damit über das GEV-Niveau hinaus, nicht nur
gleichauf. Offene Restarbeit: WEB-151 filtert die Dammdaten über Wikidata
nach, weil unter den 16.630 Treffern auch Kleinstwehre sind.

### Tier 3 – teilweise erledigt, Rest braucht Freigabe

Erledigt:
- **Szenen-Regisseur** – `js/sceneDirector.js` (v2.8).
- **3D-Flugzeugmodelle je Klasse** – `js/aircraftModels.js`, fünf Klassen
  mit Glyph→Modell-Wechsel ab Zoomschwelle (v2.8).
- **Militärflug-Kennzeichnung** – eigener Layer in Bernstein, weltweiter
  adsb.lol-Feed, dedupliziert gegen den Zivil-Layer (WEB-90).

Weiterhin offen, beide wegen laufender Kosten bewusst zurückgestellt:
- **Sprachagent (OpenAI Realtime API)** – ergänzt den bestehenden
  Claude-Text-Assistenten um Sprachsteuerung. Kostenpflichtig nach
  Nutzungsminuten, braucht eine explizite Freigabe.
- **Sprachsteuerung fürs Zeichnen/Whiteboard** – baut auf `drawTools.js`
  auf und hängt an derselben Freigabe.

## 4. ARGUS-exklusive Layer ohne GEV-Äquivalent

GEV kennt diese Layer/Funktionen nicht – sie sind eigenständige
Erweiterungen von ARGUS und fallen damit aus dem direkten Vergleich:
Asteroiden-Tracker (NeoWs, `AsteroidLayer.js`), Kometen-Tracker (JPL SBDB,
`CometLayer.js`), Tiefraum-Missionen (JPL Horizons, `deepSpace.js`),
Weltraumwetter (Kp-Index/Polarlicht, `SpaceWeatherLayer.js`),
Vulkan-Aktivität (Smithsonian GVP + USGS, `VolcanoLayer.js`),
Luftqualität/AQI (`AQILayer.js`), Kraftstoffreserven (`FuelReserveLayer.js`),
globale Lage/Ereignisse (GDELT, `EventLayer.js`), Pattern-of-Life-Heatmap
(`HeatmapLayer.js`), Link-Analyse/Netzwerk-Graph (`linkAnalysis.js`,
`graphView.js`), Objekt-Dossier-Export, Anomalie-Alarme
(`anomalyAlerts.js`), Zeitleisten-Replay (`historyReplay.js`,
`timeline.js`) und Watchlist (`watchlist.js`).

Seit der letzten Fortschreibung dazugekommen: Strahlungsmessnetz
(Safecast, `RadiationLayer.js`, WEB-154), Tsunami-Warnungen (NOAA
PTWC/NTWC, `TsunamiAlertLayer.js`, WEB-155), Kontakte-Roster
(`contactsRoster.js`), Zeichnen & Messen mit GeoJSON-Export
(`drawTools.js`), sichtbarer Layer-Status (WEB-159) sowie
Sitzungs-Autosave und PWA-Offlinefähigkeit (WEB-161, WEB-60).

Diese Breite an Palantir-artigen Analyse-Werkzeugen ist eine Stärke, die
bei der weiteren Priorisierung von GEV-Lücken nicht aus dem Blick geraten
sollte.

## 5. Bewusst nicht übernehmen

- **Vite-Build**: ARGUS' Stärke ist der fehlende Build-Schritt
  („sofort loslegen mit `python3 -m http.server`"). Beibehalten, auch
  wenn GEV inzwischen Node 24/26 und einen vollständigen npm-Stack
  voraussetzt – das vertieft den Unterschied eher, als ihn zu verkleinern.
- **Personen-Tracking / Gesichtserkennung**: GEV lehnt Personen als
  Such-/Trackingziel explizit ab; ARGUS zieht dieselbe Grenze. Das
  Erkennungs-Overlay (`js/hud.js`) ist rein dekorativ (keine echte
  Bilderkennung) und bleibt das auch.
- ~~**ALPR-Kamera-Standorte (Kennzeichen-Scanner)**~~ – **diese
  Entscheidung wurde später revidiert.** Der Layer ist mit WEB-99 als
  `js/layers/ALPRLayer.js` umgesetzt. Ausschlaggebend war, dass das
  Kartieren von Überwachungsinfrastruktur dem Verzicht auf
  Personen-Tracking nicht widerspricht, sondern ihn gerade stützt: Die
  Quelle ist die DeFlock-Community, die Kennzeichenleser als gewöhnliche
  OSM-Knoten erfasst (`man_made=surveillance` +
  `surveillance:type=ALPR/ANPR`).

  Die Datenschutzgrenze ist im Code verankert, nicht nur im Dokument:
  OSM führt an diesen Knoten grundsätzlich keine Kennzeichen-, Fahrzeug-
  oder Personendaten, und `/api/alpr` reicht zusätzlich nur eine feste
  Whitelist an Feldern durch (Standort, Hersteller, Modell,
  Blickrichtung). Der Layer zeigt **Geräte, keine Messungen**.
- **Sprachagent (OpenAI Realtime API)**: nicht grundsätzlich
  ausgeschlossen, aber laufende Kosten nach Nutzungsminuten erfordern
  eine explizite Freigabe, bevor das umgesetzt wird (siehe Tier 3).
- **Pinokio-Installer**: Zielgruppe/Vertriebsweg passt nicht zum Projekt.

## 6. Empfohlene Reihenfolge

Die Punkte 1–3 der früheren Reihenfolge (unmergte Branches, ÖPNV/Verkehr,
Objektzahlen erhöhen) sind abgearbeitet. Es bleibt:

1. **WEB-151** – Dammdaten über Wikidata nachfiltern. Reine
   Datenqualität, kein neuer Schlüssel, kein neuer Layer.
2. **WEB-131** – Blitzdichte. Quelle ist verifiziert, der Aufwand aber
   groß; liegt im `backlog`.
3. **Tier 3 nur nach expliziter Freigabe** – die beiden Sprach-Punkte
   verursachen laufende Kosten nach Nutzungsminuten.

Der Feature-Abstand zu GEV ist damit geschlossen; die verbleibenden
Punkte sind Nachbesserungen und bewusst zurückgestellte Kostenfragen.

## 7. Nächste Schritte

1. **Entscheidung zum Sprachagenten einholen** – der einzige inhaltlich
   offene GEV-Punkt. Er braucht eine Freigabe wegen laufender Kosten
   (OpenAI Realtime API, Abrechnung nach Nutzungsminuten), nicht wegen
   des Aufwands.
2. **WEB-151 einplanen**, damit die Dammdaten belastbar werden.
3. Laufende Fortschreibung dieses Dokuments bei jedem GEV-Sync, analog
   zur bestehenden Doku-Konvention (echte Schlüssel nie im Repo, nur
   lokal in `.env`).
