# World Viewer – Dokumentation (Stand: 05.11.2026, v2.9)

Aktueller Stand, Architektur und Erweiterungswege der Anwendung.

> Beschreibt den Stand von `origin/main`. In WEB-164 vollständig gegen den
> Code abgeglichen: Die Layer-Tabelle (1.2), der Architekturbaum (2) und die
> Grenzen (5) sind aus `js/app.js`, `js/layerCategories.js` und
> `server/keyRegistry.mjs` verifiziert, nicht von Hand fortgeschrieben.

## 1. Was die App kann

Vollständig lauffähige WebApp aus HTML5, CSS3 und Vanilla JavaScript
(ES6-Module). 3D-Engine ist CesiumJS über CDN. Kein Build-Schritt.
Ein Server wird für Live-Flugdaten und den KI-Assistenten gebraucht – er
liegt als fertiges Skript bei (Node 18+, keine npm-Pakete).

### 1.1 Weltansicht (v2.0 überarbeitet)

Die Erde wird als **Satellitenansicht** dargestellt – hochauflösende Luft-
und Satellitenbilder von *Esri World Imagery*, bis auf Straßen- und
Hausebene, **ohne API-Key**. Vier Kartenmodi sind in der Sidebar umschaltbar:

| Modus | Inhalt | Key nötig |
|---|---|---|
| 🛰️ Satellit | reine Satelliten-/Luftbilder | nein |
| 🗺️ Hybrid (Standard) | Satellitenbilder + Orts-/Straßennamen | nein |
| 🛣️ Karte | OpenStreetMap | nein |
| ⛰️ Relief | topografische Karte mit Schummerung | nein |
| ✨ Bing (Ion) | Cesium-Ion-Weltbilder | Ion-Token |

Zusätzlich:
- **3D-Gelände** (echte Berge) mit Cesium-Ion-Token
- **3D-Gebäude** über den Button „🏙️ 3D-Gebäude": fotorealistische Google-
  3D-Tiles (Google-Key, Map Tiles API) oder graue OSM-Gebäude (Ion-Token).
  Ohne passenden Key ist der Button deaktiviert und erklärt das per Tooltip.

Fällt die Satellitenquelle aus (kein Netz, Dienst gestört), schaltet der
Viewer automatisch auf OpenStreetMap um, statt eine leere Kugel zu zeigen.

### 1.2 Layer

**32 Layer**, in der Sidebar nach den sechs Kategorien aus
`js/layerCategories.js` gruppiert. Die Reihenfolge unten entspricht den
`layerManager.register()`-Aufrufen in `js/app.js`. Ein Layer ohne
Kategorie-Eintrag landet automatisch unter „Werkzeuge", damit ein
vergessener Eintrag die Konsole nie unsichtbar macht.

In `js/layers/` liegen 31 Layer-Klassen plus `BaseLayer.js` – 32 Layer
werden daraus, weil `AircraftLayer` zweimal instanziiert wird: einmal
zivil, einmal militärisch mit eigener Farbe und eigenem Feed.

**🚀 Bewegung (7)**

| Layer | `id` | Quelle | Darstellung |
|---|---|---|---|
| ✈️ Aircraft | `aircraft` | `/api/flights` (OpenSky/FR24/adsb.lol) | live, Koppelnavigation zwischen den Abrufen; Demo-Rückfall ohne Server |
| 🎖️ Militärflüge | `militaryAircraft` | `/api/flights/military` (adsb.lol) | bernsteinfarben, weltweiter Feed ohne Bounding-Box, kein Demo-Rückfall, dedupliziert gegen `aircraft` |
| 🚢 Ships | `ships` | `/api/ships` (AISStream) | live mit Key, sonst 10 Demo-Schiffe; Koppelnavigation |
| 🛰️ Satellites | `satellites` | `/api/celestrak/` + `satellite.js` | **echte SGP4-Bahnen** aus TLE-Daten, Umlaufbahn-Ring beim Anklicken |
| 🚌 ÖPNV | `transit` | `/api/transit/` (GTFS-Realtime) | Fahrzeugpositionen, serverseitig aus Protobuf dekodiert |
| 🚗 Verkehr | `traffic` | `/api/traffic/flow` (TomTom) | Verkehrsfluss-Geschwindigkeiten, nur mit TomTom-Key |
| 🚲 Leihräder | `bikeshare` | `data/bikeshare-systems.json` + GBFS | Stationen mit freien Rädern/Plätzen |

**📷 Kameras (4)**

| Layer | `id` | Quelle | Darstellung |
|---|---|---|---|
| 📷 Cameras | `cameras` | `data/cameras.json` (17) + `/api/cctv` | Livebild von der Originalseite, mehrere Ansichten je Standort, optionaler Sichtfeld-Kegel |
| 🌌 Allsky-Kameras | `allsky` | `data/allsky-cameras.json` (20) + `/api/allsky` | Himmelsaufnahmen von Observatorien |
| 🪪 Kennzeichenleser (ALPR) | `alpr` | `/api/alpr` (DeFlock/OSM) | **nur Standorte**, kein Tracking und keine Kennzeichen |
| 📸 Street-Level | `streetlevel` | `/api/mapillary/images` | Abdeckungslinien + Bildkegel, nur mit Mapillary-Key |

**🏗️ Infrastruktur (4)**

| Layer | `id` | Quelle | Darstellung |
|---|---|---|---|
| 🏗️ Infrastructure | `infrastructure` | `infrastructure.json` (24) + `datacenters.json` (4.813) + `dams.json` (16.630) | farbcodiert nach Kategorie, mit Clustering |
| 🔌 Seekabel | `cables` | `cables.json` (16) + `cables-osm.json` (195) | Kabelverläufe als Polylinien |
| 📻 Radiosender | `radio` | Radio Browser API (bis 300) | Audioplayer im Detailpanel statt Bild |
| ⛽ Kraftstoffreserven | `fuelReserves` | `data/fuel-reserves.json` (20) | statisch, Füllstände im Detailpanel |

**🚨 Ereignisse (8)**

| Layer | `id` | Quelle | Darstellung |
|---|---|---|---|
| 🌋 Erdbeben | `earthquakes` | USGS (direkt, CORS) | Fläche nach Magnitude, Farbe nach Herdtiefe |
| 🗻 Vulkane | `volcanoes` | `/api/volcanoes` (GVP) + `volcanoes.json` (438) | deutsche Bezeichnungen über `server/volcanoLabels.mjs` |
| 🔥 Brände | `fires` | `/api/fires` (NASA FIRMS, 24 h) | Farbe und Größe nach Strahlungsleistung |
| 🚀 Raketenstarts | `launches` | `/api/launches` (Launch Library 2) | Farbe nach Betreiber, mit Launch-Replay |
| 📢 Ereignisse | `events` | `/api/events` (GDELT) | globale Nachrichtenlage, Symbol je Thema |
| ☄️ Asteroiden | `asteroids` | `/api/asteroids` (NASA NeoWs) | Erdnahe Objekte mit Vorbeiflugdaten |
| 🌠 Kometen | `comets` | `/api/comets` (JPL SSD) | Bahnen aus Orbitelementen |
| 🌊 Tsunami-Warnungen | `tsunamiAlerts` | `/api/tsunami` (NOAA PTWC/NTWC) | aktive Warnungen, keyless |

**🌦️ Wetter (8)**

| Layer | `id` | Quelle | Darstellung |
|---|---|---|---|
| 🌦️ Wetter | `weather` | `weather-locations.json` (40) + Open-Meteo | Punktwerte für 40 Städte |
| 📡 Niederschlagsradar | `radar` | RainViewer | Kachel-Overlay, letzte ~2 h mit Zeitschieber |
| 🌫️ Luftqualität | `aqi` | `aqi-locations.json` (40) + Open-Meteo | AQI-Werte, farbcodiert |
| ☢️ Strahlungsmessnetz | `radiation` | `/api/radiation` (Safecast) | Messwerte freiwilliger Sensoren |
| 🌀 Wirbelstürme | `cyclones` | `/api/storms` + `/api/storms/cone` (NHC) | Zugbahn + Vorhersagekegel aus KMZ |
| 🌌 Weltraumwetter | `spaceWeather` | NOAA SWPC | Kp-Index, Sonnenwind, Polarlicht-Wahrscheinlichkeit (OVATION-Gitter) |
| 🛰️ GOES-Infrarot-Wolken | `goesClouds` | NASA GIBS (GOES East/West) | Kachel-Overlay, zwei Satelliten |
| 🌡️ Weltwetter (Live) | `worldweather` | Open-Meteo, 15°-Raster (264 Zellen) | Gradnetz nach Temperatur gefärbt, inkl. Ozeanen; Schrittweite konfigurierbar |

**🧰 Werkzeuge (1)**

| Layer | `id` | Quelle | Darstellung |
|---|---|---|---|
| 🔥 Pattern-of-Life-Heatmap | `heatmap` | abgeleitet aus den aktiven Layern | Dichte-Heatmap, keine eigene Quelle |

> **Massendatensätze liegen im Repo.** `datacenters.json` (4.813),
> `dams.json` (16.630) und `cables-osm.json` (195) sind seit WEB-142
> eingecheckt – ein frischer Checkout zeigt sie sofort. Neu erzeugen:
> `npm run build:infrastructure-mass` (braucht Internet, dauert Minuten).

Welche Layer ohne Schlüssel in welchem Umfang laufen, steht vollständig in
**DATENQUELLEN.md**; die Kurzform zeigt das POWER-UP-Panel in der App.

### 1.3 Bilder zu jedem Objekt (neu in v2.0)

Jedes Objekt hat garantiert ein Bild. Die Kaskade in `imageProvider.js`:

