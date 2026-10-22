# Datenquellen, APIs und Schlüssel

Diese Übersicht beantwortet: **Was brauche ich, damit welche Ebene läuft?**

Kurzfassung: **Der größte Teil funktioniert ohne einen einzigen Schlüssel.**
Zwei Ebenen brauchen einen kostenlosen Schlüssel, zwei weitere sind
kostenpflichtig und rein optional.

---

## 0. Was ist bei dir bereits eingerichtet?

| Schlüssel | Status | Wo hinterlegt | Schaltet frei |
|---|---|---|---|
| **NASA FIRMS** | ✅ eingetragen | `.env` (Server) | 🔥 Brände |
| **Cesium Ion** | ✅ eingetragen | `config.js` (Browser) | 3D-Gelände, graue 3D-Gebäude, Kartenansicht „Bing (Ion)" |
| Google Maps | ⬜ offen | `config.js` | fotorealistische 3D-Gebäude |
| Anthropic | ⬜ offen | `.env` (Server) | ✨ KI-Assistent |
| Flightradar24 | ⬜ offen | `.env` (Server) | Route, Registrierung, Flugnummer |
| TomTom Traffic | ⬜ offen | `.env` (Server) | 🚦 Echte Verkehrsfluss-Geschwindigkeiten |

**Warum an zwei verschiedenen Orten?** Der Cesium-Ion-Token muss im
Browser stehen – die Kartenbibliothek lädt die Kacheln selbst. Alle
anderen Schlüssel sind echte Geheimnisse und liegen ausschließlich auf
dem Server in der Datei `.env`, die per `.gitignore` vom Versionsverwalten
ausgeschlossen ist.

Nach dem Start meldet der Server, was er gefunden hat:

```
🔑 .env geladen: FIRMS_MAP_KEY
🔥 Brände (NASA FIRMS): bereit
```

## 1. Ampelübersicht

### 🟢 Ohne Anmeldung, ohne Schlüssel

