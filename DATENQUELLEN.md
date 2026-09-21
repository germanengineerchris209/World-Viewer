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
| 🛰️ Satelliten (echte Bahnen) | CelesTrak + SGP4 | |
| 🌋 Erdbeben | USGS | letzte 24 Stunden |
| 🚀 Raketenstarts | Launch Library 2 | 15 Abrufe/Stunde |
| 📷 Verkehrskameras | TfL London, Caltrans, Austin | mehrere hundert Kameras |
| 📷 Einzelne Webcams | feratel, terra-hd, YouTube, NOAA | |
| Objektfotos | Wikipedia | |
| Ortsnamen | OpenStreetMap/Nominatim | |

### 🟡 Kostenloser Schlüssel nötig

| Ebene / Funktion | Quelle | Schlüssel holen |
|---|---|---|
| 🔥 Aktive Brände | NASA FIRMS | ✅ eingetragen |
| 3D-Gelände, 3D-Gebäude (grau) | Cesium Ion | ✅ eingetragen |
| 🚢 Schiffe (echte AIS-Daten) | AISStream | <https://aisstream.io> → Account → API Keys |
| ✈️ Mehr Flug-Kontingent | OpenSky-Konto | <https://opensky-network.org> → OAuth2-Client |
| 🚀 Mehr Start-Kontingent | Launch Library 2 | <https://ll.thespacedevs.com/docs/> |
| 📷 Mehr TfL-Kontingent | TfL Open Data | <https://api-portal.tfl.gov.uk> |

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

### 🛰️ Satelliten

Bahndaten (TLE) von **CelesTrak**, gerechnet mit dem SGP4-Modell aus
`satellite.js`. Die Positionen stimmen dadurch mit der Wirklichkeit
überein – die ISS erscheint auf 420 km Höhe bei 27.600 km/h.

Endpunkt: `celestrak.org/NORAD/elements/gp.php?GROUP=<gruppe>&FORMAT=tle`
Gruppen in `config.js`: `stations`, `visual`, `gps-ops`, `galileo`, `geo`,
optional `starlink` (bringt tausende Objekte).

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
- Verkehrslage (TomTom), Seekabel, Rechenzentren, Staudämme, Radiosender,
  Leihräder, Wetter im Cockpit.

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

**Wichtig:** Die MIT-Lizenz deckt nur den **Quellcode** ab, nicht die
Daten. Jede Datenquelle behält ihre eigenen Bedingungen – die
Namensnennungen oben sind einzuhalten. Für eine kommerzielle Nutzung
sind besonders zu prüfen: OpenSky (nicht-kommerziell), Google Maps
(eigener Vertrag), TfL (Namensnennung Pflicht) und die
Nutzungsbedingungen der einzelnen Webcam-Betreiber.