1. **`imageUrl`** im Datensatz → wird direkt verwendet
2. **Wikipedia** (REST-API `/page/summary/`, CORS-frei, kein Key) → echtes
   Foto in 640 px, dazu Kurzbeschreibung und Link zum Artikel.
   Gesucht wird über das Feld `wikipedia` im Datensatz; bei Flugzeugen
   wird der Flugzeugtyp verwendet (z.B. „Airbus A320"). Sprachreihenfolge
   DE → EN, konfigurierbar.
3. **Generierte SVG-Illustration** (`illustrations.js`) → passend zum
   Untertyp (Schmalrumpf-/Großraum-/Jumbo-Flugzeug, Container-/Kreuzfahrt-/
   Tankschiff, Raumstation/Teleskop/Navigationssatellit, Flughafen/Hafen/
   Bahnhof/Kraftwerk/Sehenswürdigkeit …), in der Farbe des Layers.

Praktische Wirkung: Beim Öffnen erscheint sofort die Illustration, das
Foto wird im Hintergrund nachgeladen und blendet sich weich ein. Kommt
kein Foto (offline, kein Artikel, Timeout nach 6 s), bleibt die
Illustration stehen. Ergebnisse werden gecacht.

Die Wikipedia-Kurzbeschreibung wird außerdem als Kontext an den
KI-Assistenten weitergereicht.

### 1.4 Kamera-Livebilder (v2.2 überarbeitet)

`streamPlayer.js` bettet das Livebild direkt ins Detailpanel ein.

| `type` | Umsetzung |
|---|---|
| `image` | Standbildkamera, die sich selbst neu lädt (Cache-Buster, Intervall einstellbar). **Der häufigste Fall** bei offiziellen Webcams |
| `hls` | `.m3u8` über hls.js (bei Bedarf vom CDN nachgeladen); Safari nativ |
| `youtube` | Live-Embed per `channelId` (überlebt Video-Wechsel) oder `videoId` |
| `iframe` | Player-Seite des Betreibers |
| `link` | nicht einbettbar → Hinweis + Direktlink |

**Mehrere Kameras je Standort.** Ein Eintrag kann `streams: [...]` statt
`stream: {}` haben. Dann erscheint eine Umschaltleiste über dem Bild –
München zeigt so Marienplatz, Olympiaturm, Hauptbahnhof und Isar unter
einem Kartenpunkt. Beim Umschalten wird der laufende Player sauber
gestoppt, bevor der neue startet.

**Der Kamera-Proxy (`server/cameraProxy.mjs`) – der Kern von v2.2.**
Webcam-Betreiber sperren fremde Seiten auf drei Arten aus:

| Sperre | Symptom | Antwort der App |
|---|---|---|
| Hotlink-Schutz (Referer-Prüfung) | 403 statt Bild | Server holt es mit passendem `Referer` |
| Kein CORS-Header | Browser verweigert | Server liefert mit `Access-Control-Allow-Origin` |
| `X-Frame-Options` | iframe bleibt leer | Bild statt iframe, sonst Direktlink |

Ablauf im Browser: **erst direkt laden**, und nur wenn das fehlschlägt,
`/api/camera/status` prüfen und über den Proxy nachladen. Ohne Server
funktioniert also alles, was frei zugänglich ist; mit Server kommen die
gesperrten Kameras dazu. Bei HLS schreibt der Proxy die Playlist um, damit
auch die Segment-URLs über ihn laufen (inklusive `URI="…"`-Attributen).

**Sicherheit – wichtig, sonst wäre das ein offener Proxy:**
- **Erlaubnisliste**: nur Hosts, die in `data/cameras.json` vorkommen; beim
  Serverstart automatisch aufgebaut, erweiterbar über `CAMERA_HOSTS`.
  Subdomains erlaubter Hosts zählen mit.
- **Kein Zugriff ins lokale Netz** (SSRF-Schutz): Der Zielhost wird per DNS
  aufgelöst und gegen private, Loopback-, Link-Local- und
  Cloud-Metadaten-Bereiche geprüft – auch bei IPv6 und IPv4-gemappten
  Adressen. Das greift **zusätzlich** zur Erlaubnisliste.
- Nur `http(s)`, nur Bild- und Streamformate, max. 12 MB, 2 s Zwischenspeicher.
- Ein mitgeschickter `referer` wird nur übernommen, wenn er selbst auf einen
  erlaubten Host zeigt.

**Hinterlegte Quellen.** München und Hamburg nutzen die offiziellen
feratel-Bilder (`wtvpictfc.feratel.com/picture/…`) bzw. terra-hd für die
Isar-Kamera; Times Square, Venedig, Manhattan, Shibuya und SkylineWebcams
laufen über YouTube; GOES-East ist ein NOAA-Satellitenbild. Öffentliche
Streams können vom Betreiber geändert werden – ein Austausch ist eine
Zeile in `data/cameras.json`.

**Rechtlicher Hinweis.** Die Nutzungsbedingungen der Betreiber gelten
weiterhin. Das Anzeigen öffentlicher Kamerabilder im privaten Rahmen ist
üblich; für eine kommerzielle Nutzung oder Weiterverbreitung braucht es in
der Regel eine Erlaubnis.

### 1.5 KI-Assistent (neu in v2.0)

Button unten links („✨ Claude fragen"), öffnet ein Chatfenster.

**Was mitgeschickt wird** (`ai/locationContext.js`):
- Koordinaten und Kamerahöhe des aktuellen Blickpunkts
- Ortsname per Reverse-Geocoding (OpenStreetMap/Nominatim, kostenlos,
  Zoomstufe passt sich der Kamerahöhe an, Ergebnisse werden gecacht)
- das ausgewählte Objekt inkl. Wikipedia-Kurztext
- alle Objekte im Umkreis (Radius abhängig von der Zoomstufe, max. 15,
  nach Entfernung sortiert)

**Betriebsarten** (`config.js` → `ai.mode`):

- **`proxy`** (Standard): Browser → eigener Server → Claude API. Der Key
  liegt als Umgebungsvariable auf dem Server. `server/server.mjs`
  liefert zugleich die statischen Dateien aus, begrenzt Anfragegröße und
  Historie, erlaubt nur freigegebene Modelle und verhindert
  Verzeichnis-Ausbrüche.
- **`direct`**: Browser → `api.anthropic.com` mit dem Header
  `anthropic-dangerous-direct-browser-access: true`. Praktisch zum Testen,
  aber der Key ist im Browser sichtbar – nur lokal verwenden.

Beim Öffnen prüft die App per `/api/health`, ob der Proxy wirklich läuft.
Ist er nicht erreichbar, erscheint ein Einrichtungsfeld, in dem sich ein
Key direkt eintragen lässt (Speicherung nur im `localStorage` dieses
Browsers) – die App schaltet dann automatisch auf Direktzugriff um.

Antworten werden als Server-Sent-Events **gestreamt** und erscheinen
Wort für Wort. Laufende Anfragen lassen sich abbrechen. Modell einstellbar:
`claude-sonnet-5` (Standard), `claude-opus-5`, `claude-haiku-4-5-20251001`.

### 1.6 Live-Flugdaten (neu in v2.1)

Der Aircraft-Layer arbeitet in zwei Betriebsarten und wählt selbst:

**LIVE** – echte Flugzeuge über den mitgelieferten Server.
**DEMO** – Beispieldaten aus `data/aircraft.json`, wenn kein Server läuft.

Die Sidebar zeigt jederzeit, was gilt: `● LIVE` mit Quelle und Anzahl bzw.
`DEMO` mit dem Hinweis, wie man Live-Daten bekommt. Ein ⟳-Knopf löst einen
sofortigen Abruf aus.

**Anbieter** (`server/flightProviders.mjs`):

| | Flightradar24 | OpenSky Network |
|---|---|---|
| Endpunkt | `/api/live/flight-positions/full` | `/api/states/all` |
| Auth | `Authorization: Bearer`, `Accept-Version: v1` | OAuth2 Client Credentials, optional |
| Kosten | Abo, Abrechnung nach Credits | kostenlos (400 Abrufe/Tag anonym, 4.000 mit Konto) |
| Einheiten | Fuß, Knoten, ft/min | Meter, m/s, m/s |
| Extras | Route, Flugnummer, Registrierung, Typ | Herkunftsland |

Beide werden auf **ein einheitliches, metrisches Format** normalisiert
(Höhe in Metern, Geschwindigkeit in km/h). Die App weiß deshalb nicht,
welcher Anbieter dahintersteckt – ein dritter ließe sich mit einer Funktion
ergänzen.

**Warum serverseitig?** Weder Flightradar24 noch OpenSky senden CORS-Header;
ein `fetch()` direkt aus der Seite wird vom Browser blockiert. Zusätzlich
haben Token im Browser nichts zu suchen. Beides löst `server/server.mjs`.

**Umgang mit Guthaben und Kontingenten** – das ist der heikle Teil, weil bei
Flightradar24 jeder Abruf Geld kostet:

- Abgefragt wird nur der sichtbare Ausschnitt, begrenzt auf 40° × 40°
  **um den Blickpunkt**. Auch in der Weltansicht wird also nie die ganze
  Erde angefordert.
- Der Server cacht pro gerundeter Bounding-Box (halbes Grad) für 30 s (FR24)
  bzw. 12 s (OpenSky). Mehrere Tabs und schnelle Kameraschwenks lösen keine
  zusätzlichen Abrufe aus.
- Der Client drosselt zusätzlich (mind. 3 s zwischen Anfragen) und ruft nur
  beim Kamerastillstand (`moveEnd`) sowie im Intervall ab.
- Wird der Layer ausgeschaltet, stoppt das Polling vollständig.
- Am Boden stehende Flugzeuge werden herausgefiltert, der Rest nach Höhe
  sortiert und auf `FLIGHT_MAX` (Standard 400) gekürzt.

**Flüssige Bewegung trotz seltener Abrufe.** Zwischen zwei Abrufen schreibt
der Layer jede Position per Koppelnavigation aus Kurs, Geschwindigkeit und
Steig-/Sinkrate fort – so wie es Flightradar24 selbst macht. Wichtig dabei:
Live-Flugzeuge rechnen mit der **echten** vergangenen Zeit, nicht mit der
Simulationszeit. Der Zeitraffer-Regler der Timeline wirkt weiterhin auf
Schiffe, Satelliten und die Demo-Flugzeuge; Pause hält alles an.

**Abgleich der Objekte.** Bei jedem Abruf werden vorhandene Flugzeuge
aktualisiert, neue angelegt und solche, die 75 s nicht mehr geliefert wurden,
entfernt. Die Karenzzeit überbrückt Flugzeuge, die am Rand des Ausschnitts
kurz aus der Antwort fallen, ohne dass Symbole flackern.

**Flugzeugtypen.** Live-Daten liefern ICAO-Codes wie `B77W` oder `A20N`.
`js/aircraftTypes.js` übersetzt sie in Klarnamen ("Boeing 777-300ER") und
in Wikipedia-Artikeltitel, damit auch für Live-Flugzeuge ein Foto erscheint.
Zusätzlich steuert der Code die Symbolgröße (Großraum / Standard / klein).

### 1.7 Echte Satellitenbahnen (neu in v2.3)

Statt der bisherigen idealisierten Kreisbahn werden jetzt **echte
Bahndaten** verwendet: Two-Line Elements (TLE) von CelesTrak, propagiert
mit dem **SGP4**-Modell aus `satellite.js` (über CDN nachgeladen).

Der Weg von der TLE-Zeile zur Position:

```javascript
const satrec = satellite.twoline2satrec(line1, line2);
const posVel = satellite.propagate(satrec, date);
const gmst   = satellite.gstime(date);
const geo    = satellite.eciToGeodetic(posVel.position, gmst);
// geo.latitude/longitude in Radiant, geo.height in km
```

Prüfwerte aus dem Test: Die ISS erscheint auf **427 km Höhe** bei
**27.558 km/h** – beides sind die realen Werte.

Beim Anklicken wird die **Umlaufbahn als Ring** gezeichnet. Wichtiges
Detail dabei: Die Sternzeit (GMST) wird auf den Bezugszeitpunkt
eingefroren. Sonst klafft der Ring auf, weil sich die Erde während eines
Umlaufs weiterdreht – bei niedrigen Bahnen um rund 24°.

Live-Satelliten laufen in **echter Zeit** (ihre Bahn hängt an der
Systemuhr), nicht im Zeitraffer; die Propagation läuft gedrosselt
einmal pro Sekunde statt pro Bild.

Ohne laufenden Server (CelesTrak sendet keine CORS-Header) fällt die
Ebene auf die Beispieldaten mit vereinfachter Kreisbahn zurück – das
Detailpanel schreibt dann "Bahndaten: vereinfacht" statt
"CelesTrak (TLE, SGP4)".

### 1.8 Neue Ebenen: Erdbeben, Raketenstarts, Brände (neu in v2.3)

| Ebene | Quelle | Server nötig? | Besonderheit |
|---|---|---|---|
| 🌋 Erdbeben | USGS, letzte 24 h | **nein** (CORS-frei) | Fläche exponentiell zur Magnitude, Farbe nach Herdtiefe |
| 🚀 Raketenstarts | Launch Library 2, 30 Tage | ja | Farbe nach Betreiber |
| 🔥 Brände | NASA FIRMS (VIIRS) | ja + Schlüssel | Farbe/Größe nach Strahlungsleistung |

Drei Fallen, die beim Portieren wichtig waren:

- **Erdbeben:** Die Herdtiefe steckt in der DRITTEN Koordinate des
  GeoJSON, nicht in `properties`. Und die Ellipsenachsen müssen **feste
  Zahlen** bleiben – eine `CallbackProperty` lässt Cesium jede am Boden
  liegende Ellipse pro Bild neu vernetzen, was die Bildrate halbiert.
- **FIRMS:** `acq_time` ist nicht mit Nullen aufgefüllt – "45" bedeutet
  00:45 UTC. Die Konfidenz ist bei VIIRS kategorisch (l/n/h), bei MODIS
  numerisch. Und FIRMS meldet Fehler als HTML, nie als CSV – deshalb
  unterscheidet der Parser zwischen `null` (Fehler) und `[]` (keine Brände).
- **Raketenstarts:** Fehlen `pad.latitude`/`longitude`, steht die Position
  in `pad.location.coordinates` als String – in der Reihenfolge
  **"lon,lat"**, nicht umgekehrt.

### 1.9 Cockpit-Ansicht (neu in v2.3)

Ein Flugzeug auswählen, „🛩️ Mitfliegen" – die Kamera sitzt im Cockpit.
Escape oder der Knopf bringen zurück.

Der schwierige Teil ist nicht das Setzen der Kamera, sondern dass es
nicht ruckelt: Live-Flugdaten kommen alle 20–30 Sekunden, und jede neue
Meldung korrigiert die Position um hunderte Meter. Aus der Ich-Perspektive
wäre das ein Ruck oder sogar ein Sprung rückwärts.

Drei Mechanismen verhindern das (aus dem Referenzprojekt übernommen):

1. **Trägheitsanker** – Die Kamera folgt nicht der gemeldeten Position,
   sondern läuft eigenständig mit Kurs und Geschwindigkeit vorwärts.
2. **Korrekturbegrenzer** – Die Annäherung an die gemeldete Position ist
   auf `max(0,75 m/s, 22 % der Eigengeschwindigkeit)` gedeckelt. Dadurch
   ist die Korrektur langsamer als die Vorwärtsbewegung und damit für das
   Auge unsichtbar.
3. **Kurs-Begrenzer** – Der Blick dreht höchstens 28°/s.

Dazu kommt eine Mindest-Bodenfreiheit von 12 m und ein fester Blickwinkel
von −4° nach unten. Die Kamera wird mit einem explizit gebauten
Richtungs-/Oben-Vektorpaar gesetzt (`setView` mit `direction`/`up`),
nicht über `lookAt` – und aus `preUpdate`, nicht `preRender`, weil sonst
der Detailgrad der 3D-Kacheln in eine Endlosschleife geraten kann.

Ein Fehler, der beim Testen auffiel: Die Prüfung "gibt es die Entity
noch?" darf nicht gegen `viewer.entities` laufen. In diesem Projekt hat
jeder Layer seine **eigene** CustomDataSource, die Objekte liegen also
nicht in der Standardsammlung – die Prüfung fragt jetzt
`entity.entityCollection`.

### 1.10 Beobachtungszonen / Alarme (neu in v2.4)

Öffentliches Gotham-Feature ("Geofencing / Watchlist") nachgebaut, ohne
neue Datenquellen: Es werden ausschließlich die bereits geladenen,
öffentlichen Live-Positionen aller Layer genutzt.

**Bedienung.** Sidebar → „Beobachtung" → „🎯 Zone hinzufügen" → Klick auf
die Karte setzt den Mittelpunkt, danach werden Name und Radius abgefragt.
Die Zone erscheint als gelber Kreis mit Beschriftung auf dem Globus und
als Zeile in der Sidebar (mit „✕" zum Entfernen). Zonen werden in
`localStorage` gespeichert und überleben ein Neuladen der Seite.

**Prüfung.** `watchlist.check()` läuft alle 2 s aus der zentralen
Update-Schleife in `app.js`. Für jedes Objekt aus jedem eingeblendeten
Layer wird die Entfernung zum Zonenmittelpunkt per Haversine-Formel
berechnet; unter-/überschreitet sie den Radius, wird ein „betreten"-
bzw. „verlassen"-Ereignis ausgelöst. Der bisherige Zustand (innerhalb/
außerhalb) wird pro Zone-Objekt-Paar gemerkt, damit nur echte Übergänge
zählen, nicht jede Prüfung erneut.

**Alarme.** Jedes Ereignis erscheint in der Alarmliste der Sidebar
(Symbol, Objektname, Zone, Uhrzeit) – anklicken fliegt zum Objekt und
öffnet das Detailpanel. Verschwindet ein Objekt aus der Anzeige (Layer
ausgeblendet, AIS-/ADS-B-Timeout), wird das nicht als „verlassen"
gewertet, um keine künstlichen Alarme zu erzeugen.

Architektur: `js/watchlist.js` (Zonen, Geometrie, Zustand, Persistenz,
keine DOM-Abhängigkeit) und `js/watchlistPanel.js` (Sidebar-UI, Dialog-
Abfrage für Name/Radius). Das Anklicken des Globus für die Standortwahl
läuft über `WorldViewer.requestLocationPick()` (`viewer.js`) – ein
einmaliger Klick-Abfang, der der normalen Objektauswahl vorgezogen wird
und sie danach unverändert weiterlaufen lässt.

### 1.11 Bewegungsspuren / Track-Verlauf (neu in v2.5)

Weiteres öffentliches Gotham-Feature ("historische Objektspuren"):
Sidebar → „Ansicht" → „🧵 Spuren" blendet für Flugzeuge und Schiffe eine
kurze Spur der letzten Positionen ein – ähnlich der Track-Historie in
Gotham oder dem "Trail"-Feature von Flightradar24.

Standardmäßig aus (kostet sonst unnötig Leistung bei hunderten
Flugzeugen). Aktiviert, merkt sich jedes Objekt alle 4 Sekunden seine
Position (`BaseLayer._recordTrailPoint()`), höchstens 25 Punkte – ältere
fallen heraus. Die Spur ist eine `polyline`-Entity mit
`CallbackProperty`-Positionsliste in der Layerfarbe (Flugzeuge Amber,
Schiffe Grün). Layer, die das unterstützen, rufen im Konstruktor
`this.enableTrails(farbe)` auf; alle anderen (Satelliten, Kameras,
Infrastruktur, Erdbeben, ...) bleiben unberührt. Der globale Schalter
läuft über `LayerManager.setTrailsVisible()`, das nur Layer mit
`supportsTrails` anspricht.

### 1.12 Verknüpfungen / Link-Analyse (neu in v2.6)

Gothams zentrales "Object-Centric"-Feature nachgebaut: Im Detailpanel
erscheint unterhalb der Datenfelder ein Abschnitt „🔗 Verknüpfungen" mit
Objekten, die zum ausgewählten Objekt in Beziehung stehen. Anklicken
springt zum verknüpften Objekt (wie bei den Beobachtungs-Alarmen).

Zwei Arten von Verknüpfungen, beide aus bereits geladenen Daten:

1. **Gemeinsame Attribute** – je nach Typ ein anderes Merkmal: gleiche
   Airline (Flugzeuge), gleicher Schiffstyp/gleiche Flagge (Schiffe),
   gleicher Betreiber (Satelliten/Raketenstarts), gleiche Kategorie
   (Infrastruktur). Definiert in `ATTRIBUTE_FIELDS` (`linkAnalysis.js`).
2. **Räumliche Nähe** – alle anderen Objekte (typübergreifend) im Umkreis
   von 30 km, nach Entfernung sortiert.

Beide Listen werden zusammengeführt und auf 8 Einträge begrenzt. Die
Berechnung läuft nur beim Objektwechsel (nicht bei jedem Detailpanel-
Refresh), weil sie alle Objekte aller Layer durchsucht – bei tausenden
Objekten spürbar, aber für einen einzelnen Klick unproblematisch.

`haversineKm()` (Entfernungsformel) wurde dafür aus `watchlist.js` nach
`dataManager.js` verschoben, damit Beobachtungszonen und Link-Analyse
dieselbe Funktion nutzen statt sie zu duplizieren.

### 1.13 Objekt-Dossier (neu in v2.7)

Letzter der ursprünglich skizzierten Gotham-Bausteine: „📄 Dossier" im
Detailpanel lädt eine Textdatei mit einer Zusammenfassung des
ausgewählten Objekts herunter – Datenfelder, Wikipedia-Kurzbeschreibung
(falls geladen) und die Verknüpfungen aus 1.12, in einem Aufwasch.

`js/dossier.js` formatiert nur bereits vorhandene Daten (keine neue
Quelle, kein Server): `buildDossierText()` baut den Text,
`downloadTextFile()` löst den Download über einen `Blob` + unsichtbaren
`<a download>`-Link aus – dieselbe Technik, mit der auch Share-Links
(`shareLink.js`) ohne Server auskommen. Der Dateiname wird aus dem
Objektnamen und dem Erstellungsdatum abgeleitet
(`dossier-<name>-<datum>.txt`).

### 1.14 Kategorien-Konsole, Panel-Rails, POWER-UP-Panel (UI-Overhaul, neu in v2.8)

Drei zusammenhängende UI-Bausteine aus dem Epic WEB-81 (Übernahme aus
„God's Eye View", MIT, siehe `docs/WEB-81-gev-features-ui-overhaul.md`):

**Kategorien-Konsole.** Die Sidebar gruppiert alle Layer-Schalter in sechs
Kategorien (Bewegung, Kameras, Infrastruktur, Ereignisse, Wetter,
Werkzeuge) statt einer flachen Liste. `js/layerCategories.js` ist die
einzige Quelle der Zuordnung: `categoryForLayer(layerId)` liefert die
Kategorie-ID, unbekannte Layer landen auf `"tools"` als Notbremse, damit
ein neuer Layer ohne Eintrag die Konsole nicht unsichtbar macht. **Wichtige
Lektion aus der Integration:** zwei Layer (GOES-Wolken, Weltwetter-Raster)
wurden parallel zu diesem Umbau gebaut und kannten die Zuordnung nicht –
sie fielen zunächst auf den Werkzeuge-Fallback zurück. Wer einen Layer
registriert, trägt ihn im selben PR hier ein.

**Andockbare Panel-Rails.** `js/panelDock.js` beobachtet die
`hidden`-Klasse der bestehenden Panels (Detail, Verknüpfungs-Graph, KI) per
`MutationObserver` und übernimmt Position, Größe und Stapel-Reihenfolge in
der rechten Rail (`#panel-rail-right`) – die Panels selbst bleiben
strukturell unverändert (gleiche IDs, gleiche `show()`/`hide()`-Logik).
Zustand (Position/Größe je Panel) persistiert in `localStorage`
(`wv.panelDock.v1`). Unterhalb von 821px Breite (derselbe Mobile-Breakpoint
wie die PWA aus WEB-60) bleiben Drag/Resize deaktiviert, da dort weiterhin
die Vollbild-Darstellung gilt. Escape schließt das oberste Panel – außer im
Cockpit-Modus, der Escape bereits für „Kamera verlassen" nutzt.

**Kontakte-Roster.** `js/contactsRoster.js` berechnet aus allen *aktiven*
Layern die Objekte in einem Radius um das Kamerazentrum
(`worldViewer.getCameraPosition()`), jeweils mit Entfernung und Peilung über
eine Haversine-Rechnung; deaktivierte Layer bleiben außen vor. Der Radius ist
im Panel einstellbar (Standard 250 km, 10–5000 km).
`js/contactsPanel.js` ist die Panel-UI: sie hängt als `dock-panel` in der
Rail aus `panelDock.js` und ist dort wie Detail-, Graph- und KI-Panel
verschieb- und skalierbar. Die Liste wird gedrosselt neu aufgebaut, nicht pro
Frame. Dass bei engem Radius über offenem Meer null Kontakte erscheinen, ist
der erwartete Fall und kein Fehler.

**POWER-UP-Panel.** `js/keyStatusPanel.js` zeigt im Panel „Schlüssel &
Dienste" für jeden Dienst aus `server/keyRegistry.mjs` den Status
(`set`/`external`/`missing`), was er freischaltet, den Kostenhinweis und
einen Registrierungslink. `keyRegistry.mjs` ist bewusst die **einzige**
Quelle für zwei Verbraucher (`npm run doctor` im Terminal und `/api/keys`
im Browser) und gibt grundsätzlich nur Status-Strings zurück, nie den
Wert einer Umgebungsvariable. Dieselbe Registry treibt die
Schlüssel-Badges an betroffenen Layern in der Kategorien-Konsole
(`UI._renderKeyBadges()`) – ein Dienst kann optional `layers`/`layerImpact`
angeben, damit die Konsole erklärt, warum ein Layer ohne Key eingeschränkt
bleibt (z.B. „Brände" ohne `FIRMS_MAP_KEY`).

### 1.15 Tastatur-Parität + Kurzreferenz (neu in v2.8)

Vorher hatte jedes Modul (`app.js`, `ui.js`, `drawToolsPanel.js`,
`ai/assistant.js`) einen eigenen `keydown`-Listener. `js/keyboardShortcuts.js`
ist jetzt die einzige Stelle: Module registrieren Kürzel über
`register({key, label, category, handler})`, Escape läuft separat über
`registerEscapeStep(order, handler)` als Kette (Panel schließen vor
Tracking beenden vor Cockpit verlassen – die erste Stufe, die `true`
liefert, gewinnt). Kürzel feuern nicht, während ein Eingabefeld fokussiert
ist – außer Escape, bewusst, damit sich auch aus einem Textfeld heraus das
nächste Panel schließen lässt. Schema in Parität zu GEV: `1`–`7`
Sensorstile, `H` Tactical-HUD, `D` Erkennungs-Overlay, `C` Cockpit, `` ` ``
FPS-Zähler, `?` Kurzreferenz.

`js/keyboardReference.js` zeigt die Kurzreferenz als eigenes Overlay (baut
sein Markup selbst, wie `hud.js` seinen Canvas) und liest dafür
`shortcuts.list()` aus – die Liste ist also immer exakt das, was tatsächlich
registriert ist, keine separat gepflegte Dokumentation im Code.

### 1.16 Szenen-Regisseur (neu in v2.8)

`js/sceneDirector.js` nimmt Kamerapositionen als „Stationen" einer Fahrt
auf und fliegt sie weich ab – über Cesiums eigenes `camera.flyTo()` statt
einer eigenen Spline-Berechnung, damit dieselbe Ein-/Ausschwing-Bewegung
wie der Rest der App entsteht. Die Flugdauer zwischen zwei Stationen
(`legDurationFor()`) skaliert mit dem Abstand, begrenzt auf 1,5–6 Sekunden.
`js/sceneDirectorPanel.js` ist die zugehörige Sidebar-UI; Speichern/Laden
nutzt denselben URL-Mechanismus wie der normale Share-Link
(`shareLink.js`), kein eigenes Dateiformat. Der Routen-Flythrough (eine
bereits berechnete OSRM-Route aus `routeTool.js` als Stationenfolge in
Fahrtrichtung, ohne Haltezeit) ist ein Spezialfall derselben Maschinerie.

### 1.17 3D-Flugzeugmodelle (neu in v2.8)

`js/aircraftModels.js` wechselt ab einer Entfernungsschwelle vom
2D-Glyph auf ein echtes 3D-Modell – für genau fünf Klassen, unverändert aus
dem GEV-„Hangar" übernommen: Boeing 787, ATR-72, Citation, Bell 206, MQ-9
(`MODEL_HEADING_OFFSET_DEG = 180`, weil die GLB-Dateien mit der Nase
Richtung lokales −X gebacken sind). Nicht jeder ICAO-Typcode bekommt ein
eigenes Modell – bewusste Entscheidung, lieber ehrlich fünf Klassen
abzudecken als mit einem falschen Modell einen 737 als 787 zu zeigen. Alle
anderen Typen bleiben beim Glyph. Lizenzen der einzelnen GLB-Dateien (alle
CC BY 4.0, Sketchfab) stehen in DATENQUELLEN.md.

### 1.18 GOES-Wolken & Weltwetter-Raster (neu in v2.8)

Zwei neue Wetter-Layer, beide ohne Schlüssel und ohne Server-Proxy (direkter
Browser-Zugriff, da CORS-offen):

- **`js/layers/GoesCloudLayer.js`** – Infrarot-Wolkenbild von NASA GIBS
  (GOES-Ost/-West, Band 13, „Clean Longwave Infrared", funktioniert auch
  nachts). Abdeckung ist geostationär auf Amerika/Pazifik/Atlantik
  beschränkt – Europa/Asien/Afrika bleiben absichtlich leer, das ist kein
  Fehler. Kein Zeit-Parameter nötig: GIBS löst „default" serverseitig auf
  das neueste Bild auf, der tatsächliche Zeitstempel kommt per
  `layer-time-actual`-Header zurück.
- **`js/layers/WorldWeatherLayer.js`** – weltweites Temperatur-Gradnetz
  (Standard 15°-Schritt, 264 Zellen) über die Open-Meteo Forecast API,
  dieselbe API wie `WeatherLayer.js` (v2.x, kuratierte Städte) und
  `AQILayer.js`. **Wichtig:** Open-Meteo zählt bei Sammelabfragen jede
  Koordinate als eigenen Aufruf gegen das Tageskontingent (~10.000/Tag
  Fair Use) – das begrenzt direkt, wie fein das Raster werden darf. Ein
  10°-Raster (576 Zellen) würde das Limit im Einzelbetrieb schon
  sprengen, daher bleibt 15° der Standard.

### 1.19 Infrastruktur in Masse (neu in v2.8, mit Einschränkung)

`js/layers/InfrastructureLayer.js` und `js/layers/CableLayer.js` laden
zusätzlich zu den handkuratierten Einträgen (`data/infrastructure.json`,
`data/cables.json`) drei Massendatensätze (Rechenzentren, Dämme, Seekabel)
und bündeln sie über `BaseLayer.enableClustering()` – eine generische
Clustering-Hilfsmethode, die Cesiums `dataSource.clustering` aktiviert und
nah beieinanderliegende Objekte zu einem Symbol mit Anzahl zusammenfasst.
Quelle der Massendaten: OpenStreetMap via Overpass API (ODbL), erzeugt
durch `scripts/build-infrastructure-mass.mjs` (`npm run
build:infrastructure-mass`) – **ausdrücklich nicht** TeleGeography für
Seekabel, deren Submarine Cable Map unter CC BY-NC-SA 3.0 steht.

**Behoben mit WEB-142:** Die drei generierten JSON-Dateien
(`data/datacenters.json` mit 4.813 Objekten, `data/dams.json` mit 16.630,
`data/cables-osm.json` mit 195) sind eingecheckt. Vorher fehlten sie im
Repository und ein frischer Checkout lud sie mit 404 — dank
`loadJSON()`-Fehlertoleranz ohne Absturz, aber auch ohne die Masse, für die
das Clustering gebaut wurde. Offene Restarbeit: WEB-151 erzeugt die
Dammdaten mit einem Wikidata-Filter neu, weil 16.630 Treffer auch
Kleinstwehre enthalten.

### 1.20 Sichtbarer Layer-Status (neu in v2.9)

Vorher landete jeder Ladefehler nur in der Browser-Konsole – für Nutzende
war „Quelle kaputt" nicht von „gerade nichts los" zu unterscheiden, beides
zeigte schlicht *0 Objekte*. Jetzt hat jeder Layer einen sichtbaren Zustand:
**Laden / Fehler / leer / Schlüssel fehlt** (WEB-159).

- Zustand als **Status-Punkt** direkt am Layer-Schalter, mit Zusatztext im
  `title`-Attribut (`layer.status` + `layer.statusDetail` in `BaseLayer`).
- Fehlgeschlagene und bewusst ausgelassene Quellen melden sich zusätzlich
  als kurzlebiger Hinweis unten links (`js/statusToast.js`): kein Modal,
  keine Blockade der Karte, Auto-Ausblenden nach 9 s (Fehler) bzw. 5 s
  (Info), maximal 4 gleichzeitig, identische Meldungen innerhalb von 30 s
  werden zusammengefasst.
- „Schlüssel fehlt" ist bewusst ein eigener Zustand und kein Fehler – der
  Layer ist dann nicht defekt, sondern nur nicht freigeschaltet.

### 1.21 Zentrale Timer-Registrierung (neu in v2.9)

Jeder Layer hielt früher seinen eigenen `setInterval` für das Nachladen.
Bei 32 Layern liefen damit 32 unabhängige Timer weiter – auch für
ausgeblendete Layer und auch in einem Hintergrund-Tab. Seit WEB-160 läuft
das Polling über `LayerManager`/`BaseLayer`:

- Ein Layer meldet sein Intervall über
  `layerManager.registerTimer(layerId, name, intervalMs, callback)` an,
  statt selbst ein `setInterval` zu starten. `name` erlaubt mehrere Timer
  je Layer.
- Der native Timer läuft **nur, wenn der Tab sichtbar und der Layer
  eingeblendet ist** – sonst wird er angehalten, nicht nur ignoriert. Das
  spart echte Abrufe bei Quellen, die pro Anfrage abrechnen (Open-Meteo
  zählt z. B. jede Koordinate einzeln, nicht jeden HTTP-Aufruf).
- Bei Rückkehr in den Tab gibt es sofort einen Nachlade-Tick, statt auf das
  nächste Intervall zu warten – sonst stünden nach dem Wechsel veraltete
  Positionen auf der Karte.
- Alle 32 Layer sind umgestellt; `BaseLayer` kennt dafür
  `this.layerManager`, gesetzt von `LayerManager.register()`.

### 1.22 Sitzung sichern und wiederherstellen (neu in v2.9)

Ein Reload (F5) brachte früher die Standardansicht zurück – bei 32 Layern
hieß das, sich die Auswahl von Hand neu zusammenzuklicken. Seit WEB-161
speichert `js/session.js` **aktive Layer, Kameraposition und offene Panels**
unter `wv-session-v1` in `localStorage` (entprellt, 1,5 s nach der letzten
Änderung).

Kodiert wird mit derselben Logik wie bei den Share-Links
(`js/shareLink.js`), nur ohne URL-/Base64-Umweg, weil `localStorage`
normales JSON kann. **Ein Share-Link in der Adresszeile hat beim Start
immer Vorrang** vor der gespeicherten Sitzung – sonst würde ein geteilter
Link beim Empfänger von dessen eigener letzter Sitzung überschrieben.

### 1.23 Routenplanung Fuß/Rad/Auto (neu in v2.9)

Start- und Zielpunkt je per Klick auf den Globus, danach wird die Route
automatisch beim öffentlichen **OSRM-Demo-Server** abgefragt (WEB-71,
`js/routeTool.js`). Ergebnis ist Linie + Distanz/Dauer, **keine**
Turn-by-Turn-Navigation. Eine berechnete Strecke lässt sich als Flythrough
im Szenen-Regisseur abspielen.

Bewusst ein eigenes Modul neben den lokalen Zeichen-/Mess-Werkzeugen
(`js/drawTools.js`), weil es als einziges davon einen externen Dienst
braucht. Der Demo-Server ist laut Betreiber nur für Tests/geringes Volumen
gedacht und hat keine SLA-Garantie – der Hinweis steht sichtbar im
Sidebar-Abschnitt.

### 1.24 Kamera-Sichtfeld-Kegel (neu in v2.9)

Beim Öffnen des Detailpanels einer Kamera mit hinterlegtem `heading` wird
ein Sektor aus Blickrichtung, Öffnungswinkel und Reichweite auf den Globus
gezeichnet (WEB-72, `js/cameraViewshed.js`) – technisch analog zu den
Geofence-Kreisen, nur als Kreissektor statt Vollkreis.

Keine neue Datenquelle: `heading`, `fovDegrees` (Standard 60°) und
`rangeMeters` (Standard 300 m) sind optionale Felder in
`data/cameras.json`, derzeit bei 3 der 17 Kameras gesetzt. Fehlt `heading`,
bleibt die Kamera ohne Kegel.

> **Geometrie, keine Sichtbarkeitsanalyse.** Der Kegel berücksichtigt kein
> Gelände und keine Gebäude – ein Hügel in der Blickachse wird nicht
> abgeschattet.

### 1.25 Niederschlagsradar-Overlay (neu in v2.9)

Flächendeckende Radaranimation der letzten ~2 Stunden als Cesium-
`ImageryLayer` über RainViewer (WEB-67, `js/layers/RadarLayer.js`), mit
Zeitschieberegler und Play/Pause in der Sidebar. Ergänzt den punktweisen
`weather`-Layer, ersetzt ihn nicht – schlägt der Radarabruf fehl, bleibt
`weather` unberührt nutzbar.

### 1.26 Leihräder/E-Scooter (neu in v2.9)

Stationen mit freien Rädern und Plätzen aus **GBFS**-Feeds (WEB-70,
`js/layers/BikeShareLayer.js`), der offenen Standardschnittstelle der
Sharing-Anbieter. Die abgefragten Systeme stehen in
`data/bikeshare-systems.json` (9 Einträge); kein Schlüssel nötig.

### 1.27 Strahlungsmessnetz und Tsunami-Warnungen (neu in v2.9)

Zwei keyless Layer aus der R4-Recherche:

- **☢️ Strahlungsmessnetz** (WEB-154) – Messwerte freiwilliger Sensoren
  über die Safecast-API (CC0), serverseitig über `/api/radiation`.
- **🌊 Tsunami-Warnungen** (WEB-155) – aktive Warnungen aus den
  Atom-Feeds von NOAA PTWC und NTWC, über `/api/tsunami`.

### 1.28 Offline-fähige PWA (neu in v2.9)

Die App ist installierbar und startet offline (WEB-60, Phase 1):
`manifest.json` plus ein Service Worker (`sw.js`) mit
**stale-while-revalidate** für alle Assets desselben Origin. Neue
`js/`-Module landen damit beim ersten Online-Besuch automatisch im Cache,
ohne dass eine Dateiliste gepflegt werden muss.

Bewusst ausgenommen: `/api/*` (Live-Daten werden nie aus dem Cache
beantwortet) und alles von fremden Origins (Cesium-/vis-network-CDN,
Kamera- und Flugdaten-Proxys). Die Kern-Shell wird einzeln statt per
`addAll()` vorab geladen, damit eine fehlende Datei – etwa das lokal
anzulegende `config.js` – die Installation nicht abbricht.

### 1.29 Weitere Analysewerkzeuge

Vor v2.9 entstanden, in dieser Datei bisher nicht beschrieben:

- **✏️ Zeichnen & Messen** (`js/drawTools.js`) – Punkte, Freihand-Linien,
  Grenzen und Distanzmessungen rein mit Cesium-Bordmitteln; Geometrien
  liegen in `localStorage` und lassen sich als GeoJSON exportieren.
- **🕸️ Graph-Ansicht** (`js/graphView.js`) – zeigt das ausgewählte Objekt
  und seine Verknüpfungen als interaktiven Node-Graph statt als Liste.
  Nutzt vis-network (CDN, Apache-2.0), rein clientseitig.
- **🕰️ Zeitleisten-Replay** (`js/historyReplay.js`) – blendet Erdbeben,
  Brände und Raketenstarts nach ihrem echten Zeitstempel nacheinander ein,
  mit Play/Pause/Scrub. Läuft unabhängig von der Simulations-Timeline
  (`js/timeline.js`), die den Zeitraffer für bewegte Objekte steuert.

## 2. Architektur

```
index.html ──lädt──► config.js (global) ──dann──► js/app.js (ES6-Modul)
                     sw.js + manifest.json   Service Worker / PWA-Shell

app.js
 ├── WorldViewer (viewer.js)
 │     └── BasemapManager (basemaps.js)   Karten, Gelände, 3D-Gebäude
 ├── LayerManager (layerManager.js)        32 Layer + zentrale Timer (WEB-160)
 │     ├── AircraftLayer                  Live-Daten + Koppelnavigation
 │     │     ├── flightData.js            Abruf über /api/flights
 │     │     ├── aircraftTypes.js         ICAO-Code → Name, Wikipedia
 │     │     └── aircraftModels.js        3D-Modelle ab Zoomschwelle
 │     ├── SatelliteLayer                 CelesTrak-TLE + SGP4 (satellite.js)
 │     ├── LaunchLayer → launchAscent.js  rekonstruierte Aufstiegsbahn
 │     ├── ShipLayer → shipData.js        AIS über /api/ships
 │     ├── CameraLayer → cameraViewshed.js  Sichtfeld-Kegel (WEB-72)
 │     ├── StreetLevelLayer → streetLevelPanel.js   Mapillary
 │     ├── DeepSpace (deepSpace.js), cometOrbits.js
 │     └── weitere Layer (js/layers/*)    je Layer eine CustomDataSource
 │           └── dataManager.js           JSON, Datenformat, Geo-Mathematik
 ├── UI (ui.js)                           Sidebar, Detailpanel, Status-Punkte
 │     ├── layerCategories.js       Kategorie-Zuordnung der Layer-Konsole
 │     ├── panelDock.js             andockbare Panel-Rail rechts
 │     ├── keyStatusPanel.js        POWER-UP-Panel ← /api/keys
 │     ├── keyboardShortcuts.js  +  keyboardReference.js  (Taste „?")
 │     ├── statusToast.js          Lade-/Fehlerhinweise unten links (WEB-159)
 │     ├── hud.js, cockpit.js, sensorStyles.js, fpsCounter.js
 │     ├── imageProvider.js → illustrations.js
 │     └── streamPlayer.js          Livebild, ggf. über /api/camera
 ├── Analyse & Werkzeuge
 │     ├── search.js               Objekte, Städte, Koordinaten
 │     ├── timeline.js             Zeitraffer der Simulation
 │     ├── historyReplay.js        echte historische Ereignisse
 │     ├── watchlist.js + watchlistPanel.js     Geofence-Alarme
 │     ├── linkAnalysis.js + graphView.js       Verknüpfungen, Node-Graph
 │     ├── drawTools.js + drawToolsPanel.js     Zeichnen & Messen
 │     ├── routeTool.js            Route Fuß/Rad/Auto über OSRM (WEB-71)
 │     ├── contactsRoster.js + contactsPanel.js Objekte im Radius
 │     ├── sceneDirector.js + sceneDirectorPanel.js  Kamerafahrten
 │     ├── anomalyAlerts.js, dossier.js, heatmap (layers/)
 │     └── shareLink.js  ←→  session.js   Teilen bzw. Autosave (WEB-161)
 └── Assistant (ai/assistant.js)
       ├── claudeClient.js       API-Anbindung + SSE-Streaming
       └── locationContext.js    Ortskontext + Reverse-Geocoding
```

**Server** (`server/`, Node 18+, keine npm-Pakete):

```
server.mjs                 Webserver + Routing aller /api/*-Endpunkte
 ├── loadEnv.mjs           .env lesen – MUSS erster Import sein (siehe unten)
 ├── keyRegistry.mjs       einzige Liste der optionalen Schlüssel
 │                         → /api/keys (POWER-UP) und doctor.mjs
 ├── dataProxies.mjs       gemeinsamer Cache + Serve-Stale für die
 │                         meisten Fremdquellen
 ├── flightProviders.mjs   Flightradar24 / OpenSky / adsb.lol
 ├── aisStream.mjs         AIS über WebSocket (eigener RFC-6455-Client)
 ├── cameraProxy.mjs       Webcam-Bilder trotz Hotlink-Sperre, mit
 │                         Erlaubnisliste + SSRF-Schutz
 ├── gtfsRealtime.mjs      eigener Protobuf-Decoder für GTFS-Realtime
 ├── kmz.mjs               eigener ZIP-Reader für die NHC-Vorhersagekegel
 ├── volcanoLabels.mjs     deutsche GVP-Bezeichnungen
 ├── deepSpace.mjs         Deep-Space-Missionen (JPL Horizons)
 ├── doctor.mjs            "npm run doctor" – Setup-Diagnose
 └── claude-proxy.mjs      alter Startbefehl, leitet auf server.mjs
```

**Warum eigene Decoder für Protobuf und ZIP?** Das Projekt kommt bewusst
ohne npm-Pakete aus (`dependencies: {}`). GTFS-Realtime ist
Protobuf-kodiert und die NHC-Vorhersagekegel gibt es nur als KMZ
(gezipptes KML) – beides muss ohnehin serverseitig verarbeitet werden, weil
die Feeds kein CORS senden. Protobuf braucht dafür nur Varints und
Length-Delimited-Felder, ZIP kann Node über `zlib` selbst auspacken.

**Einheitliches Datenformat** (`dataManager.normalizeRecord`):

```javascript
{
  id, type, name,
  position: { latitude, longitude, altitude },
  heading, speed, timestamp,
  metadata: { ...alle Originalfelder }
}
```

### Wichtige Entwurfsentscheidungen

- **Esri World Imagery statt Google Maps als Standard.** Liefert dieselbe
  Art hochaufgelöster Satellitenbilder, braucht aber keinen Key und keine
  Abrechnung. Google bleibt optional für die fotorealistischen 3D-Gebäude –
  das ist der Teil, den Esri nicht abdeckt.
- **Wikipedia statt Bilddatenbank.** CORS-frei, kostenlos, liefert zu fast
  allen realen Objekten ein brauchbares Foto plus Beschreibungstext.
- **Illustration als garantierter Boden.** Damit ist die Zusage „jedes
  Objekt hat ein Bild" unabhängig von Netz und Fremddiensten erfüllt.
- **Flugdaten über den eigenen Server.** Nicht aus Bequemlichkeit, sondern
  weil es technisch nicht anders geht (kein CORS) und weil ein bezahltes
  FR24-Token nicht in den Browser gehört. Der Server ist zugleich die
  Stelle, an der sich Caching und Obergrenzen zentral durchsetzen lassen.
- **Kamera-Proxy statt Aufgeben.** Ein blockiertes Kamerabild ließe sich
  auch einfach als „nicht verfügbar" abtun. Der Proxy löst es sauber –
  aber nur mit Erlaubnisliste und SSRF-Schutz, weil ein ungesicherter
  Proxy ein ernstes Sicherheitsloch wäre.
- **Direkt zuerst, Proxy nur im Notfall.** So bleibt die App ohne Server
  voll benutzbar, und der Server wird nicht für Bilder belastet, die der
  Browser selbst laden darf.
- **Zwei Anbieter hinter einer Schnittstelle.** Flightradar24 liefert die
  besseren Daten, kostet aber Geld; OpenSky ist kostenlos und reicht für
  Position, Höhe und Kurs. Weil beide auf dasselbe Format normalisiert
  werden, ist der Wechsel eine Umgebungsvariable.
- **Proxy als Standard für die KI.** Ein API-Key im Browser-Quelltext wäre
  für jeden Besucher auslesbar; der Proxy kostet 150 Zeilen und löst das.
- **Aktive Verfügbarkeitsprüfung** statt stiller Annahme: Die App sagt vorab,
  ob der KI-Zugang steht, statt erst beim Absenden zu scheitern.
- **`CallbackProperty` für bewegte Objekte:** Cesium fragt die Position pro
  Frame ab; die Simulation schreibt nur ins Datenobjekt.
- **Eine `CustomDataSource` pro Layer:** Ein-/Ausblenden ist ein Flag.
- **Fehlertoleranz überall:** `Promise.allSettled` beim Laden, Timeouts bei
  Fremddiensten, Fallback-Kette bei Karten, Bildern und Streams.
- **Null npm-Abhängigkeiten, auch wenn es wehtut.** `dependencies` ist leer
  und bleibt leer. Dafür liegen ein Protobuf-Decoder (`gtfsRealtime.mjs`),
  ein ZIP-Reader (`kmz.mjs`) und ein WebSocket-Client (`aisStream.mjs`)
  selbstgeschrieben im Repo – jeweils beschränkt auf das, was die konkrete
  Quelle braucht. Der Preis ist bewusst bezahlt: kein Build-Schritt, kein
  Lockfile, keine Lieferketten-Angriffsfläche.
- **Fehlender Schlüssel ist kein Fehler.** „Schlüssel fehlt" ist ein
  eigener Layer-Zustand neben „Fehler" (WEB-159). Ein nicht
  freigeschalteter Layer sieht sonst wie ein defekter aus, und Nutzende
  suchen den Bug an der falschen Stelle.
- **Timer gehören dem Manager, nicht dem Layer** (WEB-160). Ein Layer, der
  seinen eigenen `setInterval` hält, pollt auch unsichtbar weiter. Bei 32
  Layern und Quellen, die pro Koordinate abrechnen, ist das echtes Geld.
- **Eine Quelle für den Schlüssel-Status.** `keyRegistry.mjs` beliefert
  Terminal (`npm run doctor`) und Browser (`/api/keys`) gemeinsam, damit
  beide nie auseinanderlaufen – und gibt dabei nie einen Wert zurück, nur
  ob gesetzt und woher.

## 3. Starten

```bash
# ohne Server: Demo-Flugzeuge, kein KI-Assistent
python3 -m http.server 8000

# mit Server (Node 18+, keine npm-Pakete nötig)
node server/server.mjs                     # Live-Flüge via OpenSky (kostenlos)

export FR24_API_TOKEN="…"                  # oder via Flightradar24 (Abo)
export ANTHROPIC_API_KEY="sk-ant-…"        # optional: KI-Assistent
node server/server.mjs
```

**Umgebungsvariablen.** Alle sind optional – ohne sie läuft die App in
einem reduzierten Modus. Vollständig kommentiert in `.env.example`;
`npm run doctor` sagt, was gefunden wurde (nie die Werte selbst).

| Zweck | Variablen |
|---|---|
| Flugdaten | `FLIGHT_PROVIDER` (fr24\|opensky), `FR24_API_TOKEN`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`, `MILITARY_FLIGHT_CACHE_MS` |
| Schiffe (AIS) | `AISSTREAM_API_KEY`, `AISSTREAM_BBOX`, `AISSTREAM_MAX_SHIPS` |
| KI-Assistent | `ANTHROPIC_API_KEY` |
| Karten/3D | `CESIUM_ION_TOKEN`, `GOOGLE_MAPS_API_KEY` |
| Ereignisse | `FIRMS_MAP_KEY` (Brände), `NASA_API_KEY` (Asteroiden), `LL2_API_TOKEN` (Raketenstarts) |
| Verkehr/Kameras | `TOMTOM_API_KEY`, `TOMTOM_DAILY_BUDGET`, `TFL_APP_KEY`, `CCTV_CALTRANS_DISTRICTS`, `CAMERA_HOSTS` |
| Street-Level | `MAPILLARY_TOKEN` |
| Betrieb | `PORT`, `FLIGHT_CACHE_MS`, `FLIGHT_MAX` |

`server/loadEnv.mjs` liest die `.env` ohne npm-Abhängigkeit und **muss in
`server.mjs` der erste Import sein**: ES-Module werden vollständig
ausgewertet, bevor der Rumpf des importierenden Moduls läuft – nur so
stehen die Werte bereit, wenn die Konstanten der anderen Module gelesen
werden. Bereits gesetzte Umgebungsvariablen behalten Vorrang, damit ein
Hosting-Secret eine lokale `.env` nicht überschreibt.

→ <http://localhost:8000>. Für normales Webhosting genügt es, den Ordner
hochzuladen (dann ohne KI, bzw. mit dem Proxy auf einem Node-Host).

## 4. Erweitern

**Neuer Layer**

```javascript
// js/layers/TrainLayer.js
import { BaseLayer } from "./BaseLayer.js";

export class TrainLayer extends BaseLayer {
    constructor(worldViewer) {
        super(worldViewer, {
            id: "trains", name: "Trains", icon: "🚆",
            type: "train", dataUrl: "./data/trains.json"
        });
    }
    createEntity(obj) { /* eigenes Symbol */ }
    update(simDeltaSeconds) { /* optionale Bewegung */ }
}
```

Registrieren in `app.js`. Für das Detailpanel einen Eintrag in
`DETAIL_SCHEMAS` (`ui.js`) ergänzen, für die Illustration einen Eintrag in
`SILHOUETTES` und `PALETTE` (`illustrations.js`).

Soll der Layer periodisch nachladen, **nicht** selbst `setInterval`
aufrufen, sondern das Intervall zentral anmelden (WEB-160, siehe 1.21):

```javascript
this.layerManager.registerTimer("trains", "refresh", 30_000, () => this.load());
```

Nur so wird der Timer angehalten, wenn der Tab oder der Layer unsichtbar
ist – sonst zahlt man Abrufe für etwas, das niemand sieht.

**Live-Daten anbinden.** Alle ursprünglich hier als offen geführten Punkte
sind inzwischen umgesetzt und dienen als Vorlage:

| Vorhaben | Umgesetzt als |
|---|---|
| Flugzeuge live | `flightData.js` → `/api/flights`, drei Anbieter hinter einer Schnittstelle |
| Schiffe live | AIS über Server-WebSocket (`server/aisStream.mjs`), Client pollt `/api/ships` |
| Echte Satellitenbahnen | CelesTrak-TLE + SGP4 aus `satellite.js` (`SatelliteLayer.js`) |
| Historische Daten | `js/historyReplay.js` – eigenes Modul statt eines `Timeline`-Modus |

Braucht die Quelle einen Schlüssel oder sendet sie kein CORS, gehört der
Abruf hinter einen Proxy in `server/dataProxies.mjs` (gemeinsamer Cache +
Serve-Stale) und der Schlüssel in `server/keyRegistry.mjs`, damit
`npm run doctor` und das POWER-UP-Panel ihn mitzählen.

## 5. Bekannte Grenzen

- **Flugzeuge und Schiffe sind live**, sofern der Server läuft und ein
  Anbieter/Key konfiguriert ist (Flugzeuge: OpenSky/Flightradar24;
  Schiffe: AISSTREAM_API_KEY) – sonst Demo-Daten mit realistischen, aber
  erfundenen Startwerten (die Sidebar zeigt den jeweiligen Modus an; der
  System-Prompt der KI weist auf die Unsicherheit hin).
- Bei AIS-Schiffen liefert AISStream keine Flagge/Nationalität – das Feld
  „Flagge" im Detailpanel bleibt bei Live-Daten leer (nur bei den
  Demo-Schiffen aus `data/ships.json` gefüllt). Ließe sich über den
  MMSI-Ländercode (erste drei Ziffern) nachrüsten.
- Bei Flightradar24 kostet jeder Abruf Guthaben. Die Voreinstellungen sind
  bewusst sparsam; wer das Intervall verkürzt oder `maxSpanDegrees` erhöht,
  verbraucht entsprechend mehr.
- Die Feldnamen der FR24-Antwort werden defensiv gelesen (mehrere Varianten
  werden akzeptiert), weil die API-Dokumentation nur mit gültigem Konto
  vollständig einsehbar ist.
- Die Städte-Suche nutzt eine eingebaute Liste (kein Geocoding-Dienst);
  der KI-Assistent nutzt dagegen echtes Reverse-Geocoding.
- Der Kamera-Sichtfeld-Kegel ist reine Geometrie – Gelände und Gebäude
  schatten ihn nicht ab (siehe 1.24).
- Die Routenplanung hängt am öffentlichen OSRM-Demo-Server: keine
  SLA-Garantie, ausdrücklich nur für geringes Volumen (siehe 1.23).
- `NASA_API_KEY` (Asteroiden) fehlt in `server/keyRegistry.mjs` und wird
  deshalb von `npm run doctor` und dem POWER-UP-Panel nicht angezeigt –
  nachgetragen in WEB-165.
- Die Dammdaten enthalten mit 16.630 Treffern auch Kleinstwehre; WEB-151
  filtert sie über Wikidata nach.
- Öffentliche Webcam-Quellen können vom Betreiber jederzeit geändert werden
  (siehe 1.4). Ein Austausch ist eine Zeile in `data/cameras.json`.
- Der Kamera-Proxy umgeht Hotlink-Sperren technisch – die
  Nutzungsbedingungen der Betreiber gelten davon unberührt weiter.
- Nominatim (Ortsnamen) ist ein kostenloser Gemeinschaftsdienst – bei sehr
  vielen Anfragen drosselt er. Ergebnisse werden deshalb gecacht.

## 6. Getestete Funktionen

Flugdaten: Normalisierung beider Anbieter mit nachgebildeten Antworten
(Einheitenumrechnung Fuß/Knoten/ft-min → Meter/km-h/m-s geprüft), Bounds-
Validierung, Fehlerfall ohne Token; Server-Endpunkt inkl. Cache-Treffer
(5 Anfragen → 2 echte Abrufe), Bodenfilter, Sortierung und `limit`.

Kamera-Proxy: Hotlink-Schutz nachgebildet (403 ohne Referer → mit Referer
200), Erlaubnisliste, SSRF-Schutz gegen Loopback, private Netze,
Link-Local, Cloud-Metadaten und IPv6 (auch wenn der Host absichtlich in der
Erlaubnisliste steht), `file://` abgelehnt, HTML-Antworten abgelehnt,
HLS-Playlist-Umschreibung inkl. `URI="…"`.

Browser (Kameras): München zeigt vier Reiter, blockiertes Direktbild
schaltet automatisch auf den Proxy um, Umschalten lädt die richtige
Kamera, Standort mit nur einer Ansicht zeigt keine Reiter.

Browser: Live-Betrieb mit nachgebildetem `/api/flights` (LIVE-Badge, Quelle,
Anzahl, Ausschnitt korrekt um den Blickpunkt zentriert, erweiterte
Detailfelder, Bewegung zwischen den Abrufen) und Demo-Rückfall bei
abgeschaltetem Server.

Außerdem prüft der Browsertest:
Kartenumschalter, Suche, Detailpanel,
Foto-Nachladen inkl. Fallback auf die Illustration, Bildnachweis und
Beschreibung, YouTube-Einbettung, Stream-Fallback, KI-Panel, Key-Eingabe,
SSE-Streaming der Antwort, Ortskontext im System-Prompt und die
objektbezogene Frage über „Claude dazu fragen".
Der Proxy wurde getrennt geprüft (Health, statische Auslieferung,
Fehlermeldung ohne Key, 404, Pfad-Ausbruch).

Browser (Beobachtungszonen): Zone per Kartenklick anlegen (Name/Radius-
Dialog), Kreis + Beschriftung erscheinen korrekt am gewählten Ort,
Sidebar-Eintrag entsteht. Gegen echte Live-Flugdaten (OpenSky) bei
Frankfurt Airport geprüft: reale Flugzeuge und das Infrastruktur-Objekt
lösen „betreten"-Alarme mit korrektem Namen/Zeitstempel aus, Alarm-Klick
fliegt zum Objekt, Zone entfernen räumt Kreis und Zustand auf.

## 7. Changelog

**05.11.2026 – v2.9** — Betrieb, Bedienbarkeit und vier neue Layer

Alles hier aus Commits auf `origin/main` nach dem letzten Doku-Abgleich
(`bbd9974`) belegt:

- **Sichtbarer Layer-Status** (WEB-159): Laden/Fehler/leer/Schlüssel fehlt
  als Status-Punkt am Layer-Schalter, plus kurzlebige Hinweise unten links
  (`js/statusToast.js`). Vorher waren „Quelle kaputt" und „gerade nichts
  los" beide schlicht *0 Objekte* — siehe 1.20.
- **Zentrale Timer-Registrierung** (WEB-160): Statt 32 eigener
  `setInterval` taktet `LayerManager` alle Layer und hält Timer für
  unsichtbare Tabs/Layer an, mit Nachlade-Tick bei Rückkehr — siehe 1.21.
- **Sitzung automatisch sichern** (WEB-161): Aktive Layer, Kamera und
  offene Panels überleben ein F5 (`js/session.js`, `wv-session-v1`);
  ein Share-Link in der Adresszeile hat weiter Vorrang — siehe 1.22.
- **Routenplanung Fuß/Rad/Auto** (WEB-71) über den OSRM-Demo-Server
  (`js/routeTool.js`), abspielbar als Flythrough — siehe 1.23.
- **Kamera-Sichtfeld-Kegel** (WEB-72) aus `heading`/`fovDegrees`/
  `rangeMeters` in `data/cameras.json` (`js/cameraViewshed.js`) — siehe 1.24.
- **Niederschlagsradar-Overlay** (WEB-67) über RainViewer mit Zeitschieber
  (`js/layers/RadarLayer.js`) — siehe 1.25.
- **Leihräder/E-Scooter** (WEB-70) über GBFS
  (`js/layers/BikeShareLayer.js`) — siehe 1.26.
- **Strahlungsmessnetz** (WEB-154, Safecast) und **Tsunami-Warnungen**
  (WEB-155, NOAA PTWC/NTWC), beide keyless — siehe 1.27.
- **Doku-Abgleich** (WEB-164): Layer-Tabelle auf alle 32 Layer, Architektur-
  baum inkl. Server-Modulen, vollständige Liste der Umgebungsvariablen.
  Dabei korrigiert: Die Grenzen führten „idealisierte Kreisbahnen" für
  Satelliten, obwohl die echten SGP4-Bahnen seit v2.3 drin sind, und
  DATENQUELLEN.md führte acht längst gemergte Layer als „noch nicht
  eingebaut".

**18.10.2026 – v2.8** — WEB-81: New Features + UI Overhaul (Integrationswelle)
- UI-Overhaul: Layer-Konsole in sechs Kategorien (`js/layerCategories.js`),
  andockbare Panel-Rails rechts (`js/panelDock.js`), POWER-UP-Panel für
  Schlüssel-Status + Layer-Badges (`js/keyStatusPanel.js`,
  `server/keyRegistry.mjs`, `/api/keys`), zentrale Tastenkürzel-Verwaltung
  + Kurzreferenz (`js/keyboardShortcuts.js`, `js/keyboardReference.js`)
- Neue Features: Szenen-Regisseur (`js/sceneDirector.js` +
  `sceneDirectorPanel.js`), 3D-Flugzeugmodelle für fünf Klassen
  (`js/aircraftModels.js`), Launch-Replay mit rekonstruierter Aufstiegsbahn
  (`js/launchAscent.js`), GOES-Infrarot-Wolken
  (`js/layers/GoesCloudLayer.js`), Weltwetter-Raster
  (`js/layers/WorldWeatherLayer.js`), Infrastruktur/Seekabel in Masse mit
  Clustering (`js/layers/InfrastructureLayer.js`, `CableLayer.js`,
  `BaseLayer.enableClustering()`)
- Details und vollständige PR-Liste in
  `docs/WEB-81-gev-features-ui-overhaul.md` und
  `docs/WEB-81-integrationswelle.md`
- **Das Epic ist vollständig umgesetzt.** Auch die zunächst offenen Teile sind
  inzwischen gemerged: Militärflüge (WEB-90), Verkehrs-, ÖPNV- und
  Street-Level-Layer (WEB-93/94/95), ALPR-Kamerastandorte (WEB-99),
  Contacts-Roster (WEB-91) und der erweiterte Satelliten-Katalog (WEB-89)
- Folgearbeit aus dem Epic: WEB-154/155 sind inzwischen gemerged (siehe
  v2.9). Offen bleiben WEB-151 (Dammdaten über Wikidata nachfiltern) und
  WEB-131 (Blitzdichte — Quelle verifiziert, Aufwand groß, im `backlog`).

**20.09.2026 – v2.7** — Objekt-Dossier
- Neuer Button „📄 Dossier" im Detailpanel: lädt eine Textdatei mit
  Datenfeldern, Kurzbeschreibung und Verknüpfungen des Objekts herunter
- `js/dossier.js` neu (Textaufbereitung + Download über Blob-URL, kein
  Server nötig, analog zu `shareLink.js`)

**18.09.2026 – v2.6** — Verknüpfungen (Link-Analyse)
- Neuer Abschnitt „🔗 Verknüpfungen" im Detailpanel: verwandte Objekte
  über gemeinsame Attribute (Airline, Flagge, Betreiber, Kategorie) und
  räumliche Nähe (30 km), anklickbar
- `js/linkAnalysis.js` neu; `haversineKm()` aus `watchlist.js` nach
  `dataManager.js` verschoben (jetzt gemeinsam genutzt)

**18.09.2026 – v2.5** — Bewegungsspuren (Track-Verlauf)
- Sidebar-Schalter „🧵 Spuren": kurze Track-Historie für Flugzeuge und
  Schiffe (letzte ~25 Positionen, alle 4s gespeichert), standardmäßig aus
- `BaseLayer.enableTrails()`/`setTrailsVisible()` als generischer, opt-in
  Mechanismus für bewegliche Layer; `LayerManager.setTrailsVisible()` für
  den globalen Schalter

**18.09.2026 – v2.4** — Beobachtungszonen (Geofence-Alarme)
- Neues Sidebar-Werkzeug „Beobachtung": Kreiszonen auf der Karte anlegen,
  Ein-/Austritts-Alarme für alle Objekte aller Layer (Flugzeuge, Schiffe, …)
- Reine Client-Auswertung der bereits geladenen öffentlichen Live-Daten
  (Haversine-Distanz alle 2 s), keine neue Datenquelle, kein Server-Anteil
- `WorldViewer.requestLocationPick()`: einmaliger Klick-Abfang für
  Kartenklicks außerhalb der normalen Objektauswahl
- Zonen persistieren in `localStorage`

**29.08.2026 – v2.3.1**
- Zugangsdaten eingebunden: NASA-FIRMS-Key (Brände) und Cesium-Ion-Token
  (3D-Gelände, graue 3D-Gebäude, Kartenansicht „Bing (Ion)")
- `server/loadEnv.mjs`: liest eine `.env`-Datei ohne npm-Abhängigkeit.
  Muss in server.mjs als ERSTER Import stehen, weil ES-Module vollständig
  ausgewertet werden, bevor der Rumpf des importierenden Moduls läuft –
  nur so stehen die Werte bereit, wenn die Konstanten gelesen werden.
  Gesetzte Umgebungsvariablen behalten Vorrang.
- `.gitignore`, `.env.example` und `config.example.js` ergänzt, damit sich
  das Projekt ohne Zugangsdaten weitergeben lässt

**29.08.2026 – v2.3** — Übernahmen aus "God's Eye View" (MIT, Bilawal Sidhu)
- Satelliten auf **echte Bahnen** umgestellt: CelesTrak-TLE mit SGP4
  (satellite.js), Umlaufbahn-Ring beim Anklicken
- Drei neue Ebenen: 🌋 Erdbeben (USGS), 🚀 Raketenstarts (Launch Library 2),
  🔥 Brände (NASA FIRMS)
- 🛩️ **Cockpit-Ansicht** mit Trägheitsanker, Korrekturbegrenzer und
  Kurs-Begrenzer gegen Ruckeln
- **adsb.lol** als dritter Flugdaten-Anbieter (kostenlos, ohne Konto)
- Öffentliche **Verkehrskamera-Kataloge** (TfL London, Caltrans, Austin)
  werden automatisch geladen – mehrere hundert zusätzliche Kameras
- `server/dataProxies.mjs` mit gemeinsamem Cache und Serve-Stale
- **DATENQUELLEN.md**: vollständige Übersicht aller Quellen und Schlüssel

**29.08.2026 – v2.2**
- Webcams werden jetzt direkt von den Originalseiten eingebunden
  (feratel für München und Hamburg, terra-hd für die Isar-Kamera)
- `server/cameraProxy.mjs`: holt Bilder und HLS-Streams serverseitig,
  setzt den passenden Referer und umgeht damit Hotlink- und CORS-Sperren –
  mit Erlaubnisliste, SSRF-Schutz und Größenbegrenzung
- Mehrere Kameras je Standort mit Umschaltleiste (München: 4 Ansichten)
- Zeitstempel der letzten Aktualisierung, Vollbild-Knopf, Link zur Quelle
- Automatischer Wechsel auf den Proxy erst, wenn der direkte Weg scheitert

**29.08.2026 – v2.1**
- Flugzeuge auf **Live-Daten** umgestellt: Flightradar24 (offizielle API)
  oder OpenSky Network, beide hinter einer einheitlichen Schnittstelle
- `server/server.mjs` (früher `claude-proxy.mjs`) holt die Flugdaten,
  cacht sie und schützt Token und Guthaben; alter Startbefehl funktioniert weiter
- Koppelnavigation zwischen den Abrufen, Abgleich mit Karenzzeit,
  Abfrage nur des sichtbaren Ausschnitts
- Statusanzeige in der Sidebar, erweiterte Flugdetails (Registrierung,
  Flugnummer, Steig-/Sinkrate), ICAO-Typcodes werden übersetzt
- Automatischer Rückfall auf Demo-Daten, wenn kein Server läuft

**29.08.2026 – v2.0**
- Weltansicht auf echte Satellitenbilder umgestellt (Esri World Imagery,
  ohne Key), Kartenumschalter Satellit/Hybrid/Karte/Relief, 3D-Gelände
  und 3D-Gebäude-Button, automatischer Fallback auf OSM
- Bild zu jedem Objekt: Wikipedia-Fotos mit Kurzbeschreibung, generierte
  SVG-Illustrationen als Rückfallebene
- Kamera-Livestreams eingebettet (YouTube/HLS/Standbild/iframe/Link)
- KI-Assistent mit Claude API: Button unten links, Ortskontext,
  Streaming-Antworten, sicherer Proxy-Modus + Direktmodus
- `server/claude-proxy.mjs` als Webserver und API-Proxy ergänzt

**28.08.2026 – v1.0 (MVP)**
- Erstversion: 3D-Globus, 5 Layer mit Beispieldaten, Simulation, Suche,
  Detailpanel, Timeline, responsives Dark-UI
