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

Der wichtigste Punkt: **die Hälfte der App braucht den mitgelieferten Server.**
Flugzeuge, Satelliten, Webcam-Bilder, Brände, Raketenstarts und der
KI-Assistent laufen alle über `/api/…`-Endpunkte. Das sind keine Bequemlichkeit,
sondern Notwendigkeit – die Datenquellen setzen keine CORS-Header, ein
Browser darf sie also gar nicht direkt abfragen. Dazu kommt, dass alle
Zugangsdaten bewusst nur auf dem Server liegen.

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

**Funktioniert:** Satellitenkarte (Esri), Erdbeben (USGS), Bilder von
Wikipedia, Ortssuche, Zeitleiste, Demo-Flugzeuge und -Schiffe aus `data/`,
Kameras, die ihr Bild direkt herausgeben.

**Funktioniert nicht:** Live-Flugzeuge, echte Satellitenbahnen, Brände,
Raketenstarts, der Kamera-Proxy für hotlink-geschützte Webcams, der
KI-Assistent im Proxy-Modus.

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
{"ok":true,"keyConfigured":false,"flightProvider":"opensky","cameraProxy":true}
```

`keyConfigured: false` heißt: Es liegt kein `ANTHROPIC_API_KEY` auf dem
Server, der KI-Assistent fragt den Key dann im Chatfenster ab.
`flightProvider` zeigt, welcher Dienst die Flugdaten liefert.
