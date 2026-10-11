# WEB-83 — Datenquellen-Spezifikation: Verkehr, ÖPNV, Street-Level, Militärflüge

**Status:** Recherche abgeschlossen, keine Implementierung.
**Zweck:** Machbarkeitsklärung vorwegnehmen, damit der Frontend-Engineer bei
F2 (Militärflüge), F5 (Verkehr), F6 (ÖPNV) und F7 (Street-Level) direkt mit
der Umsetzung beginnen kann. Referenz: [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)
(MIT), Epic WEB-81.

Alle Angaben unten sind am 2026-10-11 per `curl` gegen die echten Endpunkte
verifiziert (Request/Response/Header), sofern nicht anders vermerkt.

---

## 1. Verkehr (F5)

### 1a. Straßengeometrie als Simulationsgrundlage — Overpass API (OpenStreetMap)

- **Endpunkt:** `POST https://overpass-api.de/api/interpreter` (Body: `data=<Overpass-QL>`),
  alternative Instanzen: `overpass.kumi.systems`, `z.overpass-api.de` (Lastverteilung,
  gleiche Semantik).
- **Beispiel-Request:**
  ```
  POST https://overpass-api.de/api/interpreter
  Content-Type: application/x-www-form-urlencoded

  data=[out:json][timeout:25];way["highway"~"^(primary|secondary|tertiary)$"](50.0,8.0,50.02,8.02);out geom;
  ```
- **Beispiel-Antwort (gekürzt):**
  ```json
  {
    "version": 0.6,
    "elements": [
      { "type": "way", "id": 123456, "tags": { "highway": "primary", "name": "Musterstraße" },
        "geometry": [ { "lat": 50.001, "lon": 8.004 }, { "lat": 50.003, "lon": 8.006 } ] }
    ]
  }
  ```