| Ebene / Funktion | Quelle | Bemerkung |
|---|---|---|
| Satellitenbilder der Erde | Esri World Imagery | bis auf Hausebene |
| Straßenkarte | OpenStreetMap | |
| Reliefkarte | Esri World Topo | |
| ✈️ Flugzeuge | OpenSky Network | anonym 400 Abrufe/Tag |
| ✈️ Flugzeuge (Alternative) | adsb.lol | regional um einen Punkt |
| 🎖️ Militärflüge (eigener Layer) | adsb.lol `/v2/mil` | weltweit, unabhängig vom zivilen `FLIGHT_PROVIDER` |
| 🛰️ Satelliten (echte Bahnen) | CelesTrak + SGP4 | |
| 🌋 Erdbeben | USGS | letzte 24 Stunden |
| 🗻 Vulkane | Smithsonian GVP (Weltkatalog + laufende Ausbrüche), USGS Volcano Hazards Program (amtliche Warnstufen) | 438 seit 1900 aktive Vulkane, Ampel live über `/api/volcanoes`; GVP sendet kein CORS → Server-Proxy. Rückfallebene: `data/volcanoes.json` (erzeugt via `npm run build:volcanoes`) |
| 🏗️ Infrastruktur-Massendaten (Rechenzentren, Dämme, Seekabel) | OpenStreetMap via Overpass API | Statischer Snapshot, nicht live. Ergänzt additiv die handkuratierten Einträge aus `data/infrastructure.json`/`data/cables.json`. Erzeugt via `npm run build:infrastructure-mass` (braucht Internet, mehrere Minuten, Overpass-Server sind oft überlastet – bei Fehlern mit Backoff erneut versuchen). Die drei Ausgabedateien (`data/datacenters.json`, `data/dams.json`, `data/cables-osm.json`) sind **optional**: fehlen sie, zeigen die Layer nur die handkuratierte Liste, ohne Konsolenfehler. ODbL 1.0 – Namensnennung „© OpenStreetMap contributors" Pflicht. |
| 🚀 Raketenstarts | Launch Library 2 | 15 Abrufe/Stunde |
| ☄️ Asteroiden (Erdannäherungen, 7 Tage) | NASA NeoWs | läuft mit `DEMO_KEY`, 30 Abrufe/Stunde (weltweit geteilt) |
| 🌠 Kometen | NASA JPL Small-Body Database | kein Schlüssel; Bahnelemente, Positionen rechnet der Browser |
| 🛰️ Deep-Space-Missionen (Voyager 1/2, New Horizons, JWST, Parker Solar Probe, Juno) | NASA JPL Horizons | echte Ephemeriden, kein Schlüssel; liefert Klartextblöcke → Server-Proxy parst sie, cacht 6 h |
| 🌀 Wirbelstürme | NOAA National Hurricane Center | nur Atlantik/Ost-/Zentralpazifik; sendet kein CORS → Server-Proxy für Übersicht + Vorhersagekegel |
| 📷 Verkehrskameras | TfL London, Caltrans, Austin | mehrere hundert Kameras |
| 📷 Einzelne Webcams | feratel, terra-hd, YouTube, NOAA | |
| 🌌 Allsky-Kameras | 20 bekannte Sternwarten + öffentliche Allsky-Karte | Ganzhimmelkameras weltweit, rund 380 Standorte |
| 🪪 Kennzeichenleser (ALPR) | OpenStreetMap / DeFlock | nur sichtbarer Ausschnitt, nur Standortdaten, Community-Kartierung unvollständig |
| Objektfotos | Wikipedia | |
| Ortsnamen | OpenStreetMap/Nominatim | |
| 🌫️ Luftqualität (AQI) | Open-Meteo Air Quality API | Großstädte, handkuratiert |
| ⛽ Kraftstoffreserven | modelliert nach IEA-Bevorratungsregeln / nationalen Mindestbevorratungsgesetzen | 20 größte Volkswirtschaften, statische Modellwerte, keine Live-Meldung |
| 📰 Ereignisse | GDELT Project GEO 2.0 API | geokodierte Weltnachrichten, Aktualisierung alle 15 Min. |
| 🚌 ÖPNV (Busse/Bahnen/Fähren) | GTFS-Realtime: MBTA (Boston), OVapi (Niederlande) | Protobuf, serverseitig dekodiert; nur diese zwei Regionen abgedeckt |
| 🚲 Leihräder/E-Scooter (GBFS) | 9 Bikeshare-Systeme (nextbike Berlin/Köln/München, Citi Bike, Divvy, Capital Bikeshare, Bike Share Toronto, Bicing, BiciMAD) | handkuratiert, nur je Stadt auf offenes CORS geprüfte Systeme |
| ☁️ GOES-Wolken (Infrarot) | NASA GIBS (WMTS) | geostationär, deckt nur Amerika/Pazifik/Atlantik ab; CORS-frei, direkter Browser-Zugriff |
| 🌦️ Weltwetter-Raster | Open-Meteo Forecast API | weltweites Gradnetz, 1 Sammelanfrage pro Aktualisierung – zählt aber pro Zelle gegen das Tageskontingent (siehe Abschnitt „Weltwetter-Raster" unten) |
| 🏗️ Infrastruktur/Seekabel in Masse | OpenStreetMap via Overpass API (statischer Snapshot) | Snapshot ist **eingecheckt** (4.813 Rechenzentren, 16.630 Dämme, 195 Seekabel); neu erzeugen per `npm run build:infrastructure-mass`, siehe Abschnitt unten |
| 🚗 Verkehr (Simulation) | eigenes prozedurales Straßenraster | im sichtbaren Kartenausschnitt, klar als Simulation gekennzeichnet; echte OSM-Straßengeometrie via Overpass API scheitert in vielen Sandbox-Umgebungen an einer IP-Sperre (siehe `docs/WEB-83-...`, Abschnitt 1a) |
| ☢️ Strahlungsmessnetz | Safecast API | CC0, Community-Messnetz, letzte 6 Stunden, sendet CORS nur für `safecast.org` → Server-Proxy |
| 🌧️ Niederschlagsradar | RainViewer Weather Maps API | Kachel-Overlay statt Punktwerten, letzte ~2 Stunden, CORS offen, kein Key; Pflicht-Namensnennung "RainViewer API" |

### 🟡 Kostenloser Schlüssel nötig

| Ebene / Funktion | Quelle | Schlüssel holen |
|---|---|---|
| 🔥 Aktive Brände | NASA FIRMS | ✅ eingetragen |
| 3D-Gelände, 3D-Gebäude (grau) | Cesium Ion | ✅ eingetragen |
| 🚢 Schiffe (echte AIS-Daten) | AISStream | <https://aisstream.io> → Account → API Keys |
| ✈️ Mehr Flug-Kontingent | OpenSky-Konto | <https://opensky-network.org> → OAuth2-Client |
| 🚀 Mehr Start-Kontingent | Launch Library 2 | <https://ll.thespacedevs.com/docs/> |
| ☄️ Mehr Asteroiden-Kontingent | NASA api.nasa.gov | <https://api.nasa.gov> → sofort per E-Mail (1000 Abrufe/Stunde) |
| 📷 Mehr TfL-Kontingent | TfL Open Data | <https://api-portal.tfl.gov.uk> |
| 📸 Street-Level-Fotos (Abdeckung + Bildkegel) | Mapillary | <https://www.mapillary.com/dashboard/developers> → "Register application" |
| 🚦 Echte Verkehrsfluss-Geschwindigkeiten | TomTom Traffic | <https://developer.tomtom.com> → 2.500 Abrufe/Tag gratis |

### 🔴 Kostenpflichtig, rein optional

| Funktion | Quelle | Kosten |
|---|---|---|
| Fotorealistische 3D-Gebäude | Google Map Tiles API | nach Nutzung abgerechnet |
| ✈️ Beste Flugdaten (Route, Registrierung) | Flightradar24 API | Abo, Abrechnung nach Credits |
| ✨ KI-Assistent | Anthropic Claude API | nach Nutzung abgerechnet |

---

## 2. Einrichtung

Alle Server-Schlüssel stehen in der Datei **`.env`** im Projektordner.
Der Server liest sie beim Start automatisch – es ist also nichts weiter
zu tun als:

```bash
cd world-viewer
node server/server.mjs
```

Neue Schlüssel trägst du einfach in `.env` ein und startest den Server neu:

```bash
FIRMS_MAP_KEY=...          # ✅ bereits eingetragen
ANTHROPIC_API_KEY=sk-ant-… # KI-Assistent
AISSTREAM_API_KEY=...      # echte Schiffsdaten (AIS)
FR24_API_TOKEN=...         # Flightradar24
OPENSKY_CLIENT_ID=...      # mehr Flug-Kontingent
OPENSKY_CLIENT_SECRET=...
LL2_API_TOKEN=...          # mehr Start-Kontingent
TFL_APP_KEY=...            # mehr Kamera-Kontingent
NASA_API_KEY=...           # mehr Asteroiden-Kontingent (sonst DEMO_KEY)
```

Eine Umgebungsvariable hat Vorrang vor der Datei – zum Ausprobieren
geht also weiterhin:

```bash
FLIGHT_PROVIDER=adsblol node server/server.mjs
```

`.env.example` ist die Vorlage ohne Werte, `config.example.js` die
Browser-Konfiguration ohne Token. Beide können bedenkenlos
weitergegeben werden.

Cesium-Ion-Token und Google-Maps-Key kommen dagegen in **`config.js`**,
weil die Kartenbibliothek sie im Browser braucht:

```javascript
cesiumIonToken:   "eyJhbGci…",   // ✅ eingetragen
googleMapsApiKey: "",            // fotorealistische 3D-Gebäude
```

**Wichtig bei Google:** In der Google Cloud Console muss die
**Map Tiles API** freigeschaltet sein – die normale Maps-JavaScript-API
reicht nicht. Beschränke den Schlüssel dort außerdem auf deine Domain.

Beim Start sagt der Server, was er gefunden hat – so sieht es bei dir
jetzt aus:

```
🌍 World Viewer läuft auf http://localhost:8000

🔑 .env geladen: FIRMS_MAP_KEY
📷 Kamera-Proxy aktiv für 12 Hosts
✈️  Flugdaten: OpenSky Network (anonym – 400 Abrufe/Tag)
     Abrufintervall mind. 12s, max. 400 Flugzeuge
🛰️  Bahndaten (CelesTrak) und Raketenstarts: bereit
🔥 Brände (NASA FIRMS): bereit
📹 Verkehrskameras (TfL, Caltrans, Austin): bereit
⚠️  KI-Assistent: kein ANTHROPIC_API_KEY gesetzt
```

---

## 3. Die Quellen im Einzelnen

### ✈️ Flugzeuge

Drei Anbieter hinter einer Schnittstelle, umschaltbar über
`FLIGHT_PROVIDER=opensky|adsblol|fr24`:

| | OpenSky | adsb.lol | Flightradar24 |
|---|---|---|---|
| Kosten | kostenlos | kostenlos | Abo |
| Schlüssel | optional | nein | ja |
| Abdeckung | weltweit | regional (Radius um einen Punkt) | weltweit |
| Route/Registrierung | nein | teilweise | ja |
| Kontingent | 400/Tag anonym, 4.000 mit Konto | nicht dokumentiert | nach Credits |

Endpunkte: `opensky-network.org/api/states/all`,
`api.adsb.lol/v2/lat/…/lon/…/dist/…`,
`fr24api.flightradar24.com/api/live/flight-positions/full`

> **Lizenzhinweis OpenSky:** nicht-kommerziell. Für kommerziellen Einsatz
> ist eine eigene Vereinbarung mit OpenSky nötig.
> **adsb.lol:** ODbL 1.0, Namensnennung erforderlich.

Ab 6 km Kameraabstand wechseln fünf Typen (787, ATR-72, Cessna
Citation/Gulfstream/Phenom, Hubschrauber, MQ-9/RQ-9) vom Glyph auf ein
3D-Modell (`js/aircraftModels.js`); alle anderen Typen bleiben beim
Glyph. Lizenz- und Herkunftsnachweis der GLB-Dateien: Abschnitt 5.

#### 🎖️ Militärflüge (eigener Layer, WEB-90)

Eigener, bernsteinfarbener Layer unter „Bewegung" in der Layer-Konsole,
getrennt vom zivilen Verkehr oben. Nutzt **immer** `api.adsb.lol/v2/mil`
(weltweite Militär-Transponder), unabhängig vom eingestellten
`FLIGHT_PROVIDER` – kein Schlüssel nötig, kein eigenes `.env`-Flag.

- **Endpunkt (Server → adsb.lol):** `GET https://api.adsb.lol/v2/mil`
  (keine Parameter, liefert weltweit). Server-Proxy unter `/api/flights/military`,
  Status unter `/api/flights/military/status`.
- **Cache:** ein einzelner Server-Cache-Eintrag (kein Bounding-Box-Schlüssel
  nötig, da der Feed ohnehin weltweit liefert), Intervall über
  `MILITARY_FLIGHT_CACHE_MS` einstellbar (Default 20 s).
- **Sparsamkeit:** die Begrenzung auf den sichtbaren Kartenausschnitt
  passiert clientseitig nach dem Abruf (`AircraftLayer.boundsInQuery=false`),
  da adsb.lol für `/mil` keine Bounding-Box kennt. Kein Abruf, solange der
  Layer ausgeschaltet ist (siehe `AircraftLayer.show()/hide()`).
- **Keine Doppelanzeige:** Maschinen, deren ID auch im zivilen Feed auftaucht
  (gleicher ICAO-Hex), werden im Militär-Layer nicht zusätzlich gezeichnet
  (`dedupeAgainst` in `js/app.js`).
- **Lizenz:** ODbL 1.0 wie beim regulären adsb.lol-Feed oben.

### 🛰️ Satelliten

Bahndaten (TLE) von **CelesTrak**, gerechnet mit dem SGP4-Modell aus
`satellite.js`. Die Positionen stimmen dadurch mit der Wirklichkeit
überein – die ISS erscheint auf 420 km Höhe bei 27.600 km/h.

Endpunkt: `celestrak.org/NORAD/elements/gp.php?GROUP=<gruppe>&FORMAT=tle`
Gruppen in `config.js`: `stations`, `visual`, `gps-ops`, `glo-ops`,
`galileo`, `geo` plus vier `*-debris`-Gruppen – zusammen rund 830–1000
Objekte, GEV-Maßstab (siehe `docs/WEB-84-sgp4-satellitenpropagation-ohne-build-schritt.md`).
`satellites.dense: true` hängt zusätzlich `starlink` an (~10.600 Objekte,
gekappt auf `maxStarlinkPerGroup`) – Schalter für die Starlink-Dichte,
Standard aus.

Der Server spiegelt CelesTrak, weil dort keine CORS-Header gesetzt sind,
und cacht 6 Stunden. Ohne Server fällt die Ebene auf die Beispieldaten
mit vereinfachter Kreisbahn zurück.

> **Achtung:** GLONASS heißt bei CelesTrak `glo-ops`, nicht
> `glonass-operational` – letzteres liefert 404.
> **Bitte um Zitierung:** "CelesTrak (celestrak.org), Dr. T.S. Kelso".

### 🌋 Erdbeben

**USGS**, letzte 24 Stunden, öffentlich und CORS-freigegeben – diese Ebene
funktioniert sogar ganz **ohne Server**.

Endpunkt: `earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson`
Darstellung: Kreisfläche wächst exponentiell mit der Magnitude, Farbe nach
Herdtiefe (rot = flach unter 70 km, orange bis 300 km, gelb darüber).

> Namensnennung: "Data courtesy of the U.S. Geological Survey".

### 🚀 Raketenstarts

**Launch Library 2** von The Space Devs, rollendes 30-Tage-Fenster.
Ohne Token nur 15 Abrufe pro Stunde – der Server cacht deshalb 15 Minuten.

Endpunkt: `ll.thespacedevs.com/2.3.0/launches/?net__gte=…&mode=detailed`

> Namensnennung erwünscht: "Launch Library 2 — The Space Devs".

### ☄️ Asteroiden

**NASA NeoWs** ("Near Earth Object Web Service"), rollendes 7-Tage-Fenster
(NeoWs erlaubt pro Abruf maximal 7 Tage Zeitraum). Läuft ohne eigenen
Schlüssel mit `DEMO_KEY` – der ist aber weltweit geteilt und knapp
(30 Abrufe/Stunde, 50/Tag), deshalb cacht der Server 6 Stunden.

Endpunkt: `api.nasa.gov/neo/rest/v1/feed?start_date=…&end_date=…&api_key=…`

Jeder Asteroid liefert die reale Annäherungsdistanz (km, Monddistanzen),
Durchmesser, Relativgeschwindigkeit und die Einstufung "potenziell
gefährlich" – aber **keine Richtung**. Die Position auf dem Globus ist
deshalb stilisiert (stabile Pseudo-Zufallsrichtung je Asteroid-ID,
Höhe gestaucht-logarithmisch nach relativer Nähe), die echten Werte
stehen im Detailpanel und verlinken auf die NASA JPL Small-Body Database.

Eigener Schlüssel (kostenlos, sofort per E-Mail, 1000 Abrufe/Stunde):
<https://api.nasa.gov> → `NASA_API_KEY` in `.env`.

### 🛰️ Deep-Space-Missionen

**NASA JPL Horizons** liefert echte Ephemeriden (Positions- und
Geschwindigkeitsvektoren) für jeden Körper im Sonnensystem, inklusive der
aktiven Raumsonden – ohne Schlüssel und ohne Kontingentgrenze.

Endpunkt: `ssd.jpl.nasa.gov/api/horizons.api?format=json&COMMAND='-31'&EPHEM_TYPE='VECTORS'&CENTER='500@10'&…`

Abgefragt werden sechs Sonden über ihre NAIF-Körper-IDs – Voyager 1
(`-31`), Voyager 2 (`-32`), New Horizons (`-98`), James-Webb-Weltraumteleskop
(`-170`), Parker Solar Probe (`-96`), Juno (`-61`) – plus die Erde (`399`)
als Bezugspunkt. Alle sieben Anfragen nutzen dasselbe Zeitraster, damit
die Vektordifferenz Sonde − Erde physikalisch sinnvoll ist (daraus folgen
Entfernung zur Erde und Signallaufzeit).

Zwei Besonderheiten:

* Die Antwort ist **kein sauberes JSON**, sondern ein JSON-Umschlag mit
  einem Klartext-Ephemeridenblock zwischen den Marken `$$SOE` und `$$EOE`.
  Den parst `server/deepSpace.mjs`; CORS-Header sendet Horizons ohnehin
  keine, ein Server-Proxy ist also doppelt nötig.
* Horizons **drosselt parallele Zugriffe** mit HTTP 503 (bei sieben
  gleichzeitigen Anfragen kamen fünf davon zurück). Der Server fragt die
  Ziele deshalb nacheinander mit kleinem Abstand ab und wiederholt
  gedrosselte Anfragen. Gecacht wird 6 Stunden – abgerufen wird dabei ein
  12-Stunden-Fenster im Stundenraster, aus dem je Anfrage der
  zeitnächste Stützpunkt gewählt wird. So bleibt die Anzeige auch gegen
  Ende der Cache-Laufzeit aktuell, was vor allem für die Parker Solar
  Probe zählt (im Perihel über 190 km/s).

**Darstellung:** bewusst *kein* Globus-Layer. Voyager 1 steht rund 172 AE
entfernt (etwa 25,8 Mrd. km) – zwischen Erdoberfläche und 172 AE liegen
zwölf Größenordnungen, jeder Globusmaßstab wird damit sinnlos. Die
logarithmische Stauchung des Asteroiden-Layers trägt hier nicht mehr,
weil NEOs in Mondentfernungen bleiben. Stattdessen gibt es eine eigene
kompakte Sidebar-Ansicht ("Wo ist Voyager gerade?") mit Entfernung zu
Sonne und Erde, einfacher und doppelter Signallaufzeit und Bahntempo –
dazu eine schematische Draufsicht auf die Ekliptik, in der die **Richtung
echt** (ekliptikale Länge aus den Vektoren) und der **Radius
logarithmisch gestaucht** ist. Referenzkreise für Erde, Jupiter, Neptun
und die Heliopause machen die Einordnung lesbar, ohne Maßstabstreue zu
behaupten.

### 🌠 Kometen

**NASA JPL Small-Body Database (SBDB) Query API**, ohne Schlüssel.

Endpunkt: `ssd-api.jpl.nasa.gov/sbdb_query.api?fields=…&sb-kind=c`

Wichtig ist `sb-kind=c` (alle Kometenarten, 4080 Objekte). Das
naheliegendere `sb-class=COM` liefert nur **eine** Bahnklasse: 735
langperiodische Kometen mit mindestens 207 Jahren Umlaufzeit – ohne
1P/Halley (Klasse HTC) und ohne die gesamte Jupiterfamilie (JFc).

Der Server (`/api/comets`, Cache 24 h) filtert den Katalog auf die
derzeit lohnenden Objekte – Perihel innerhalb 6 AE und entweder
kurzperiodisch (≤ 200 Jahre) oder gerade in Sonnennähe – und schickt die
60 hellsten als Bahnelemente an den Browser. Übergangen werden dabei
Bruchstücke (`73P-A`, `73P-AB` …, der Hauptkörper bleibt) und verlorene
oder zerfallene Kometen (D-Designation wie `5D/Brorsen`). Achtung: die
SBDB benutzt bei `M1`, `per_y` und `diameter` eine 0 als "unbekannt",
nicht als Messwert.

Die **Positionen rechnet der Browser** laufend aus den Bahnelementen
(`js/cometOrbits.js`): Kepler-Gleichung für Ellipse, Parabel und
Hyperbel, dann heliozentrische Ekliptik → geozentrisch → RA/Dek →
Subpunkt. Angezeigt wird also der Zenitpunkt – anders als bei den
Asteroiden ist die **Richtung echt**, nur die Entfernung ist für die
Darstellung logarithmisch gestaucht (echte Werte im Detailpanel).

Es ist ein Zweikörper-Modell ohne Planetenstörungen. `node
scripts/check-comet-orbits.mjs` vergleicht die Rechnung gegen JPL
Horizons; die Abweichung liegt derzeit zwischen 0,06° (153P) und 1,3°
(67P, dessen Bahnelemente von 2015 stammen).

### 🔥 Aktive Brände

**NASA FIRMS**, VIIRS-Daten von NOAA-20, NOAA-21 und Suomi-NPP,
letzte 24 Stunden. **Braucht einen kostenlosen Schlüssel**, sonst bleibt
die Ebene leer.

Endpunkt: `firms.modaps.eosdis.nasa.gov/api/area/csv/<KEY>/<quelle>/world/2`
Kontingent: 5.000 Abrufe je 10 Minuten – der Server cacht 30 Minuten und
fragt die drei Satelliten nacheinander ab, nicht parallel.

> Pflichthinweis der NASA: "We acknowledge the use of data and/or imagery
> from NASA's Fire Information for Resource Management System (FIRMS)
> (https://earthdata.nasa.gov/firms), part of NASA's Earth Observing
> System Data and Information System (EOSDIS)."

### 🌀 Tropische Wirbelstürme

**NOAA National Hurricane Center**, öffentliche US-Regierungsdaten, kein
Schlüssel nötig. Zuständig nur für Atlantik sowie Ost-/Zentralpazifik –
andere Ozeanbecken (z.B. Westpazifik, JTWC) sind bewusst nicht Teil
dieser Ebene.

Endpunkte:
- `nhc.noaa.gov/CurrentStorms.json` – Übersicht aktiver Systeme (Position,
  Windstärke, Luftdruck, Zugrichtung), alle 20 Minuten abgerufen.
- `nhc.noaa.gov/storm_graphics/api/<ID>_CONE.kmz` – Vorhersagekegel
  ("Cone of Uncertainty") je System, als KMZ (gezipptes KML).

NHC sendet keine CORS-Header, daher läuft beides über den eigenen Server
(`/api/storms`, `/api/storms/cone`). Weil das Projekt bewusst ohne
npm-Pakete auskommt, liest `server/kmz.mjs` das ZIP-Format selbst aus
(Node-eigenes `zlib` für die Dekompression) statt eine Zip-Bibliothek
einzubinden.

Außerhalb der Hurrikansaison ist `activeStorms` meist leer – das ist der
Normalfall. Die Sidebar zeigt dann "derzeit keine aktiven Systeme" statt
einer stillschweigend leeren Ebene.

### 🚌 ÖPNV (Busse, Bahnen, Fähren)

**GTFS-Realtime** (Google/MobilityData-Standard) ist Protobuf, kein JSON –
dafür gibt es keine CDN-taugliche Decoder-Bibliothek ohne Build-Schritt.
`server/gtfsRealtime.mjs` liest das Protobuf-Drahtformat (Varints +
Length-Delimited-Felder) selbst aus, analog zu `server/kmz.mjs` für das
ZIP-Format der NHC-Vorhersagekegel – kein npm-Paket nötig.

Zwei schlüsselfreie Feeds, beide gegen MBTA/OVapi mit `curl` verifiziert
(siehe `docs/WEB-83-datenquellen-verkehr-oepnv-streetlevel-militaer.md`):
- **MBTA (Boston, USA)** – `cdn.mbta.com/realtime/VehiclePositions.pb`.
  Deckt Bus, U-Bahn/Straßenbahn, Pendlerzug und Fähre in einem Feed ab.
  route_id ist hier bereits die Linienbezeichnung selbst (z.B. "Red",
  "CR-Providence", "1"), daher keine zusätzliche GTFS-Schedule-Datei nötig.
- **OVapi (Niederlande)** – `gtfs.ovapi.nl/nl/vehiclePositions.pb`,
  landesweiter Community-Aggregator mit deutlich mehr Fahrzeugen.

Beide Feeds senden kein CORS, daher läuft die Dekodierung ohnehin
serverseitig über `/api/transit/<stadt>` (20s Cache, Feeds aktualisieren
sich selbst alle ~20-30s). Außerhalb dieser zwei Regionen bleibt die
Ebene leer – das ist eine Dateneigenschaft (zwei ausgewählte offene
Feeds von vielen tausend GTFS-Betreibern weltweit), die Sidebar erklärt
das über `statusText()` statt stillschweigend leer zu bleiben.

### 🚲 Leihräder/E-Scooter (GBFS)

**General Bikeshare Feed Specification (GBFS)** – offener Standard für
Shared-Mobility-Betreiber, öffentliche Systemliste unter
[MobilityData/gbfs](https://github.com/MobilityData/gbfs/blob/master/systems.csv).
Analog zu Kameras/AQI: eine handkuratierte Städteliste
(`data/bikeshare-systems.json`) statt Auto-Discovery, da nicht jedes
der tausenden GBFS-Systeme ohne Anmeldung und mit offenem CORS
erreichbar ist – jede Stadt wurde einzeln per curl gegen
`station_information`/`station_status` geprüft, bevor sie aufgenommen
wurde.

Aufgenommen sind 9 Systeme mit bestätigtem `Access-Control-Allow-Origin: *`
und ohne Registrierung: **nextbike** in Berlin, Köln (KVB Rad) und
München (MyRadl), **Citi Bike** (New York), **Divvy** (Chicago),
**Capital Bikeshare** (Washington, D.C.), **Bike Share Toronto**,
**Bicing** (Barcelona) und **BiciMAD** (Madrid). Die Systeme laufen auf
zwei GBFS-Versionen (2.3 und 3.0) mit leicht unterschiedlichen
Feldnamen – der Layer gleicht das selbst an.

`station_information` (Stationsnamen/-koordinaten) ändert sich
praktisch nie und wird nur einmal geladen; `station_status`
(Verfügbarkeit) wird alle 90 Sekunden neu abgefragt – innerhalb der von
der Spezifikation empfohlenen 60-120s. Dargestellt werden ausschließlich
aggregierte Stationsdaten (Anzahl verfügbarer Räder/Docks), keine
Fahrzeug- oder Nutzerverfolgung.

### 🕰️ Zeitleisten-Replay

Spielt Erdbeben/Brände/Raketenstarts der letzten 7 oder 30 Tage zeitlich ab
(Play/Pause/Scrub, einstellbare Geschwindigkeit) statt sie alle gleichzeitig
zu zeigen. Nutzt ausschließlich dieselben, bereits eingebundenen Quellen –
kein neuer Schlüssel nötig:

- **Erdbeben**: USGS-Wochen-/Monatsfeed (`all_week.geojson` / `all_month.geojson`),
  direkt im Browser, CORS-freigegeben.
- **Brände**: `/api/fires/history?days=N` – dieselbe FIRMS-Flächenabfrage wie
  oben, nur mit größerem `day_range` (API-Limit: maximal 10 Tage je Anfrage).
- **Raketenstarts**: `/api/launches/history?days=N` – Launch Library 2,
  Endpunkt `launches/previous/` (bereits erfolgte Starts) statt `launches/`.

### 📷 Kameras

Zwei Arten:

**Handverlesene Standorte** in `data/cameras.json` – München (vier Ansichten),
Hamburg, Times Square, Venedig, Shibuya, GOES-Satellitenbild, Niagarafälle,
Piazza San Marco, Dubai Marina, Sydney Harbour Bridge & Opera House, Fuji-san.

**Öffentliche Verkehrskamera-Kataloge**, automatisch geladen:

| Quelle | Katalog | Anzahl | Namensnennung |
|---|---|---|---|
| Transport for London | `api.tfl.gov.uk/Place/Type/JamCam` | bis 150 | **verpflichtend** |
| Caltrans | `cwwp2.dot.ca.gov/data/d<N>/cctv/cctvStatusD<NN>.json` | bis 150 | Kulanz |
| City of Austin | `data.austintexas.gov/api/views/b4k4-adkb/rows.json` | bis 150 | erforderlich |

Alle drei liefern Standbilder, die sich alle paar Minuten erneuern.
Sie laufen über den Kamera-Proxy des Servers, weil die Kataloge nicht
CORS-freigegeben sind und die Bilder teils hotlink-geschützt.

> TfL verlangt wörtlich: "Powered by TfL Open Data. Contains OS data
> © Crown copyright and database rights." Die App zeigt diesen Hinweis
> im Bildnachweis jeder TfL-Kamera an.

### 📸 Street-Level (Mapillary, WEB-95)

Abdeckungslinien (eine Polylinie je Mapillary-"sequence") und Bildkegel in
Blickrichtung, analog zur Kamera-Sichtkegel-Mechanik. Lädt lazy nur für den
sichtbaren Kartenausschnitt (`/api/mapillary/images`), nicht global.

**Ohne `MAPILLARY_TOKEN`** bleibt die Ebene leer (503/no_key vom Server) –
Layer-Konsole und POWER-UP-Panel erklären das 🔑-Badge.

**Mit Token:** Bildsuche und Abdeckung laufen komplett über den Server
(Token bleibt in `.env`). Nur der eingebettete `mapillary-js`-Betrachter
holt sich den Token transient über `/api/mapillary/token`, weil die
Bibliothek ihre Kachel-/Mesh-Anfragen selbst direkt aus dem Browser stellt –
dafür braucht sie den echten Wert, der deshalb nie fest im Client-Code
abgelegt wird.

Filter im Panel (rechte Rail): Bildtyp (Alle/360°/Flach) und Zeitraum –
beides filtert die bereits geladenen Bilder, ohne neu abzufragen.

> Mapillary verlangt die Namensnennung "Imagery © Mapillary contributors"
> (CC-BY-SA) – die App zeigt sie im Street-Level-Panel an jedem Bild.

### 🌌 Allsky-Kameras

Allsky-Kameras blicken mit einem Fisheye-Objektiv senkrecht nach oben und
zeigen den kompletten Himmel von Horizont zu Horizont. Sternwarten nutzen
sie zur Wolken- und Meteorüberwachung; nachts zeigen sie Milchstraße,
Polarlichter und Feuerkugeln. Auch hier zwei Quellen:

**Handverlesene Standorte** in `data/allsky-cameras.json` – 20 bekannte
Kameras über alle Kontinente verteilt, jede beim Einpflegen auf Erreichbarkeit
geprüft:

| Standort | Besonderheit |
|---|---|
| Sternwarte Rotheul (Thüringen) | Allskycam 2.0, tags alle 30 s, nachts alle 20 s |
| ESO La Silla (Chile) | Kamera am Dänischen 1,54-m-Teleskop, 2400 m, Atacama |
| Subaru-Asahi StarCam (Mauna Kea) | 24/7-Livestream auf YouTube, 4200 m |
| Konkoly-Observatorium (Budapest) | Forschungssternwarte, gegründet 1871 |
| Perth Observatory (Australien) | Südhimmel mit den Magellanschen Wolken |
| Boyden Observatory (Südafrika) | 1927 von Harvard nach Bloemfontein verlegt |
| Tähtikallio (Finnland), North Pole (Alaska) | Polarlicht-Breiten |
| Otago (Neuseeland) | Aurora Australis, Kreuz des Südens |

Dazu Standorte in Pakistan, Thailand, Brasilien, Spanien, Portugal, England,
Tschechien, der Schweiz, Wisconsin und zwei weitere in Deutschland.

**Öffentliche Allsky-Karte** (`thomasjacquin.com/allsky-map/`) – die Betreiber
der verbreiteten Allsky-Software melden ihre Kameras dort freiwillig mit
Koordinaten an. Der Server holt den Datensatz über `/api/allsky` und cacht ihn
6 Stunden; rund 380 Kameras bleiben so automatisch aktuell.

> Die Karte liefert kein JSON aus, sondern bettet den Datensatz als Array in
> die Seite ein – der Server schält ihn aus dem HTML. Bricht das, bleibt der
> Layer bei den handverlesenen Standorten.

Die gemeldeten Kameras werden **direkt** geladen, nicht über den Kamera-Proxy:
Dessen Erlaubnisliste entsteht nur aus `data/cameras.json` und
`data/allsky-cameras.json`, damit über den Fremdkatalog niemand neue
Ziel-Hosts unterschieben kann.

### 🪪 Kennzeichenleser (ALPR, WEB-99)

**OpenStreetMap / DeFlock-Projekt** (`deflock.me`) – Community-Kartierung von
Kennzeichenlesern (ALPR/ANPR) als gewöhnliche OSM-Knoten/-Wege
(`man_made=surveillance` + `surveillance:type=ALPR` bzw. `ANPR`). Abgefragt
wird per Overpass API (`overpass-api.de/api/interpreter`) über `/api/alpr`,
immer nur der **sichtbare Kartenausschnitt**, und für eine Stunde
zwischengespeichert.

> **Datenschutzgrenze:** Dieser Layer zeigt ausschließlich Standorte und
> Gerätetags (Hersteller, Modell, Blickrichtung, Betreiber). OSM führt an
> diesen Knoten grundsätzlich keine Kennzeichen-, Fahrzeug- oder
> Personendaten – der Server reicht zusätzlich nur eine feste Tag-Whitelist
> durch (siehe `mapAlprElement()` in `server/dataProxies.mjs`).

Die Kartierung ist reines Crowd-Sourcing und **garantiert unvollständig** –
DeFlock weist selbst darauf hin, und die App zeigt denselben Hinweis
dauerhaft unter dem Layer-Schalter an, nicht erst bei leerem Ergebnis.

Lizenz: [ODbL](https://opendatacommons.org/licenses/odbl/) (OpenStreetMap).

### 📻 Radiosender

**Radio Browser API** (`api.radio-browser.info`) – öffentlich, ohne
Anmeldung, ohne Schlüssel, kein Kostenrisiko. Die App fragt
`all.api.radio-browser.info/json/stations/search?hasgeoinfo=true` ab
(Mirrors rotieren per DNS) und zeigt nur Sender mit brauchbaren
Geo-Koordinaten – knapp ein Drittel des Katalogs, da `hasgeoinfo=true`
allein nicht zuverlässig filtert (zusätzlich clientseitig geprüft).

CORS ist gesetzt (`Access-Control-Allow-Origin: *`), ein Server-Proxy
ist daher nicht nötig – Layer und Livestream laufen komplett im
Browser. Empfohlen (kein Zwang) ist ein aussagekräftiger
`User-Agent`-Header; Richtwert 2-3 Anfragen/Sekunde, die App stellt
nur eine Anfrage pro Aktualisierung.

### 🌫️ Luftqualität (AQI)

**Open-Meteo Air Quality API** (`air-quality-api.open-meteo.com`) –
öffentlich, ohne Anmeldung, ohne Schlüssel für nicht-kommerzielle
Nutzung. Die App fragt PM2.5, PM10, Ozon, Stickstoffdioxid sowie
europäischen und US-AQI für eine handkuratierte Liste von Großstädten
(`data/aqi-locations.json`) ab – in EINER Anfrage, da `latitude`/
`longitude` kommaseparierte Listen akzeptieren und die Antwort ein
Array in derselben Reihenfolge liefert.

CORS ist gesetzt (`Access-Control-Allow-Origin: *`, per curl
verifiziert), ein Server-Proxy ist daher nicht nötig. Werte
aktualisieren sich bei Open-Meteo stündlich, die App fragt alle 30
Minuten nach. Reine Umweltdaten ohne Personenbezug.

### ☢️ Strahlungsmessnetz (Safecast, WEB-154)

**Safecast API** (`api.safecast.org/en-US/measurements.json`) –
Bürger-/Community-Messnetz (u.a. Nachwirkung Fukushima), **CC0-Lizenz,
kein Key, kein Account**. Live getestet: liefert aktuelle JSON-
Messpunkte mit `latitude`, `longitude`, `value`, `unit` (`cpm` oder
`usv`) und `captured_at`; dieselbe Liste enthält daneben auch
Temperatur- und Statuskanäle, die der Server verwirft.

CORS ist auf `safecast.org` beschränkt (per curl verifiziert,
`Access-Control-Allow-Origin: safecast.org`) – ein Browser darf die
API also nicht direkt abfragen. `/api/radiation` übernimmt deshalb den
Abruf: Die Antwort ist fest auf 25 Einträge/Seite begrenzt, liefert
keine Gesamtzahl und ist nicht nach Zeit sortiert, daher wird über
`captured_after` auf die letzten 6 Stunden gefiltert und seitenweise
vorwärts geblättert (Sicherheitslimit 60 Seiten). Pro Gerät/Standort
bleibt nur die jüngste Messung übrig – viele Einträge stammen von
fahrenden bGeigie-Loggern, ohne diese Dedupe würde die Karte dichte
GPS-Spuren statt eines Sensornetzes zeigen. Ergebnis wird 10 Minuten
serverseitig gecacht.

Die Farbampel rechnet CPM-Werte grob in µSv/h um (Faktor 334, Richtwert
für die verbreitete LND-7317-Pancake-Tube) – nur zur einheitlichen
Einfärbung, der Originalwert bleibt im Detailpanel sichtbar, da die
echte Dosisleistung vom jeweiligen Gerät/Isotop abhängt. Reine
Umweltmessstationen, kein Personenbezug: Geräte-/User-IDs aus der API
erscheinen nicht in der UI.

### ⛽ Kraftstoffreserven

Vorbild ist Neuseelands öffentliche Übersicht über Dieselreserven
("Minimum Stockholding Obligation"): Füllstand in Prozent des
Maximalbestands sowie Reichweite in Tagen. `data/fuel-reserves.json`
überträgt das Konzept handkuratiert auf Benzin, Diesel und Kerosin
(Jet A-1) für die 20 größten Volkswirtschaften (nach nominalem BIP).

Es gibt keine einzelne, frei abfragbare API, die produktscharfe
Lagerbestände (Benzin/Diesel/Kerosin getrennt) für alle 20 Länder
liefert. Die Werte sind daher **Modellwerte**, abgeleitet aus öffentlich
bekannten Bevorratungspflichten – vor allem der IEA-90-Tage-Regel für
Mitgliedsstaaten und nationalen Mindestbevorratungsgesetzen (analog zur
neuseeländischen MSO). Jeder Datensatz trägt ein `info`-Feld mit diesem
Hinweis. Kein Live-Feed, keine amtliche Echtzeitmeldung einzelner
Tanklager – für reale Entscheidungen bitte die offiziellen nationalen
Stellen (z.B. IEA Oil Stocks Reporting System) konsultieren.

### 📰 Globale Ereignis-Lage

**GDELT Project GEO 2.0 API** (`api.gdeltproject.org/api/v2/geo/geo`) –
öffentlich, ohne Anmeldung, ohne Schlüssel. GDELT durchsucht
Nachrichtenmedien weltweit (65 maschinell übersetzte Sprachen) und
geokodiert erwähnte Orte automatisch. Die App fragt vier Themen-Suchen
ab (Konflikt, Protest, Katastrophe, Krise) und zeigt sie farblich
unterschieden als Marker, Klick öffnet eine Kurzbeschreibung samt Link
zum Originalartikel.

Keine CORS-Header, daher Server-Proxy (`/api/events`), der die vier
Themen **nacheinander** abfragt (gemeinsames Kontingent) und 14 Minuten
cacht, knapp unter GDELTs eigenem 15-Minuten-Update-Takt.

> **Wichtig zur Datenqualität:** GDELT ist ein akademisches Projekt,
> keine kuratierte Lagebild-Plattform. Laut eigener Dokumentation kommt
> es "fast immer" zu Fehlern – Ortsnamen-Verwechslungen, Fehlübersetzungen,
> falsch zugeordnete Bildunterschriften. Der Layer eignet sich für einen
> groben Überblick, nicht für belastbare Einzelfall-Bewertungen.
>
> **Verfügbarkeit:** Die GEO-2.0-Route wurde 2021 angekündigt, ist aber
> nicht Teil von GDELTs Kern-API-Garantien. Antwortet sie mit Fehlern
> oder 404, blendet der Layer sich sauber aus (letzter guter Stand bzw.
> leer) statt die App zu stören – siehe `server/dataProxies.mjs`,
> `handleEvents()`.

### ☁️ GOES-Infrarot-Wolken

**NASA GIBS** (Global Imagery Browse Services), WMTS-Kachel-Dienst,
`https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/` – öffentlich, ohne
Anmeldung, ohne Schlüssel, mit CORS-Freigabe
(`access-control-allow-origin: *`), daher **direkter Browser-Zugriff ohne
Server-Proxy**. Verwendet werden die Layer
`GOES-East_ABI_Band13_Clean_Infrared` und
`GOES-West_ABI_Band13_Clean_Infrared` (10,3 µm, zeigt Wolkenoberkanten/
-temperatur statt nur sichtbares Licht, funktioniert deshalb auch nachts).

Kein Zeit-Parameter im Request nötig: GIBS löst den WMTS-Pfad "default" auf
das jeweils neueste verfügbare Bild auf; der tatsächliche Zeitstempel kommt
per CORS-freigegebenem Response-Header `layer-time-actual` zurück.

**Lizenz/Rate-Limit:** NASA-Daten sind gemeinfrei (public domain), kein
offiziell dokumentiertes Rate-Limit für GIBS-WMTS-Kacheln, übliche
Fair-Use-Erwartung bei einem öffentlichen Kachel-Dienst. **Abdeckung
geostationär beschränkt:** GOES-Ost/-West decken nur Amerika, Pazifik und
Atlantik ab – Europa/Asien/Afrika bleiben im Overlay leer, das ist der
Normalfall, kein Fehler.

### 🌦️ Weltwetter-Raster

**Open-Meteo Forecast API** (`api.open-meteo.com/v1/forecast`) – dieselbe
Quelle wie das bestehende städtebasierte Wetter-Overlay und die
Luftqualität, hier aber als **flächendeckendes Gradnetz der ganzen Welt**
(Standard-Schrittweite 15°, 264 Zellen inkl. Ozeane, Pole ausgespart).
Öffentlich, ohne Anmeldung, ohne Schlüssel für nicht-kommerzielle Nutzung.

Alle Zellen werden in **einer** HTTP-Anfrage geholt (`latitude`/`longitude`
akzeptieren kommaseparierte Listen) – das hält die Netzwerklast niedrig,
ändert aber nichts am Kontingent: **Open-Meteo zählt bei Sammelabfragen
jede einzelne Koordinate als eigenen Aufruf** gegen das Fair-Use-Limit von
rund 10.000 Aufrufen/Tag. Bei stündlicher Aktualisierung sind das ~6.300
Koordinaten-Aufrufe/Tag beim 15°-Raster – noch im kostenlosen Rahmen. Ein
feineres 10°-Raster (576 Zellen) würde das Tageslimit schon im
Einzelbetrieb sprengen. Wer einen eigenen API-Schlüssel/Server nutzt, kann
die Schrittweite in der Konfiguration (`worldWeather`) verkleinern.

### 🌧️ Niederschlagsradar

**RainViewer Weather Maps API** (`api.rainviewer.com/public/weather-maps.json`)
– frei, kein Account/Key nötig, CORS laut Doku gesetzt. Liefert Kachel-URLs
für ein Cesium-`ImageryLayer`-Overlay der Niederschlagsradar-Animation der
letzten ~2 Stunden, mit Zeitschieberegler + Play/Pause in der Sidebar
(`js/layers/RadarLayer.js`). Ersetzt nicht den bestehenden Punkt-Wetter-
Layer (`weather`), sondern ergänzt ihn um eine flächendeckende Ansicht;
schlägt der Abruf fehl, bleibt `weather` unberührt nutzbar. Pflicht-
Namensnennung "RainViewer API" ist im Sidebar-Abschnitt verlinkt und
erscheint zusätzlich automatisch in Cesiums Credit-Leiste.

### 🏗️ Infrastruktur/Seekabel in Masse

**OpenStreetMap via Overpass API** – Rechenzentren und Dämme
(`man_made=data_center`/vergleichbare Tags) sowie Seekabel
(`man_made=submarine_cable`) als statischer Snapshot, erzeugt durch
`node scripts/build-infrastructure-mass.mjs` (`npm run
build:infrastructure-mass`). Lizenz: **ODbL 1.0** (Attribution +
Share-Alike) – bewusst **nicht** TeleGeography für Seekabel, deren
Submarine Cable Map unter CC BY-NC-SA 3.0 (nicht-kommerziell) steht und
damit nicht zur restlichen Lizenzlage des Projekts passt. Der Build-Lauf
braucht Internet und dauert wegen Overpass-Timeouts mehrere Minuten; es
gibt kein festes Overpass-Rate-Limit, aber die üblichen Fair-Use-Regeln
des öffentlichen Overpass-Servers gelten (nicht parallelisieren, nicht in
kurzen Abständen wiederholen).

> **Rate-Limit betrifft im Normalbetrieb niemanden:** Die drei erzeugten
> Dateien (`data/datacenters.json`, `data/dams.json`, `data/cables-osm.json`)
> sind seit WEB-142 im Repository eingecheckt. Overpass wird also nur
> angefragt, wenn jemand den Snapshot mit
> `npm run build:infrastructure-mass` bewusst neu erzeugt — nicht im
> laufenden Betrieb und nicht beim Start.

### 🗺️ Karten und Gelände

| | Quelle | Schlüssel |
|---|---|---|
| Satellit / Hybrid | Esri World Imagery | nein |
| Karte | OpenStreetMap | nein |
| Relief | Esri World Topo | nein |
| 3D-Gelände | Cesium Ion World Terrain | Ion-Token |
| 3D-Gebäude grau | OSM Buildings via Ion | Ion-Token |
| 3D-Gebäude fotorealistisch | Google Map Tiles API | Google-Key |

> **Google:** Inhalte dürfen nicht zwischengespeichert oder weiterverbreitet
> werden – die App nutzt sie ausschließlich live, was zulässig ist. Der
> "Google"-Hinweis muss sichtbar bleiben.

---

## 4. Was noch nicht eingebaut ist

Aus dem Referenzprojekt sinnvoll ergänzbar, aber noch offen:

- **Sprachsteuerung des Globus** – im Referenzprojekt 28 Sprachbefehle über
  die OpenAI-Realtime-API. Mit der Claude API ließe sich das über
  Werkzeugaufrufe nachbauen.
- Militärflüge als eigener Layer (adsb.lol, Sonderfarbe) – Issue WEB-90.
- Verkehrs-Layer (OSM-Simulation, TomTom-Live optional) – Issue WEB-93.
- ÖPNV-Layer (GTFS-Realtime, 1–2 Städte) – Issue WEB-94.
- Street-Level-Panel (Mapillary) mit Abdeckungslinien – Issue WEB-95.
- ALPR-Kamerastandorte aus OpenStreetMap (nur Standorte, kein Tracking) –
  Issue WEB-99, PR offen.
- Erweiterte SGP4-Katalog-Anbindung (mehr CelesTrak-Gruppen) – Issue WEB-89.
- Zwei weitere Layer-Kandidaten in Recherche, noch nicht beauftragt:
  globales Strahlungsmessnetz (Safecast, CC0) und NOAA-Tsunami-Warnungen –
  Issue WEB-140.

---

## 4a. Sicherheitshinweise zu den Schlüsseln

**Cesium Ion** – Der Token liegt bewusst im Browser; das ist bei Cesium
so vorgesehen. Deiner ist an die Audience „World Viewer" gebunden und hat
kein Ablaufdatum. Sobald du die App öffentlich hostest, solltest du ihn
unter <https://ion.cesium.com> zusätzlich auf deine Domain beschränken –
sonst kann jemand dein Kontingent verbrauchen.

**NASA FIRMS** – Dieser Key ist ein echtes Geheimnis und steht deshalb
nur in `.env` auf dem Server. Er wird nie an den Browser ausgeliefert;
der Server sagt beim Start lediglich, dass er ihn gefunden hat, ohne den
Wert auszugeben. Das Kontingent gilt pro Key (5.000 Abrufe je 10 Minuten)
und wird durch den 30-Minuten-Cache des Servers geschont.

**Mapillary** – Dieser Key steht nur in `.env` auf dem Server. Bildsuche
und Abdeckungslinien laufen vollständig über den Server-Proxy; nur beim
tatsächlichen Öffnen eines Bildes im Panel holt sich der eingebettete
`mapillary-js`-Betrachter den Token einmalig über `/api/mapillary/token` –
er landet dabei nie in `config.js` oder einer anderen Datei im Repository.

**Falls ein Schlüssel doch einmal nach außen gelangt:** Beide lassen sich
ohne Aufwand ersetzen – bei Cesium unter „Access Tokens" einen neuen
anlegen und den alten löschen, bei FIRMS über dasselbe Formular einen
neuen anfordern.

## 5. Herkunft und Lizenzen

Teile dieses Projekts sind portiert aus **God's Eye View** von
**Bilawal Sidhu** – MIT-Lizenz, Copyright (c) 2026:
<https://github.com/bilawalsidhu/gods-eye-view>

Übernommen wurden: die Anbindung von CelesTrak, USGS, Launch Library 2,
NASA FIRMS, adsb.lol und den drei Kamerakatalogen, die Kategorisierung
und Farbgebung der Satelliten, sowie die Mathematik der Cockpit-Kamera
(Trägheitsanker, Korrekturbegrenzer, Kurs-Begrenzer). Die dortige
Bewegungsmathematik ist ihrerseits von **skylight** (MIT,
<https://github.com/cpaczek/skylight>) adaptiert.

Aus der WEB-81-Welle zusätzlich übernommen (Konzept/Code, keine Daten):
das Szenen-Regisseur-Prinzip (Kamerastationen + weiches Abfliegen), der
"Hangar" mit fünf 3D-Flugzeugmodellen samt Ausrichtungs-Offset, die
Methode zur Rekonstruktion einer Raketen-Aufstiegsbahn aus Startplatz und
Zielorbit (Launch-Replay) sowie die Tastatur-Belegung (1–7, H, D, C,
Backtick, Esc). GOES-Infrarot-Wolken, das Weltwetter-Raster und die
Infrastruktur-Massendaten sind dagegen eigenständige Ergänzungen ohne
GEV-Vorbild.

**Wichtig:** Die MIT-Lizenz deckt nur den **Quellcode** ab, nicht die
Daten. Jede Datenquelle behält ihre eigenen Bedingungen – die
Namensnennungen oben sind einzuhalten. Für eine kommerzielle Nutzung
sind besonders zu prüfen: OpenSky (nicht-kommerziell), Google Maps
(eigener Vertrag), TfL (Namensnennung Pflicht) und die
Nutzungsbedingungen der einzelnen Webcam-Betreiber.

### ✈️ 3D-Modelle für Flugzeuge (WEB-96)

Fünf GLB-Dateien, unverändert übernommen aus dem GEV-"Hangar"
(`public/models/` dort), dort bereits für die Web-Darstellung optimiert
(Geometrie/Material vereinfacht, Texturen verkleinert, Ausrichtung auf
reale Metergrößen gebacken). Keine eigene Nachbearbeitung unsererseits.
Alle **CC BY 4.0** – Namensnennung des jeweiligen Sketchfab-Urhebers ist
Pflicht, auch bei kommerzieller Nutzung:

| Datei | Original & Urheber | Quelle | Lizenz |
|---|---|---|---|
| `assets/models/b789.glb` | "Boeing 787-9" von [Nobilis 2](https://sketchfab.com/nobilishornet2) | [Sketchfab](https://sketchfab.com/3d-models/boeing-787-9-b6711e2e698e4e469675c1154a50b7a3) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `assets/models/atr72.glb` | "ATR 72 - 600" von [Oyan3D](https://sketchfab.com/oyan3D) | [Sketchfab](https://sketchfab.com/3d-models/atr-72-600-1e1a7186f7444d288675262fcee44744) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `assets/models/citation2.glb` | "1990 Cessna Citation, Texture Detailed, Exterior" von [BlenderCommunityHead](https://sketchfab.com/aboodgoudagad) | [Sketchfab](https://sketchfab.com/3d-models/1990-cessna-citation-texture-detailed-exterior-a78839624fe64900a8352cb23462350a) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `assets/models/bell206.glb` | "Bell 206 JetRanger" von [terran4627](https://sketchfab.com/terran4627) | [Sketchfab](https://sketchfab.com/3d-models/bell-206-jetranger-d2f7ba1d671549d4b26aaf834139a1dd) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| `assets/models/mq9.glb` | "MQ-9" von [IProZenoN](https://sketchfab.com/IProZenoN) | [Sketchfab](https://sketchfab.com/3d-models/mq-9-fabe963feb354c5584b51f9c470c3f7e) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |

Diese Credits ersetzen nicht die Namensnennung bei eigener
Weiterverbreitung der Dateien; sie implizieren keine Billigung durch
die Urheber. CC BY 4.0 erlaubt Teilen und Bearbeiten, auch kommerziell,
solange Namensnennung, Lizenzlink und Kennzeichnung von Änderungen
erhalten bleiben.
