# World Viewer – Veröffentlichen und Hosten

Diese Datei beschreibt, wie das Projekt vom Quellcode zu einer erreichbaren
Adresse im Internet kommt – und welche Grenzen die einzelnen Wege haben.

---

## Kurzfassung

| Weg | Aufwand | Kosten | Was funktioniert |
|-----|---------|--------|------------------|
| **Lokal** (`node server/server.mjs`) | 1 Befehl | – | **alles** |
| **Render / Railway / Fly.io** | ~10 Min | kostenlos möglich | **alles** |
| **GitHub Pages** | 2 Klicks | – | nur der statische Teil (siehe unten) |

Der wichtigste Punkt: **die Mehrheit der 32 Layer braucht den
mitgelieferten Server.** Flugzeuge, Schiffe, Satelliten, ÖPNV, Verkehr,
Street-Level, Webcam-Bilder, Brände, Raketenstarts und der KI-Assistent
laufen alle über `/api/…`-Endpunkte. Das ist keine Bequemlichkeit, sondern
Notwendigkeit – die Datenquellen setzen keine CORS-Header, ein Browser
darf sie also gar nicht direkt abfragen. Dazu kommt, dass alle
Zugangsdaten bewusst nur auf dem Server liegen.

Welche Layer ohne Server auskommen, steht in Abschnitt 3.

---

## 1. Lokal starten

```bash
git clone https://github.com/germanengineerchris209/World-Viewer.git
cd World-Viewer

cp config.example.js config.js      # eigene Karten-Token eintragen
cp .env.example .env                # Server-Zugangsdaten eintragen

node server/server.mjs              # → http://localhost:8000
```

Node 18 oder neuer wird gebraucht, sonst nichts – das Projekt hat bewusst
**keine einzige npm-Abhängigkeit**.

Der Schritt `cp config.example.js config.js` ist optional: Fehlt `config.js`,
liefert der Server automatisch `config.example.js` aus. Die App startet dann
ohne Cesium-Ion-Token, also mit flacher Erde statt 3D-Gelände.

---

## 2. Hosten mit vollem Funktionsumfang (empfohlen)

### Render

Im Repository liegt bereits ein Blueprint (`render.yaml`):