- **Schlüsselpflicht:** keiner.
- **CORS:** **konnte aus dieser Recherche-Sandbox nicht verifiziert werden** —
  jeder Request gegen `overpass-api.de` (auch `GET /` und `/api/status`) kam
  mit `406 Not Acceptable` zurück, während alle anderen in diesem Dokument
  getesteten Hosts normal antworteten. Das deutet auf eine IP-/Datacenter-Sperre
  der Sandbox-Ausgangs-IP hin (öffentliche Overpass-Instanzen filtern Cloud-IP-
  Bereiche aktiv, bekanntes Verhalten in der OSM-Community), nicht auf eine
  generelle Nichterreichbarkeit. **Der Frontend-Engineer muss das von einer
  normalen Entwickler-Internetverbindung aus selbst mit `curl -D -` prüfen**,
  bevor er auf Browser-Direktzugriff plant. Nach offizieller Dokumentation
  (https://wiki.openstreetmap.org/wiki/Overpass_API) setzt Overpass keine
  CORS-Header explizit zu, viele Clients (z.B. overpass-turbo) rufen dennoch
  direkt aus dem Browser auf — im Zweifel über `server/dataProxies.mjs`
  spiegeln, analog zum bestehenden NHC/CelesTrak-Muster.
- **Rate-Limits:** keine feste Zahl, sondern ein Fair-Use-System: 2 parallele
  Slots pro IP, große/teure Queries werden gedrosselt (`/api/status` zeigt
  Slot-Belegung). **Empfehlung:** Straßengeometrie ändert sich praktisch nie —
  **einmalig pro Stadt/Kartenausschnitt abrufen und als statische Datei
  cachen** (analog zu `npm run build:volcanoes` → `data/volcanoes.json`),
  nicht live pollen. Serverseitiger Cache ≥ 24h, wenn doch live angefragt wird.
- **Lizenz:** ODbL (OpenStreetMap-Lizenz) — Namensnennung "© OpenStreetMap
  contributors" Pflicht, abgeleitete Daten müssen unter gleichen Bedingungen
  weitergegeben werden (Share-Alike), sofern sie veröffentlicht werden.
- **Technischer Ansatz:** Build-Skript nach Vorbild `scripts/` (siehe
  `npm run build:volcanoes`), das für eine handkuratierte Städteliste
  Straßensegmente als GeoJSON in `data/traffic-roads-<stadt>.json` ablegt.
  Simulierte Fahrzeuge bewegen sich clientseitig entlang dieser Polylinien
  (kein Live-Datenbedarf für die Simulation selbst).
- **Aufwand:** mittel (neues Build-Skript + Simulationslogik, aber kein
  Server-Dauerbetrieb nötig).

### 1b. TomTom Traffic Flow Segment Data (optionale Live-Schicht)

- **Endpunkt:** `GET https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point={lat},{lon}&key={KEY}`
- **Beispiel-Request:**
  ```
  GET https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=52.41072,4.84239&key=DEIN_KEY
  ```
- **Beispiel-Antwort (gekürzt, laut TomTom-Doku):**
  ```json
  {
    "flowSegmentData": {
      "frc": "FRC2",
      "currentSpeed": 29, "freeFlowSpeed": 59,
      "currentTravelTime": 32, "freeFlowTravelTime": 16,
      "confidence": 0.97, "roadClosure": false,
      "coordinates": { "coordinate": [ { "latitude": 52.41, "longitude": 4.84 } ] }
    }
  }
  ```
  Ohne gültigen Key (verifiziert): `401` mit
  `{"detailedError":{"code":"Unauthorized","message":"You are missing valid authentication credentials"}}`.
- **Schlüsselpflicht:** Gratis-Registrierung nötig. Anlegen unter
  <https://developer.tomtom.com> → "My Account" → "API Keys". Freies
  Kontingent: **2.500 Requests/Tag** im Developer-Tier (Stand TomTom-Preisseite,
  vom Frontend-Engineer vor Einsatz gegen die aktuelle TomTom-Preisseite zu
  bestätigen, da Anbieter-Kontingente sich ändern).
- **CORS:** in der Fehlerantwort **kein** `Access-Control-Allow-Origin`-Header
  gesetzt (verifiziert). Unabhängig davon gilt im Projekt die etablierte Regel
  aus `DATENQUELLEN.md`: echte API-Keys sind Geheimnisse und gehören
  ausschließlich in `.env`, nie in `config.js`/Browser. **Also in jedem Fall
  Server-Proxy** über `server/dataProxies.mjs`, kein direkter Browser-Call.
- **Rate-Limits:** 2.500/Tag (Gratis-Tier). Ein Segment deckt nur einen Punkt
  ab, d.h. pro sichtbarem Kartenausschnitt sind mehrere Abfragen nötig.
  **Empfehlung:** nur für den sichtbaren Ausschnitt abfragen, serverseitig
  **5 Minuten cachen** (Verkehrsfluss ändert sich nicht sekündlich, TomTom
  selbst aktualisiert in diesem Rhythmus), Anzahl Punkte pro Ausschnitt
  begrenzen (z.B. max. 20 handkuratierte Straßenabschnitte je Stadt, analog
  zum AQI-/Kamera-Muster mit handkuratierten Listen statt Auto-Discovery).
- **Lizenz/Nutzungsbedingungen:** TomTom-Entwicklerlizenz — nicht-kommerzielle
  Nutzung im Gratis-Tier erlaubt, Darstellung erfordert "Powered by TomTom"-
  Attribution (TomTom-Branding-Richtlinien beachten).
- **Abgrenzung:** Diese Schicht ist **rein optional und schlüsselpflichtig** —
  die Basis-Verkehrssimulation (1a) funktioniert vollständig ohne sie. Kein
  automatisches Aktivieren ohne gesetzten `.env`-Key (Server meldet beim Start
  "Verkehr (TomTom): kein TOMTOM_API_KEY gesetzt", analog zum FIRMS-Muster).
- **Aufwand:** klein (ein Proxy-Endpunkt + Legende), vorausgesetzt der
  Produktverantwortliche entscheidet sich bewusst für den neuen Schlüssel.

---

## 2. ÖPNV (F6) — GTFS-Realtime

GTFS-Realtime ist ein offener Standard (Google/MobilityData) auf Basis von
**Protocol Buffers (Protobuf)**, nicht JSON. Das ist das im Issue erwähnte
"Protobuf-Problem ohne Build-Schritt": Es gibt keine fertige CDN-`<script>`-
Bibliothek, die GTFS-RT ohne `npm install`/Build-Schritt im Browser dekodiert.

**Empfohlene Lösung (passt zum bestehenden Muster):** Das Projekt hat bereits
zweimal ein Binärformat ohne npm-Paket selbst dekodiert (`server/kmz.mjs` für
NHC-Kegel-KMZ via Node-`zlib`, `server/volcanoLabels.mjs`). GTFS-RT ist dafür
sogar einfacher: Das Protobuf-Drahtformat ist nur Varints + Length-Delimited-
Felder, das GTFS-RT-Schema (`FeedMessage` → `FeedEntity` → `VehiclePosition`/
`TripUpdate`) ist stabil und öffentlich dokumentiert
(<https://gtfs.org/realtime/reference/>). Ein **minimaler handgeschriebener
Decoder** (~100–150 Zeilen `server/gtfsRealtime.mjs`), der nur die für die
Karte relevanten Felder ausliest (Fahrzeugposition, Bearing, Trip-ID, Zeit-
stempel; bei TripUpdate: Stop-ID, Verspätung), reicht aus — **kein npm-Paket,
kein Build-Schritt.** Der Server dekodiert serverseitig und liefert sauberes
JSON an den Browser, genau wie bei KMZ.

### Empfehlung für 1–2 Städte mit offenem, schlüsselfreiem Feed

**1. MBTA (Boston, USA)** — am offensten verifiziert:
- **Endpunkt:** `GET https://cdn.mbta.com/realtime/VehiclePositions.pb`
  (zusätzlich `TripUpdates.pb`, `Alerts.pb` unter gleichem Pfad-Schema)
- **Verifiziert:** `200 OK`, `content-type: application/x-protobuf`,
  `content-length: 14152`, ausgeliefert über CloudFront. **Kein**
  `Access-Control-Allow-Origin`-Header → Server-Proxy nötig (ohnehin wegen
  Protobuf-Dekodierung serverseitig erforderlich).
- **Schlüsselpflicht:** keiner für diesen CDN-Pfad (die separate MBTA-V3-
  JSON-API verlangt einen Gratis-Key, dieser GTFS-RT-CDN-Pfad nicht).
- **Rate-Limits:** nicht dokumentiert/nicht nötig (statischer CDN-Pfad,
  MBTA aktualisiert die Datei selbst alle ~15–30s). **Empfehlung:**
  serverseitig **alle 20–30 Sekunden** abrufen und **20 Sekunden cachen**.
- **Lizenz:** MBTA stellt GTFS/GTFS-RT unter offener Nutzung bereit
  (siehe <https://www.mbta.com/developers>), Namensnennung "Data provided
  by MBTA" üblich/empfohlen.

**2. OVapi (Niederlande, landesweiter Community-Aggregator)** — Alternative
mit größerer Fahrzeugdichte, falls ein europäisches Beispiel gewünscht ist:
- **Endpunkt:** `GET https://gtfs.ovapi.nl/nl/vehiclePositions.pb`
  (auch `tripUpdates.pb`; Verzeichnis `nl/` bündelt alle niederländischen
  Verkehrsbetreiber in einem Feed)
- **Verifiziert:** `200 OK`, `content-length: 266953` (deutlich mehr
  Fahrzeuge als MBTA, da landesweit). Kein CORS-Header → Proxy nötig.
- **Schlüsselpflicht:** keiner.
- **Rate-Limits:** nicht dokumentiert, Feed wird von OVapi selbst alle
  ~30s aktualisiert. Gleiche Empfehlung: alle 20–30s abrufen, 20s cachen.
- **Lizenz:** OVapi ist ein Community-Projekt auf Basis der niederländischen
  offenen ÖPNV-Daten (NDOV); Nutzung frei, Herkunftsnennung "OVapi /
  Nationale Databank Openbaar Vervoer (NDOV)" angebracht.

*Zusätzlich geprüft und funktionsfähig, aber nicht empfohlen als
Erst-Implementierung:* **SEPTA** (Philadelphia) liefert
`https://www3.septa.org/gtfsrt/septa-pa-us/Trip/rtTripUpdates.pb` ebenfalls
ohne Key (verifiziert `200`, 360 KB), aber nur TripUpdates, keine
VehiclePositions unter gleich einfachem Pfad — für eine Kartendarstellung
ist der Positions-Feed wichtiger, daher MBTA/OVapi vorziehen.

- **Technischer Ansatz:** `server/gtfsRealtime.mjs` (neuer, reiner
  Varint/Protobuf-Wire-Format-Decoder, keine Abhängigkeit) + Proxy-Route
  `/api/transit/<stadt>` in `server/dataProxies.mjs`, die Feed abruft,
  dekodiert, auf das Projekt-Standardformat (wie bei Flugzeugen: Liste von
  `{lat, lon, bearing, label, timestamp}`) abbildet. Statische `stops.txt`/
  `routes.txt` (GTFS-Schedule, kein Realtime) separat einmalig laden, falls
  Linien-/Haltestellennamen angezeigt werden sollen — das ist reines CSV,
  kein Protobuf.
- **Aufwand:** mittel (der Protobuf-Decoder ist der aufwändigste Teil,
  danach ist die Anbindung analog zu bestehenden Proxies).
- **Abgrenzung:** keine Fahrgast-/Ticket-Daten, nur Fahrzeugpositionen und
  Fahrplanabweichungen — kein Personenbezug.

---

## 3. Street-Level (F7) — Mapillary Graph API

- **Endpunkt (Bild-Metadaten/Suche):**
  `GET https://graph.mapillary.com/images?access_token={TOKEN}&fields=id,geometry,thumb_1024_url,captured_at,compass_angle&bbox={minLon},{minLat},{maxLon},{maxLat}`
- **Beispiel-Request:**
  ```
  GET https://graph.mapillary.com/images?access_token=MLY|XXXX|YYYY&fields=id,geometry,thumb_1024_url,captured_at,compass_angle&bbox=8.6,50.1,8.7,50.2
  ```
- **Beispiel-Antwort (gekürzt, laut Mapillary-Doku):**
  ```json
  {
    "data": [
      { "id": "1234567890123456",
        "geometry": { "type": "Point", "coordinates": [8.651, 50.112] },
        "compass_angle": 134.2, "captured_at": 1699999999000,
        "thumb_1024_url": "https://scontent.xx.fbcdn.net/...jpg" }
    ]
  }
  ```
- **Coverage-Kacheln (Vector Tiles für "wo gibt es Bilder" ohne Einzelabfrage):**
  `GET https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token={TOKEN}`
  (Mapbox-Vector-Tile-Format, zum Einzeichnen der Abdeckung ohne tausende
  Einzelbild-Requests — empfohlen für die Übersichtsdarstellung, bevor man
  in ein Gebiet hineinzoomt).
- **Viewer-Einbettung:** Mapillary stellt einen fertigen JS-Viewer bereit,
  einbindbar via CDN ohne Build-Schritt:
  `https://unpkg.com/mapillary-js@4/dist/mapillary.css` +
  `https://unpkg.com/mapillary-js@4/dist/mapillary.js` (passt zum
  CDN-Only-Muster des Projekts, genau wie CesiumJS).
- **Schlüsselpflicht:** Gratis-Registrierung. Ablauf: Meta-/Mapillary-Account
  → <https://www.mapillary.com/dashboard/developers> → "Register application"
  → liefert einen **Client Token** (Format `MLY|<app-id>|<token>`).
  Dieser Token ist – analog zum Cesium-Ion-Token – für Client-seitige
  Nutzung in Web-Apps vorgesehen, kein reines Server-Geheimnis wie FIRMS.
- **CORS:** **verifiziert offen** — `access-control-allow-origin: *` steht
  in der Antwort der Graph API auch im Fehlerfall (`400` bei ungültigem
  Token). **Direkter Browser-Zugriff ist möglich, kein Server-Proxy nötig.**
  Empfehlung: Token trotzdem wie den Cesium-Ion-Token in `config.js` ablegen
  (nicht in `.env`), da er ohnehin im Browser sichtbar wird; falls Mapillary
  eine Domain-Beschränkung in den App-Einstellungen anbietet, diese aktivieren.
- **Rate-Limits:** von Mapillary nicht in Zahlen dokumentiert, aber pro
  registrierter App begrenzt (Fair-Use). **Empfehlung:** nur Coverage-Kacheln
  für den sichtbaren Kartenausschnitt laden, Bild-Metadaten erst bei Klick
  auf eine Kachel/einen Punkt nachladen (Lazy-Loading, kein Dauerpolling nötig
  — Street-Level-Bilder ändern sich nicht in Echtzeit). Clientseitiger Cache
  pro Kachel ausreichend, kein Server-Proxy-Cache nötig, da CORS offen.
- **Lizenz/Nutzungsbedingungen:** Bilder stehen unter CC-BY-SA (Mapillary-
  Nutzungsbedingungen, <https://www.mapillary.com/termsofuse>) — Namensnennung
  "Imagery © Mapillary contributors" pro Bild/Viewer erforderlich. Keine
  Gesichtserkennung/kein Personen-Tracking (Mapillary verpixelt Gesichter/
  Kennzeichen bereits selbst, zusätzliche Erkennung im Viewer ist explizit
  **nicht** vorzusehen — deckt sich mit der Projektgrenze aus WEB-81).
- **Technischer Ansatz:** rein clientseitig, neuer `js/layers/StreetLevelLayer.js`
  nach bestehendem `BaseLayer`-Muster: Vector-Tile-Layer für Coverage (zeigt
  blaue Linien/Punkte, wo Street-Level-Bilder existieren), Klick öffnet
  `mapillary-js`-Viewer in einem Panel. Kein Server-Code nötig außer dem
  üblichen vierten Registrierungspunkt (`index.html`, `config.js`, `js/app.js`,
  `style.css`).
- **Aufwand:** klein bis mittel (kein Proxy, aber neue Fremdbibliothek
  `mapillary-js` per CDN einzubinden und Viewer-UI zu bauen).

---

## 4. Militärflüge (F2) — adsb.lol

- **Endpunkt:** `GET https://api.adsb.lol/v2/mil` (keine Parameter — liefert
  weltweit alle aktuell über ADS-B/MLAT sichtbaren Militär-Transponder).
- **Verifiziert:**
  ```
  GET https://api.adsb.lol/v2/mil
  → 200 OK, content-type: application/json, 35.359 Bytes
  ```
  ```json
  {"ac":[
    {"hex":"ae0113","type":"adsb_icao","flight":"TEAL78  ","r":"96-5302","t":"C30J",
     "alt_baro":27000,"gs":337.5,"track":51.74,"squawk":"2415","category":"A3",
     "lat":25.851974,"lon":-97.442201, "seen":0.3,"rssi":-17.8},
    ...
  ], "now": 1760175159}
  ```
- **Besonderheit:** Der Server-Code hat das bereits vorbereitet. In
  `server/flightProviders.mjs:352` existiert `fetchAdsbLolMilitary()` —
  ruft exakt diesen Endpunkt auf, normalisiert die Zeilen über die
  bestehende `normalizeAdsbLolRow()`-Funktion (dieselbe wie für den
  normalen adsb.lol-Flugprovider) und markiert jeden Datensatz mit
  `military: true`. **Es fehlt nur noch:** eine Route in `server/server.mjs`
  (z.B. `GET /api/aircraft/military`, nach Vorbild der bestehenden
  `/api/aircraft`-Route) und die Anbindung im Frontend (`AircraftLayer.js`
  bzw. ein eigener Darstellungsmodus/Filter, z.B. andere Farbe/Icon für
  `military: true`).
- **Schlüsselpflicht:** keiner.
- **CORS:** **kein** `Access-Control-Allow-Origin`-Header (verifiziert) →
  Server-Proxy nötig, ist aber durch die bestehende Server-Architektur
  (adsb.lol läuft ohnehin nur serverseitig) bereits gegeben.
- **Rate-Limits:** von adsb.lol nicht in Zahlen dokumentiert, Projekt-Praxis
  laut `DATENQUELLEN.md` ist ein Mindestintervall von 12s für den regulären
  adsb.lol-Flugprovider. **Empfehlung für den Militär-Feed:** da weltweit
  und nicht ausschnittsgebunden, reicht ein **Serverintervall von 15–30
  Sekunden mit 15s-Cache** (gleiche Größenordnung wie der bestehende
  Flugzeug-Cache, siehe `MIN_FETCH_INTERVAL_MS` in `server/server.mjs`).
  Kein bounding-box-Filtering durch adsb.lol selbst nötig, da der Endpunkt
  ohnehin weltweit liefert — Filterung auf den sichtbaren Kartenausschnitt
  geschieht wie bei den übrigen Flugzeugen clientseitig.
- **Lizenz:** ODbL 1.0 (wie beim regulären adsb.lol-Feed bereits in
  `DATENQUELLEN.md` vermerkt) — Namensnennung "ADS-B data via adsb.lol,
  ODbL 1.0" erforderlich.
- **Abgrenzung:** reine Flugzeug-/Transponderdaten (Position, Typ, Rufzeichen
  soweit gesendet), kein Rückschluss auf Personen, keine Anreicherung mit
  Personendaten. Militärflugzeuge senden ADS-B oft bewusst nicht oder mit
  anonymisiertem ICAO-Hex — das ist eine Dateneigenschaft, keine Lücke der
  Implementierung.
- **Aufwand:** **klein** — Normalisierung existiert bereits, es fehlen nur
  Route + Frontend-Darstellung.

---

## 5. Zusammenfassung für die Priorisierung

| # | Feature | Schlüssel | CORS | Aufwand | Bereits vorbereitet |
|---|---|---|---|---|---|
| F2 Militärflüge | keiner | nein (Proxy vorhanden) | **klein** | `fetchAdsbLolMilitary()` existiert bereits, nur Route+UI fehlen |
| F7 Street-Level | Gratis (Mapillary) | **ja, offen** | klein–mittel | – |
| F5a Verkehr (OSM-Basis) | keiner | ungeklärt (Sandbox-Block), vor Ort erneut prüfen | mittel | – |
| F6 ÖPNV (GTFS-RT) | keiner (MBTA/OVapi) | nein (Proxy nötig, aber wegen Protobuf ohnehin serverseitig) | mittel (neuer Protobuf-Mini-Decoder) | – |
| F5b Verkehr (TomTom live) | Gratis-Registrierung nötig | nein (Proxy) | klein, aber **neuer Schlüssel = Entscheidung durch Product Owner** | – |

**Empfehlung für die Umsetzungsreihenfolge:** F2 zuerst (am billigsten, Code
schon da), dann F7 (kein Server-Code), dann F6, dann F5a; F5b (TomTom) erst
nach expliziter Freigabe des neuen Schlüssels durch den Product Owner — passt
zum bisherigen Muster, dass neue `.env`-Schlüssel immer eine bewusste
Entscheidung sind (vgl. `DATENQUELLEN.md` Abschnitt 0).

## 6. Was dieses Dokument NICHT tut

- Keine Implementierung, kein Code wurde geschrieben oder verändert.
- Keine neuen Schlüssel wurden angelegt oder ins Repo eingetragen.
- Für TomTom wird kein Schlüssel vorausgesetzt — die Nutzung bleibt bis zur
  expliziten Freigabe optional und ungenutzt.
- Keine Quelle, die Anmeldung mit Kosten voraussetzt oder Nutzungsbedingungen/
  Sicherheitslücken verletzt, wurde aufgenommen.
