# World Viewer – Dokumentation (Stand: 18.09.2026, v2.4)

Aktueller Stand, Architektur und Erweiterungswege der Anwendung.

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

| Layer | Objekte | Simulation |
|---|---|---|
| ✈️ Aircraft | live (bis 400) | echte Flugdaten, Koppelnavigation zwischen den Abrufen |
| 🚢 Ships | live (bis 600) sonst 10 Demo | echte AIS-Daten (AISStream), Koppelnavigation zwischen den Abrufen |
| 🛰️ Satellites | 12 | vereinfachte Kreisbahn inkl. Erdrotation |
| 📷 Cameras | 12 eigene + bis 450 aus Katalogen | Livebild von der Originalseite |
| 🏗️ Infrastructure | 16 | statisch, farbcodiert nach Kategorie |
| 🌋 Erdbeben | live (USGS, 24 h) | Fläche nach Magnitude, Farbe nach Herdtiefe |
| 🚀 Raketenstarts | live (30 Tage) | Farbe nach Betreiber |
| 🔥 Brände | live (NASA FIRMS, 24 h) | Farbe und Größe nach Strahlungsleistung |

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

## 2. Architektur

```
index.html ──lädt──► config.js (global) ──dann──► js/app.js (ES6-Modul)

app.js
 ├── WorldViewer (viewer.js)
 │     └── BasemapManager (basemaps.js)   Karten, Gelände, 3D-Gebäude
 ├── LayerManager (layerManager.js)
 │     ├── AircraftLayer                  Live-Daten + Koppelnavigation
 │     │     ├── flightData.js            Abruf über /api/flights
 │     │     └── aircraftTypes.js         ICAO-Code → Name, Wikipedia
 │     └── weitere Layer (js/layers/*)    je Layer eine CustomDataSource
 │           └── dataManager.js           JSON, Datenformat, Geo-Mathematik
 ├── UI (ui.js)
 │     ├── imageProvider.js → illustrations.js
 │     └── streamPlayer.js          Livebild, ggf. über /api/camera
 ├── Search (search.js)
 ├── Timeline (timeline.js)
 ├── Watchlist (watchlist.js) + WatchlistPanel (watchlistPanel.js)
 │     Geofence-Zonen, Ein-/Austritts-Alarme, localStorage
 └── Assistant (ai/assistant.js)
       ├── claudeClient.js       API-Anbindung + SSE-Streaming
       └── locationContext.js    Ortskontext + Reverse-Geocoding
```

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

Umgebungsvariablen des Servers: `FLIGHT_PROVIDER` (fr24|opensky),
`FR24_API_TOKEN`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`,
`FLIGHT_CACHE_MS`, `FLIGHT_MAX`, `CAMERA_HOSTS`, `ANTHROPIC_API_KEY`, `PORT`.

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

**Echte Live-Daten anbinden** – jeweils nur `load()`/`update()` des Layers:

- Flugzeuge: OpenSky Network REST-API, alle ~10 s pollen
- Schiffe: erledigt – AIS-Feed über AISStream per Server-WebSocket
  (`server/aisStream.mjs`), Client pollt `/api/ships`
- Satelliten: TLE-Daten von celestrak.org + `satellite.js` statt der
  vereinfachten Kreisbahn
- Historische Daten: `Timeline.mode = "history"` ist vorbereitet

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
- Satellitenbahnen sind idealisierte Kreisbahnen, keine echten TLE-Bahnen.
- Die Städte-Suche nutzt eine eingebaute Liste (kein Geocoding-Dienst);
  der KI-Assistent nutzt dagegen echtes Reverse-Geocoding.
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
Kartenumschalter, alle 5 Layer (62 Objekte), Suche, Detailpanel,
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