1. Auf [render.com](https://render.com) einloggen → **New** → **Blueprint**
2. Dieses Repository auswählen – Render liest `render.yaml` selbst aus
3. Render fragt nach den Umgebungsvariablen. Einzutragen sind mindestens:

   | Variable | Wofür | Pflicht? |
   |----------|-------|----------|
   | `CESIUM_ION_TOKEN` | 3D-Gelände, OSM-Gebäude | empfohlen |
   | `FIRMS_MAP_KEY` | aktive Waldbrände | optional |
   | `ANTHROPIC_API_KEY` | KI-Assistent | optional |
   | `OPENSKY_CLIENT_ID` / `_SECRET` | mehr Flugdaten-Kontingent | optional |
   | `GOOGLE_MAPS_API_KEY` | fotorealistische 3D-Gebäude | optional |
   | `AISSTREAM_API_KEY` | echte Schiffspositionen statt Demo-Schiffen | optional |
   | `MAPILLARY_TOKEN` | Street-Level-Layer | optional |
   | `TOMTOM_API_KEY` | echte Verkehrsfluss-Daten | optional |
   | `TFL_APP_KEY` | mehr Kontingent für die Londoner Kameras | optional |
   | `LL2_API_TOKEN` | mehr Kontingent für Raketenstarts | optional |
   | `NASA_API_KEY` | Asteroiden ohne geteilten `DEMO_KEY` | optional |

   Alle genannten Variablen stehen mit `sync: false` im Blueprint – Render
   fragt sie also von selbst ab und schreibt sie nicht ins Repository.
   Keine davon ist Pflicht: Ohne Schlüssel läuft der betroffene Layer in
   einem reduzierten Modus und sagt das über seinen Status-Punkt.

4. Deploy starten. Nach ein bis zwei Minuten läuft die App.

**Zum kostenlosen Plan:** Der Dienst schläft nach 15 Minuten ohne Zugriff ein
und braucht beim nächsten Aufruf etwa 30 Sekunden zum Aufwachen. Für den
eigenen Gebrauch reicht das; für eine Adresse, die man weitergibt, lohnt der
kleinste bezahlte Plan.

### Railway / Fly.io / eigener Server

Gleiches Prinzip, ohne Blueprint-Datei:

* **Startbefehl:** `node server/server.mjs`
* **Build:** keiner
* **Port:** kommt aus `PORT`, der Server liest die Variable bereits aus
* **Umgebungsvariablen:** wie in der Tabelle oben

---

## 3. GitHub Pages – geht, kann aber weniger

Pages liefert nur Dateien aus, es läuft dort kein Node. Damit fällt alles weg,
was über den Server geht:

Von den 32 Layern läuft etwa ein Drittel ohne Server – nämlich die, deren
Quelle selbst CORS-Header setzt, plus die, die aus `data/` lesen.

**Funktioniert:** Satellitenkarte (Esri), Ortssuche, Zeitleiste, Bilder von
Wikipedia sowie alle rein clientseitigen Werkzeuge (Zeichnen & Messen,
Beobachtungszonen, Verknüpfungen/Graph, Kontakte-Roster, Szenen-Regisseur,
Routenplanung über OSRM, Sitzungs-Autosave, PWA-Offline-Shell).

Layer ohne Server: Erdbeben (USGS), Radiosender, Wetter, Luftqualität,
Weltwetter-Raster, Weltraumwetter, GOES-Wolken, Niederschlagsradar,
Leihräder (GBFS), Seekabel, Infrastruktur, Kraftstoffreserven, Heatmap.

**Funktioniert nicht:** Live-Flugzeuge und Militärflüge, Schiffe (AIS),
echte Satellitenbahnen, ÖPNV, Verkehr, Street-Level, Kennzeichenleser,
Brände, Raketenstarts, Asteroiden, Kometen, Wirbelstürme,
Tsunami-Warnungen, Strahlungsmessnetz, die globale Ereignis-Lage, die
Kamera-Kataloge und der Proxy für hotlink-geschützte Webcams, sowie der
KI-Assistent im Proxy-Modus.

Teilweise: **Satelliten**, **Vulkane**, **Kameras** und
**Allsky-Kameras** fallen auf die eingecheckten Schnappschüsse in `data/`
zurück – sie sind also sichtbar, aber nicht aktuell. Die betroffenen
Layer zeigen das von selbst über ihren Status-Punkt („Schlüssel fehlt"
bzw. „Fehler"), es bleibt also nicht im Verborgenen.

Wenn das reicht:

1. Repository → **Settings** → **Pages**
2. *Source*: `Deploy from a branch`, Branch `main`, Ordner `/ (root)`
3. Speichern. Die Adresse erscheint nach ein bis zwei Minuten.

Wichtig: `config.js` steht in `.gitignore` und ist auf Pages deshalb **nicht**
vorhanden – und der Server, der sonst `config.example.js` einspringen lässt,
läuft dort nicht. Für Pages muss also eine `config.js` mit leeren oder
domain-beschränkten Token eingecheckt werden. Ein Cesium-Ion-Token, der
öffentlich im Repository liegt, gehört vorher im
[Ion-Dashboard](https://ion.cesium.com) auf die eigene Pages-Domain
beschränkt.

Der KI-Assistent lässt sich auf Pages nur im Modus `direct` betreiben – dabei
gibt jeder Besucher seinen eigenen Anthropic-Key im Chatfenster ein. Ein Key
in einer eingecheckten `config.js` wäre für alle lesbar und innerhalb von
Stunden missbraucht.

---

## Zugangsdaten – was wohin gehört

| Ort | Inhalt | Im Repository? |
|-----|--------|----------------|
| `.env` | alle Server-Keys (Anthropic, FIRMS, OpenSky, FR24 …) | **nein**, steht in `.gitignore` |
| `config.js` | Karten-Token für den Browser | **nein**, steht in `.gitignore` |
| `config.example.js` | dieselbe Struktur, alle Werte leer | ja |
| Umgebungsvariablen beim Hoster | alles aus `.env` plus `CESIUM_ION_TOKEN` | – |

Ein Cesium-Ion-Token muss zwangsläufig in den Browser – so ist Cesium gebaut.
Er lässt sich aber im Ion-Dashboard auf die eigene Domain beschränken, und
genau das sollte vor dem ersten öffentlichen Deploy passieren.

Alle anderen Keys bleiben auf dem Server. Sollte doch einmal einer nach außen
gelangen: alle hier verwendeten Dienste erlauben es, den Key zu widerrufen und
einen neuen zu erzeugen – das dauert jeweils unter einer Minute.

---

## Nach dem Deploy prüfen

```bash
curl https://DEINE-ADRESSE/api/health
```

Die Antwort sieht so aus:

```json
{"ok":true,"keyConfigured":false,"flightProvider":"opensky","cameraProxy":true,"aisConfigured":false}
```

- `keyConfigured: false` – es liegt kein `ANTHROPIC_API_KEY` auf dem
  Server; der KI-Assistent fragt den Key dann im Chatfenster ab.
- `flightProvider` – welcher Dienst die Flugdaten liefert.
- `aisConfigured: false` – kein `AISSTREAM_API_KEY`, der Schiffs-Layer
  zeigt dann die zehn Demo-Schiffe aus `data/ships.json`.

Den vollständigen Überblick, welche Dienste scharf sind, gibt

```bash
npm run doctor
```

im Terminal des Hosters – bzw. das POWER-UP-Panel („🔑 Schlüssel &
Dienste") in der laufenden App. Beide lesen dieselbe Liste aus
`server/keyRegistry.mjs` und geben nie einen Schlüsselwert aus, nur ob er
gesetzt ist.
