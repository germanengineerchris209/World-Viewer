# 🌍 World Viewer

Ein interaktiver 3D World Viewer als reine Browser-WebApp – Satellitenansicht
der Erde wie bei Google Earth, mit weltweiten Daten zu Flugzeugen, Schiffen,
Satelliten, Kameras und öffentlicher Infrastruktur – plus einem KI-Assistenten,
der Fragen zum betrachteten Ort beantwortet.

![Tech](https://img.shields.io/badge/HTML5%20%7C%20CSS3%20%7C%20Vanilla%20JS-ES6%20Module-blue)
![Engine](https://img.shields.io/badge/3D--Engine-CesiumJS%20(CDN)-green)
![AI](https://img.shields.io/badge/KI-Claude%20API-7c3aed)

## 🚀 Schnellstart

### Variante A – ohne Server (sofort loslegen)

```bash
cd world-viewer
python3 -m http.server 8000
```

→ <http://localhost:8000>

Satellitenansicht, alle Layer, Bilder und Kamera-Streams funktionieren
sofort. Flugzeuge laufen als Demo-Daten, der KI-Assistent bittet um einen Key.

### Variante B – mit Live-Flugdaten und KI (empfohlen)

Der mitgelieferte Server liefert die App aus **und** holt die Live-Daten.
Node.js 18+ genügt, es werden keine npm-Pakete gebraucht:

```bash
cd world-viewer

# Live-Flugzeuge: kostenlos über OpenSky (auch ganz ohne Konto nutzbar)
node server/server.mjs

# ODER mit Flightradar24 (kostenpflichtiges API-Abo)
export FR24_API_TOKEN="…"
node server/server.mjs

# Optional dazu: KI-Assistent
export ANTHROPIC_API_KEY="sk-ant-…"
```

→ <http://localhost:8000>

> ⚠️ Die Seite **nicht** per Doppelklick als Datei öffnen – Browser blockieren
> dann ES6-Module und JSON-Daten. Es braucht immer einen Webserver.

## ✈️ Live-Flugdaten

Die Flugzeuge kommen wahlweise von **Flightradar24** oder vom **OpenSky
Network**. Beide Dienste erlauben keine direkten Aufrufe aus dem Browser
(kein CORS) – deshalb holt sie der mitgelieferte Server, der zugleich die
Zugangsdaten schützt.

| | Flightradar24 | OpenSky Network |
|---|---|---|
| Kosten | kostenpflichtiges Abo, Abrechnung nach Credits | kostenlos |
| Anmeldung | Token nötig | optional (mehr Kontingent) |
| Daten | Route, Flugnummer, Registrierung, Typ, ETA | Position, Höhe, Speed, Kurs, Land |
| Einrichten | `export FR24_API_TOKEN="…"` | nichts – oder `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` |

Der Server wählt automatisch: Ist ein `FR24_API_TOKEN` gesetzt, nimmt er
Flightradar24, sonst OpenSky. Erzwingen lässt sich das mit
`FLIGHT_PROVIDER=fr24` bzw. `FLIGHT_PROVIDER=opensky`.

**Sparsam mit dem Guthaben.** Weil bei Flightradar24 jeder Abruf Credits
kostet, ist die App bewusst zurückhaltend:

- Abgefragt wird nur der **sichtbare Kartenausschnitt**, nie die ganze Welt
  (maximal 40° × 40°, konfigurierbar über `maxSpanDegrees`).
- Der Server **cacht** Antworten (Standard: 30 s bei FR24, 12 s bei OpenSky),
  gerundet auf ein halbes Grad – Kameraschwenks lösen also keine Flut aus.
- Ist der Aircraft-Layer **ausgeschaltet**, wird gar nichts abgerufen.
- Zwischen zwei Abrufen werden die Flugzeuge per **Koppelnavigation** aus
  Kurs und Geschwindigkeit weiterbewegt. Die Bewegung ist dadurch flüssig,
  obwohl nur alle 20 Sekunden neue Daten kommen.

Einstellbar in `config.js` unter `flights` (Intervall, Ausschnittsgröße,
Obergrenze) und über Umgebungsvariablen (`FLIGHT_CACHE_MS`, `FLIGHT_MAX`).

Läuft kein Server oder ist der Anbieter nicht konfiguriert, schaltet die App
automatisch auf die Demo-Daten aus `data/aircraft.json` um. Die Statusanzeige
in der Sidebar zeigt immer, was gerade gilt: **● LIVE** mit Quelle und Anzahl,
oder **DEMO** mit dem Hinweis, wie man Live-Daten bekommt.

## 📷 Webcams von den Originalseiten

Die meisten offiziellen Webcams (Städte, Tourismusverbände, feratel,
terra-hd …) veröffentlichen ein JPEG, das regelmäßig überschrieben wird.
Genau das zeigt die App an und lädt es automatisch nach.

Viele Betreiber sperren allerdings fremde Seiten aus:

| Sperre | Wirkung | Lösung in der App |
|---|---|---|
| Hotlink-Schutz (Referer-Prüfung) | 403 statt Bild | Server holt es mit passendem Referer |
| Fehlende CORS-Header | Browser blockiert | Server liefert mit CORS aus |
| `X-Frame-Options` | Seite nicht einbettbar | Bild statt iframe, sonst Direktlink |

Dafür gibt es den Endpunkt **`/api/camera`** im mitgelieferten Server.
Die App versucht **immer zuerst den direkten Weg** und schaltet nur bei
einem Fehler automatisch auf den Proxy um – ohne Server funktioniert also
alles, was ohnehin frei zugänglich ist.

**Sicherheit:** Der Proxy ist bewusst kein offener Proxy. Er akzeptiert nur
Hosts, die in `data/cameras.json` vorkommen (erweiterbar über
`CAMERA_HOSTS`), lehnt private und lokale Adressen ab (Schutz vor
Zugriffen ins eigene Netz), liefert nur Bilder und Streamformate aus und
begrenzt Größe und Abrufhäufigkeit.

**Mehrere Kameras je Standort** – einfach `streams` statt `stream` verwenden:

```json
"streams": [
  { "label": "Marienplatz", "type": "image",
    "url": "https://…/3017.jpeg", "referer": "https://www.feratel.com/",
    "refreshSeconds": 30, "pageUrl": "https://…" },
  { "label": "Olympiaturm", "type": "image", "url": "https://…/3016.jpeg" }
]
```

Bitte die Nutzungsbedingungen der jeweiligen Betreiber beachten – für den
privaten Gebrauch ist das Anzeigen öffentlicher Kamerabilder üblich,
kommerzielle Weiterverwendung braucht oft eine Erlaubnis.

## 🔑 API-Keys – was braucht man wirklich?

**Die App läuft komplett ohne jeden Key.** Keys schalten nur Extras frei:

| Funktion | Ohne Key | Mit Key |
|---|---|---|
| Satellitenbilder | ✅ Esri World Imagery (bis Hausebene) | ✅ Cesium Ion **eingetragen** |
| 3D-Gelände (Berge) | flache Kugel | ✅ Cesium Ion **eingetragen** |
| 3D-Gebäude grau (OSM) | – | ✅ Cesium Ion **eingetragen** |
| 3D-Gebäude fotorealistisch | – | Google Map Tiles API |
| 🔥 Brände | – | ✅ NASA FIRMS **eingetragen** |
| Objektbilder | ✅ Wikipedia | – |
| Ortsnamen | ✅ OpenStreetMap | – |
| Live-Flugzeuge | ✅ OpenSky (kostenlos) | ✨ Flightradar24-Abo |
| 🚢 Schiffe (echte AIS-Daten) | Demo-Daten | AISStream (kostenlos) |
| 🚀 Mehr Start-Kontingent | ✅ Launch Library 2 (15/h) | Launch Library 2 API-Token |
| 📷 Mehr TfL-Kamera-Kontingent | ✅ TfL (Basiskontingent) | TfL App Key |
| KI-Assistent | – | ✅ Anthropic-API-Key |

**🔌 POWER-UP-Panel.** Alle Schlüssel-Dienste aus der Tabelle oben stehen
auch live im Browser: Klick auf den „POWER-UP"-Chip unten öffnet das Panel
„Schlüssel & Dienste" mit Status (gesetzt / extern gesetzt / fehlt) je
Dienst, was er freischaltet, Kostenhinweis und Link zur Registrierung. Die
Layer-Konsole markiert zusätzlich jeden Layer, der ohne Key eingeschränkt
ist, mit einem kleinen Schlüssel-Badge. Die Werte selbst gehen nie über
`/api/keys` an den Browser – nur Status-Strings (siehe `server/keyRegistry.mjs`).

**Wo kommt was hin?**

| Ort | Inhalt | Warum dort |
|---|---|---|
| `config.js` | Cesium-Ion-Token, Google-Maps-Key | die Kartenbibliothek braucht sie im Browser |
| `.env` | alle übrigen Schlüssel | echte Geheimnisse, bleiben auf dem Server |

Die Datei `.env` wird beim Serverstart automatisch gelesen und steht in
`.gitignore`. Vorlagen ohne Werte: `.env.example` und `config.example.js`.

Für Google fotorealistische 3D-Tiles muss in der Google Cloud Console die
**Map Tiles API** aktiviert sein – die normale Maps-JavaScript-API reicht nicht.

## ✨ Funktionen

**3D-Globus**
Satellitenansicht als Standard (Satellit / Hybrid mit Beschriftung / Karte /
Relief, umschaltbar in der Sidebar), drehen, zoomen vom Weltraum bis auf
Straßenebene, sanfte Kameraflüge, 2D/3D, Tag-Nacht-Beleuchtung, Koordinatenanzeige.

**Layer (einzeln schaltbar), gruppiert in der Kategorien-Konsole**

Die Sidebar gruppiert alle Layer in sechs Kategorien statt einer langen
flachen Liste (`js/layerCategories.js`):

**32 Layer** in sechs Kategorien:

| Kategorie | Layer |
|---|---|
| 🚀 Bewegung (7) | Aircraft · Militärflüge · Ships · Satellites (echte SGP4-Bahnen) · ÖPNV · Verkehr · Leihräder |
| 📷 Kameras (4) | Cameras (mit Sichtfeld-Kegel) · Allsky-Kameras · Kennzeichenleser (nur Standorte) · Street-Level |
| 🏗️ Infrastruktur (4) | Infrastructure (inkl. Rechenzentren/Dämme in Masse) · Seekabel (inkl. OSM-Massendatensatz) · Radiosender · Kraftstoffreserven |
| 🚨 Ereignisse (8) | Erdbeben · Vulkane · Brände · Raketenstarts (inkl. Launch-Replay) · Globale Ereignis-Lage · Asteroiden · Kometen · Tsunami-Warnungen |
| 🌦️ Wetter (8) | Wetter (Städte) · Niederschlagsradar · Luftqualität (AQI) · Strahlungsmessnetz · Wirbelstürme · Weltraumwetter · GOES-Wolken · Weltwetter-Raster |
| 🧰 Werkzeuge (1) | Heatmap (Pattern-of-Life) |

Die vollständige Tabelle mit Datenquelle und Darstellung je Layer steht in
**DOKUMENTATION.md** (1.2), die Schlüssel-Lage in **DATENQUELLEN.md**.

Neue Layer landen automatisch unter „Werkzeuge", bis sie in
`layerCategories.js` eingetragen werden – das verhindert, dass die Konsole
durch einen vergessenen Eintrag unsichtbar wird.

**🚥 Jeder Layer zeigt seinen Zustand.** Laden, Fehler, leer oder
„Schlüssel fehlt" erscheinen als Status-Punkt am Schalter; fehlgeschlagene
Quellen melden sich zusätzlich kurz unten links. Ein nicht
freigeschalteter Layer ist damit von einem defekten unterscheidbar –
vorher zeigten beide schlicht *0 Objekte*.

> **Massendatensätze liegen im Repo.** Rechenzentren (`data/datacenters.json`,
> 4.813 Objekte), Dämme (`data/dams.json`, 16.630) und OSM-Seekabel
> (`data/cables-osm.json`, 195) sind eingecheckt, ein frischer Checkout zeigt
> sie also sofort. Neu erzeugen lassen sie sich mit
> `npm run build:infrastructure-mass` (dauert mehrere Minuten, braucht
> Internet). Bis WEB-142 war das anders — die Dateien fehlten und die Layer
> blieben bei den handkuratierten Einträgen.

**🪟 Andockbare Panels rechts.** Detail-, Verknüpfungs- und KI-Panel sitzen
in einer rechten Panel-Rail, lassen sich dort verschieben, in der Größe
ändern und stapeln; der Zustand bleibt über `localStorage` erhalten
(`js/panelDock.js`). Unterhalb von 821px Breite (mobil) bleibt es bei der
bisherigen Vollbild-Darstellung.

**📡 Kontakte-Roster.** Listet alle Objekte aus den aktiven Layern in einem
einstellbaren Radius um das Kamerazentrum, mit Entfernung und Peilung, nach
Entfernung sortiert (Standard 250 km). Sitzt als eigenes Panel in derselben
rechten Rail und aktualisiert sich beim Schwenken mit.

**🎬 Szenen-Regisseur.** Kamerapositionen als Stationen einer Fahrt
aufnehmen, Reihenfolge/Haltedauer bearbeiten und weich abspielen lassen
(eigener Sidebar-Abschnitt). Speichern/Laden läuft über denselben
Share-Link-Mechanismus wie sonst in der App. Eine berechnete Routen-Strecke
(Fuß/Rad/Auto) lässt sich ebenfalls als Flythrough abspielen.

**✈️ 3D-Flugzeugmodelle.** Fünf Flugzeugklassen (Boeing 787, ATR-72,
Citation, Bell 206, MQ-9) wechseln ab einer Zoomschwelle vom Glyph auf ein
echtes 3D-Modell; alle anderen Typen bleiben beim Glyph.

**🚀 Launch-Replay.** Raketenstarts zeigen beim Abspielen eine
rekonstruierte Aufstiegsbahn statt eines einzelnen Punkts – deutlich als
Modell/Schätzung markiert, nicht als echte Telemetrie.

**Echte Bahndaten statt Kreisbahn**
Satelliten laufen auf echten Bahnen: TLE-Daten von CelesTrak, gerechnet
mit dem SGP4-Modell. Die ISS steht dort, wo sie wirklich ist. Ein Klick
zeichnet die Umlaufbahn als Ring.

**🛩️ Mitfliegen (Cockpit-Ansicht)**
Ein Flugzeug auswählen und „Mitfliegen" – die Kamera sitzt im Cockpit,
mit Anzeige von Höhe, Speed, Kurs und Steigrate. Escape bringt zurück.

**Bild zu jedem Objekt**
Jedes Objekt zeigt im Detailpanel ein Bild: echtes Foto von Wikipedia
(inkl. Kurzbeschreibung und Artikel-Link) oder – falls keins verfügbar ist –
eine automatisch erzeugte Illustration passend zum Typ. Es gibt also nie ein
leeres Bildfeld.

**Kamera-Livebilder von den Originalseiten**
Kameras zeigen das Livebild direkt im Panel – auch von Seiten, die
Hotlinking normalerweise sperren (siehe unten). Ein Standort kann
mehrere Kameras haben: München bringt Marienplatz, Olympiaturm,
Hauptbahnhof und Isar als Reiter über dem Bild. Dazu Zeitstempel der
letzten Aktualisierung, Vollbild und Link zur Originalseite.

**KI-Assistent (Claude)**
Button unten links. Beantwortet Fragen zum aktuell betrachteten Ort.
Mitgeschickt werden automatisch: Koordinaten, Kamerahöhe, Ortsname
(OpenStreetMap), das ausgewählte Objekt und alle Objekte im Umkreis.
Antworten werden gestreamt. Im Detailpanel gibt es zusätzlich
„✨ Claude dazu fragen" für objektbezogene Fragen.

**Suche & Zeitsteuerung**
Suche nach Callsign, Schiff, Satellit, Stadt oder Koordinaten (`50.03, 8.56`).
Timeline unten: Play / Pause / Reset / Zeitraffer 1×–300×.

**💾 Die Sitzung überlebt ein F5.** Aktive Layer, Kameraposition und
offene Panels werden automatisch in `localStorage` gesichert – bei 32
Layern muss man sich die Auswahl nach einem Reload nicht neu
zusammenklicken. Ein Share-Link in der Adresszeile hat beim Start Vorrang
vor der gespeicherten Sitzung.

**📥 Installierbar und offline startfähig.** Die App ist eine PWA
(`manifest.json` + `sw.js`): Der Service Worker cacht die Shell
stale-while-revalidate, Live-Daten unter `/api/*` nie.

**🧭 Routenplanung Fuß/Rad/Auto.** Start und Ziel per Klick auf den
Globus, Route kommt vom öffentlichen OSRM-Demo-Server – Linie plus
Distanz/Dauer, keine Turn-by-Turn-Navigation. Die Strecke lässt sich als
Flythrough abspielen. (Demo-Server: nur für geringes Volumen, keine
SLA-Garantie.)

**✏️ Zeichnen, Messen, Beobachten.** Punkte, Freihand-Linien, Grenzen und
Distanzmessungen rein mit Cesium-Bordmitteln, als GeoJSON exportierbar.
Dazu Beobachtungszonen (Geofences) mit Ein-/Austritts-Alarmen über alle
Layer hinweg.

**🕸️ Verknüpfungen als Graph.** Das ausgewählte Objekt und seine
Verbindungen (gemeinsame Airline, Flagge, Betreiber, räumliche Nähe)
entweder als Liste oder als interaktiver Node-Graph.

**🕰️ Zeitleisten-Replay.** Erdbeben, Brände und Raketenstarts der letzten
Tage nacheinander nach ihrem echten Zeitstempel, mit Play/Pause/Scrub –
unabhängig vom Simulations-Zeitraffer.

**👁️ Kamera-Sichtfeld.** Kameras mit hinterlegter Blickrichtung zeichnen
einen Sektor aus Richtung, Öffnungswinkel und Reichweite auf den Globus.
Reine Geometrie – Gelände und Gebäude schatten ihn nicht ab.

## ⌨️ Tastenkürzel

Alle globalen Kürzel laufen über eine zentrale Stelle
(`js/keyboardShortcuts.js`) statt über mehrere unabhängige Listener. Sie
feuern nicht, während in einem Eingabefeld getippt wird (Suche, KI-Chat …) –
außer Escape, das auch aus einem Textfeld heraus funktioniert.

| Taste | Wirkung |
|---|---|
| `1`–`7` | Sensorstil wählen (Nachtsicht, Wärmebild, …) |
| `H` | Tactical-HUD-Rahmen (Eckmarken + Statuszeile) ein/aus |
| `D` | Erkennungs-Overlay (Ziel-Boxen + Telemetrie) ein/aus |
| `C` | Cockpit-Ansicht für das ausgewählte Flugzeug ein/aus |
| `` ` `` | FPS-Zähler ein/aus |
| `?` | Kurzreferenz aller Tastenkürzel ein-/ausblenden |
| `Esc` | Kette: oberstes Panel schließen → Verfolgen beenden → Cockpit verlassen (erster zutreffender Schritt gewinnt) |

Die vollständige, immer aktuelle Liste zeigt die Kurzreferenz im Browser
selbst (Taste `?` oder der „⌨"-Knopf unten links) – sie liest die
tatsächlich registrierten Kürzel aus, nicht eine separat gepflegte Liste.

## 📁 Projektstruktur

```
world-viewer/
├── index.html            Interface
├── style.css             Dunkles, responsives Design
├── config.js             API-Keys & Einstellungen (nicht committen!)
├── manifest.json         PWA-Manifest (installierbar)
├── sw.js                 Service Worker: Offline-Shell, /api/* ausgenommen
│
├── js/
│   ├── app.js            Einstiegspunkt + zentrale Update-Schleife
│   ├── viewer.js         CesiumJS-Kapselung (Kamera, Picking, Modi)
│   ├── basemaps.js       Kartenhintergründe, Gelände, 3D-Gebäude
│   ├── layerManager.js   Verwaltung aller Layer + zentrale Refresh-Timer
│   ├── dataManager.js    JSON-Laden, Datenformat, Geo-Mathematik
│   ├── ui.js             Sidebar, Kartenauswahl, Detailpanel, Status-Punkte
│   │
│   │   ── Daten & Darstellung ──
│   ├── flightData.js     Live-Flugdaten holen (mit Demo-Rückfall)
│   ├── shipData.js       AIS-Schiffsdaten über /api/ships
│   ├── aircraftTypes.js  ICAO-Typcodes → Klarnamen und Wikipedia
│   ├── aircraftModels.js 3D-Flugzeugmodelle je Klasse (Glyph-Wechsel)
│   ├── imageProvider.js  Bildbeschaffung (Wikipedia → Illustration)
│   ├── illustrations.js  Generierte SVG-Bilder als Fallback
│   ├── streamPlayer.js   Kamera-Livebilder (Bild/HLS/YouTube/iframe)
│   ├── cameraViewshed.js Sichtfeld-Kegel für Kameras
│   ├── deepSpace.js · cometOrbits.js · launchAscent.js
│   │
│   │   ── Oberfläche ──
│   ├── layerCategories.js   Kategorie-Zuordnung für die Layer-Konsole
│   ├── panelDock.js         Andock-/Verschiebe-/Skalierlogik der rechten Rail
│   ├── keyStatusPanel.js    POWER-UP-Chip + Panel „Schlüssel & Dienste"
│   ├── statusToast.js       Lade-/Fehlerhinweise unten links
│   ├── keyboardShortcuts.js Zentrale Verwaltung aller globalen Tastenkürzel
│   ├── keyboardReference.js Einblendbare Kurzreferenz (Taste „?")
│   ├── hud.js · cockpit.js · sensorStyles.js · fpsCounter.js
│   ├── streetLevelPanel.js  Mapillary-Betrachter
│   │
│   │   ── Analyse & Werkzeuge ──
│   ├── search.js            Suche (Objekte, Städte, Koordinaten)
│   ├── timeline.js          Zeitraffer der Simulation
│   ├── historyReplay.js     Echte historische Ereignisse abspielen
│   ├── watchlist.js         Beobachtungszonen (Geofences) + Alarme
│   ├── watchlistPanel.js    Panel-UI dazu
│   ├── anomalyAlerts.js     Auffälligkeiten in den Live-Daten
│   ├── linkAnalysis.js      Verknüpfte Objekte finden
│   ├── graphView.js         Dieselben Verknüpfungen als Node-Graph
│   ├── drawTools.js         Zeichnen & Messen (GeoJSON-Export)
│   ├── drawToolsPanel.js    Panel-UI dazu (inkl. Routen-Abschnitt)
│   ├── routeTool.js         Route Fuß/Rad/Auto über OSRM
│   ├── contactsRoster.js    Objekte im Radius, Distanz + Peilung
│   ├── contactsPanel.js     Panel-UI dazu (in der rechten Rail)
│   ├── sceneDirector.js     Kamerafahrten aufnehmen/abspielen
│   ├── sceneDirectorPanel.js  Sidebar-UI dazu
│   ├── dossier.js           Objekt-Dossier als Textdatei
│   ├── shareLink.js         Ansicht als Link teilen
│   ├── session.js           Dieselbe Kodierung als Autosave in localStorage
│   │
│   ├── ai/
│   │   ├── assistant.js       Chat-UI (Button unten links)
│   │   ├── claudeClient.js    Claude-API-Anbindung (Streaming)
│   │   └── locationContext.js Ortskontext für die KI
│   │
│   └── layers/           BaseLayer.js + 31 Layer-Klassen → 32 Layer
│                         (AircraftLayer läuft zweimal: zivil + militärisch;
│                          vollständige Liste: DOKUMENTATION.md 1.2)
│
├── server/               Node 18+, keine npm-Pakete
│   ├── server.mjs           Webserver + Routing aller /api/*-Endpunkte
│   ├── loadEnv.mjs          .env lesen – muss erster Import sein
│   ├── keyRegistry.mjs      Einzige Liste der optionalen Schlüssel/Dienste
│   │                        (POWER-UP-Panel + `npm run doctor`)
│   ├── dataProxies.mjs      Gemeinsamer Cache + Serve-Stale für Fremdquellen
│   ├── flightProviders.mjs  Flightradar24 / OpenSky / adsb.lol
│   ├── aisStream.mjs        AIS per WebSocket (eigener RFC-6455-Client)
│   ├── cameraProxy.mjs      Webcam-Bilder trotz Hotlink-Sperre (+ SSRF-Schutz)
│   ├── gtfsRealtime.mjs     Eigener Protobuf-Decoder für GTFS-Realtime
│   ├── kmz.mjs              Eigener ZIP-Reader für die NHC-Vorhersagekegel
│   ├── volcanoLabels.mjs    Deutsche GVP-Bezeichnungen
│   ├── deepSpace.mjs        Deep-Space-Missionen (JPL Horizons)
│   ├── doctor.mjs           Setup-Diagnose (`npm run doctor`)
│   └── claude-proxy.mjs     Alter Startbefehl (leitet auf server.mjs weiter)
│
├── scripts/
│   ├── build-infrastructure-mass.mjs  Rechenzentren/Dämme/Seekabel aus OSM
│   └── build-volcano-fallback.mjs     Offline-Schnappschuss der GVP-Vulkane
│
└── data/                 Demo- und Katalogdaten sowie die eingecheckten
                          Massendatensätze (datacenters, dams, cables-osm)
```

## 🧩 Erweitern

**Neuer Layer:** Klasse in `js/layers/` von `BaseLayer` ableiten,
`createEntity()` überschreiben, JSON in `data/` ablegen, in `app.js`
registrieren. Sidebar-Schalter, Suche und Detailpanel funktionieren automatisch.

**Bild für ein Objekt festlegen:** Feld `wikipedia` (Artikeltitel) oder
`imageUrl` (direkte Bild-URL) im JSON-Datensatz ergänzen.

**Kamera hinzufügen oder austauschen:** In `data/cameras.json` das Feld
`stream` (eine Ansicht) oder `streams` (mehrere) anpassen:

```json
"stream": { "type": "image", "url": "https://…/cam.jpg",
            "referer": "https://betreiber.de/", "refreshSeconds": 30 }
"stream": { "type": "hls",     "url": "https://…/stream.m3u8" }
"stream": { "type": "youtube", "channelId": "UC…" }
"stream": { "type": "youtube", "videoId": "abc123" }
"stream": { "type": "iframe",  "url": "https://…/player.php" }
"stream": { "type": "link",    "pageUrl": "https://…" }
```

Die Bild-URL findet man meist über Rechtsklick auf das Livebild der
Betreiberseite → „Grafikadresse kopieren". Neue Hosts werden beim
Serverstart automatisch aus dieser Datei in die Erlaubnisliste übernommen.

`channelId` ist haltbarer als `videoId`: YouTube spielt damit immer den
gerade laufenden Livestream des Kanals.

**Anderen Flugdaten-Anbieter anbinden:** In `server/flightProviders.mjs`
eine Funktion nach dem Muster von `fetchOpenSky` ergänzen, die das
einheitliche Format zurückgibt, und sie in `fetchFlights` eintragen.
Die WebApp muss dafür nicht angefasst werden.

## 🔒 Sicherheitshinweis zum API-Key

Der Assistent kennt zwei Modi (`config.js` → `ai.mode`):

- **`proxy`** (Standard, empfohlen): Der Key liegt als Umgebungsvariable auf
  dem Server und verlässt ihn nie. So kann die App auch öffentlich laufen.
- **`direct`**: Der Browser ruft `api.anthropic.com` direkt auf. Bequem zum
  Ausprobieren – aber der Key ist dann für jeden sichtbar, der die Seite
  öffnet. **Nur lokal verwenden, niemals öffentlich hosten.**

Im Chatfenster lässt sich ein Key auch direkt eintragen; er wird dann nur im
`localStorage` dieses Browsers gespeichert, nicht in einer Datei.

## 📚 Weiterführend

- **DATENQUELLEN.md** – alle Datenquellen, APIs und Schlüssel im Überblick:
  was kostenlos ist, was einen Schlüssel braucht, was Geld kostet
- **DOKUMENTATION.md** – Stand, Architektur, Erweiterungswege, Changelog;
  enthält in 1.2 die vollständige Layer-Tabelle
- **DEPLOYMENT.md** – lokal starten, auf Render/Railway/eigenem Server
  hosten, Grenzen von GitHub Pages
- **ANALYSE-GODS-EYE-VIEW.md** – Vergleich mit dem Referenzprojekt und
  offene Vorschläge
- **docs/** – Notizen je Arbeitspaket (Recherche, Entscheidungen,
  Verifikation); Übersicht in `docs/README.md`

Schnell prüfen, was lokal konfiguriert ist: `npm run doctor`.

## 🙏 Herkunft

Teile dieses Projekts sind portiert aus **God's Eye View** von
[Bilawal Sidhu](https://github.com/bilawalsidhu/gods-eye-view) (MIT-Lizenz):
die Anbindung von CelesTrak, USGS, Launch Library 2, NASA FIRMS, adsb.lol
und den Verkehrskamera-Katalogen sowie die Mathematik der Cockpit-Kamera.

Die MIT-Lizenz deckt nur den Quellcode ab – jede Datenquelle behält ihre
eigenen Bedingungen. Die erforderlichen Namensnennungen stehen in
DATENQUELLEN.md und werden in der App angezeigt.
