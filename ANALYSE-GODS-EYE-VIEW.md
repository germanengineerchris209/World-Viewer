# Vergleich mit „God's Eye View" & Verbesserungsvorschläge

Stand: 12.10.2026 · Referenzprojekt: [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT-Lizenz)

Dieses Dokument vergleicht den **heutigen Stand von ARGUS (`origin/main`,
Commit `5f34a18`)** mit dem **heutigen Stand von God's Eye View (GEV) `main`**
(README-Stand Oktober 2026). Es löst die Fassung vom 17.09.2026 ab, die
veraltet war: Tier 1 ist seither komplett umgesetzt, aus Tier 2 sind
Routenplanung, Radio, Wetter (kuratiert) und Setup-Diagnose eingebaut, aus
Tier 3 sind Zeichnen/Messen, taktisches HUD und Erkennungs-Overlay fertig.
Zusätzlich hat ARGUS mehrere Layer bekommen, die **GEV gar nicht kennt**
(Asteroiden, Kometen, Tiefraum-Sonden, Weltraumschrott, Weltraumwetter,
Vulkane, Luftqualität, Kraftstoffreserven, Lage/GDELT, Pattern-of-Life,
Link-Analyse) – siehe Abschnitt 4.

**Wichtiger Hinweis zum Stand von `main`:** Der lokale Checkout, in dem
dieser Task läuft, ist Teil eines gemeinsam genutzten Arbeitsbaums, in dem
mehrere Agenten parallel an offenen Branches arbeiten. Der lokale `main`
lag beim Schreiben dieses Dokuments 3 Commits **hinter** `origin/main` (u. a.
fehlten dort bereits gemergte Layer wie Asteroiden/Kometen/Weltraumwetter)
und enthielt umgekehrt 3 Commits, die **noch nicht** auf `origin/main`
gemerged waren (Regenradar WEB-67, Leihräder WEB-70, Kamera-Sichtfeld-Kegel
WEB-72 – vermutlich offene PRs). Alle Aussagen unten beziehen sich auf
**`origin/main`**, den tatsächlich gemergten Stand, nicht auf den lokalen
Checkout. Die drei genannten Features sind daher unten als **„fehlt (PR
noch offen, nicht in `origin/main` gemerged)"** markiert, obwohl der Code
dafür im Repo an anderer Stelle bereits existiert.

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
| Militärflüge amber-markiert | ❌ fehlt | — | — | — | Teil-Infrastruktur vorhanden: `server/flightProviders.mjs` enthält bereits eine Funktion, die ADS-B-Militärflüge mit `military: true` markiert, ist aber **nirgends verdrahtet** (kein Server-Route, kein Layer, kein UI-Toggle) |
| Live-Schiffe (AIS) | ✅ vorhanden | AISStream | ja (kostenlos) | kostenlos | `js/layers/ShipLayer.js`, `js/shipData.js`, `server/aisStream.mjs` |
| Satelliten (GEV: 838-Katalog, SGP4, Orbit-Ringe) | 🟡 teilweise | CelesTrak TLE + `satellite.js` (SGP4) | nein | kostenlos | `js/layers/SatelliteLayer.js` — Begründung: **echte SGP4-Propagation ist seit WEB-31 umgesetzt** (nicht mehr die alte Kreisbahn-Näherung), inkl. eigener Weltraumschrott-Gruppe; live bis zu 5 Gruppen × 60 Objekte (≈300) gegen GEV 838. Nur der **Demo-Fallback** ohne Netz nutzt noch 12 Objekte mit vereinfachter Kreisbahn (`data/satellites.json`) |
| 3D-Flugzeugmodelle je Klasse (787, ATR-72, Citation, Bell 206, MQ-9) | ❌ fehlt | — | — | — | nur Icon/Glyph in `js/layers/AircraftLayer.js`; `js/cockpit.js` zeigt Kamerafahrt, aber kein Modellwechsel beim Heranzoomen |

### 2.2 Infrastruktur & feste Objekte

| Feature (GEV) | Status | Datenquelle (ARGUS) | Schlüssel | Kostenrisiko | Datei(en) |
|---|---|---|---|---|---|
| Rechenzentren (GEV: 4.351) | 🟡 teilweise | handkuratiert | nein | kostenlos | `data/infrastructure.json` (Kategorie `datacenter`) — Begründung: 5 Objekte gegen 4.351, gleiche Darstellung (Punkt + Kategorie-Icon), aber keine Massendaten-Quelle angebunden |
| Staudämme (GEV: 704) | 🟡 teilweise | handkuratiert | nein | kostenlos | `data/infrastructure.json` (Kategorie `dam`) — 4 Objekte gegen 704 |
| Unterseekabel (GEV: 712 Trassen) | 🟡 teilweise | handkuratiert, vereinfachte Geodäten | nein | kostenlos | `data/cables.json`, `js/layers/CableLayer.js` — 16 Trassen gegen 712, aber Kernfunktion (Linienzug auf dem Globus) identisch |
| Militär-Standorte (OSM-Community-Mapping) | ❌ fehlt | — | — | — | – |
| ALPR-Kamera-Standorte (OSM-Tags) | ❌ fehlt | — | — | — | – (siehe auch Abschnitt 5 – ethisch sensibel, bewusste Zurückhaltung empfohlen) |

### 2.3 Verkehr & Mobilität

| Feature (GEV) | Status | Datenquelle (ARGUS) | Schlüssel | Kostenrisiko | Datei(en) |
|---|---|---|---|---|---|
| Verkehrssimulation (OSM-Fahrzeuge + TomTom-Live-Stauwerte) | ❌ fehlt | — | — | — | – |
| ÖPNV live (Bus/Tram/Metro/Fähre, GTFS-Realtime) | ❌ fehlt | — | — | — | – |
| Leihräder/E-Scooter (GBFS) | ❌ fehlt (PR noch offen, nicht in `origin/main` gemerged) | GBFS (9 Systeme handkuratiert) | nein | kostenlos | Code existiert als `js/layers/BikeShareLayer.js` **auf unmergtem lokalem Branch** (WEB-70) — sobald gemerged: ✅ vorhanden |
| Routenplanung (Fuß/Rad/Auto) | ✅ vorhanden | OSRM (FOSSGIS-Demo-Server) | nein | kostenlos | `js/routeTool.js`, `js/drawToolsPanel.js` |

### 2.4 Kameras & Beobachtung

| Feature (GEV) | Status | Datenquelle (ARGUS) | Schlüssel | Kostenrisiko | Datei(en) |
|---|---|---|---|---|---|
| CCTV-Mesh (GEV: ~3.900, 11 Regionen) | 🟡 teilweise | TfL London, Caltrans, Austin + eigene Kameras | nein | kostenlos | `js/layers/CameraLayer.js`, `server/dataProxies.mjs`, `server/cameraProxy.mjs` — Begründung: 17 eigene + Katalog-Kameras aus 3 Regionen gegen 11 Regionen/~3.900 bei GEV; Proxy-Härtung (SSRF-Schutz, Allowlist) ist bereits auf GEV-Niveau |
| Allsky-Kameras weltweit | ✅ vorhanden (ARGUS-exklusiv, kein GEV-Äquivalent) | handkuratiert | nein | kostenlos | `js/layers/AllskyLayer.js`, `data/allsky-cameras.json` |
| Street-Level (Mapillary + Viewer + FOLLOW-Modus) | ❌ fehlt | — | — | — | – |
| Kamera-Sichtfeld (Viewshed) | ❌ fehlt (PR noch offen, nicht in `origin/main` gemerged) | rein geometrisch, aus Kameraposition/Blickrichtung | nein | kostenlos | Code existiert als `js/cameraViewshed.js` **auf unmergtem lokalem Branch** (WEB-72) — sobald gemerged: ✅ vorhanden |

### 2.5 Ereignisse & Umwelt

| Feature (GEV) | Status | Datenquelle (ARGUS) | Schlüssel | Kostenrisiko | Datei(en) |
|---|---|---|---|---|---|
| Erdbeben (24 h) | ✅ vorhanden | USGS | nein | kostenlos | `js/layers/EarthquakeLayer.js` |
| Aktive Brände (24 h) | ✅ vorhanden | NASA FIRMS | ja (kostenlos) | kostenlos | `js/layers/FireLayer.js` |
| Raketenstarts (30 Tage) | ✅ vorhanden | Launch Library 2 | nein (mehr Kontingent optional) | kostenlos | `js/layers/LaunchLayer.js` |
| Wind (animiertes Vorhersagefeld, NOAA GFS/ECMWF) | 🟡 teilweise | Open-Meteo (kuratierte Städtepunkte) | nein | kostenlos | `js/layers/WeatherLayer.js` — Begründung: Punktdaten je Stadt statt flächendeckendes animiertes Windfeld |
| Regenradar / Satellitenwolken / Blitzdichte (Timeline) | ❌ fehlt (PR noch offen, nicht in `origin/main` gemerged) | RainViewer | nein | kostenlos | Code existiert als `js/layers/RadarLayer.js` **auf unmergtem lokalem Branch** (WEB-67), deckt nur Regenradar ab (kein Wolken-/Blitz-Layer) — sobald gemerged: 🟡 teilweise |
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
| Szenen-Regisseur (Kamerafahrten aufzeichnen/teilen) | ❌ fehlt | — | — | — | – |
| Share-Links (Kamera+Stil+Layer+Ziel in URL) | ✅ vorhanden | clientseitig | — | kostenlos | `js/shareLink.js` |
| Sprachsteuerung (Kamera/Layer per Zuruf, 30+ Voice-Tools) | ❌ fehlt | — | — | kostenpflichtig bei Umsetzung (OpenAI Realtime) | ARGUS hat nur Diktat/Vorlesen für den Text-Chat (`js/ai/voice.js`, Browser Web-Speech-API) – keine Kamera-/Layersteuerung per Sprache |
| KI-HUD-Kurzfassung (5-Wort-Szenenbeschreibung) | ❌ fehlt | — | — | kostenpflichtig bei Umsetzung | ARGUS hat Objekt-Kontext für den Chat (`ai/locationContext.js`), aber keine automatische HUD-Kurzfassung |
| Setup-Diagnose (`npm run doctor`) | ✅ vorhanden | — | — | kostenlos | `server/doctor.mjs` – prüft Node-Version und meldet gefundene `.env`-Schlüssel ohne Werte auszugeben |

## 3. Priorisierte Vorschläge (fortgeschrieben)

### Tier 1 – abgeschlossen
Alle fünf ursprünglichen Tier-1-Punkte (Share-Links, Sensor-Stile,
zusätzliche Infrastruktur-Kategorien, Setup-Diagnose, Kamera-Sichtfeld)
sind umgesetzt bzw. – beim Sichtfeld – bereits codiert und wartet nur auf
den Merge nach `origin/main`.

### Tier 2 – zu ca. 70–80 % erledigt
Erledigt: Routenplanung (OSRM), Radio, Wetter (kuratiert statt
flächendeckend). Noch unmerged, aber vorhanden: Leihräder (WEB-70),
Regenradar (WEB-67). **Offen und nicht begonnen:**
1. **ÖPNV-Layer**: GTFS-Realtime ausgewählter Städte, meist ohne
   Anmeldung.
2. **Verkehr**: OSM-Simulation ohne Schlüssel, TomTom optional für
   Live-Stauwerte (freies Kontingent).
3. **Satelliten-Katalogtiefe erhöhen**: mehr CelesTrak-Gruppen/höheres
   `maxPerGroup`, um näher an die 838 von GEV heranzukommen.
4. **Mehr Objekte in `infrastructure.json`/`cables.json`**: Rechenzentren,
   Dämme, Kabel sind als Kategorie vorhanden, aber zahlenmäßig weit von
   GEV entfernt – ließe sich durch Einbindung öffentlicher Datensätze
   (z. B. OSM-Overpass-Abfragen) ohne neuen Schlüssel ausbauen.

### Tier 3 – größerer Aufwand und/oder laufende Kosten
5. **Sprachagent (OpenAI Realtime API)**: weiterhin nicht umgesetzt,
   ergänzt den bestehenden Claude-Text-Assistenten um Sprachsteuerung.
   Kostenpflichtig nach Nutzungsminuten – braucht weiterhin eine bewusste
   Freigabe wegen laufender Kosten.
6. **Szenen-Regisseur**: Aufzeichnen/Abspielen von Kamerafahrten.
7. **3D-Flugzeugmodelle je Klasse**: Modelle laden und Glyph→Modell-
   Wechsel beim Heranzoomen, analog zum bestehenden Cockpit-Code.
8. **Sprachsteuerung fürs Zeichnen/Whiteboard**: baut auf dem bereits
   vorhandenen `drawTools.js` auf.
9. **Militärflug-Kennzeichnung aktivieren**: Serverfunktion existiert
   bereits (`server/flightProviders.mjs`), fehlt nur die Verdrahtung
   (Route + Layer-Flag + UI-Farbe) – geringerer Aufwand als die übrigen
   Tier-3-Punkte, aber bewusst zurückgestellt, bis Bedarf klar ist.

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
`timeline.js`) und Watchlist (`watchlist.js`). Diese Breite an
Palantir-artigen Analyse-Werkzeugen ist eine Stärke, die bei der weiteren
Priorisierung von GEV-Lücken nicht aus dem Blick geraten sollte.

## 5. Bewusst nicht übernehmen

- **Vite-Build**: ARGUS' Stärke ist der fehlende Build-Schritt
  („sofort loslegen mit `python3 -m http.server`"). Beibehalten, auch
  wenn GEV inzwischen Node 24/26 und einen vollständigen npm-Stack
  voraussetzt – das vertieft den Unterschied eher, als ihn zu verkleinern.
- **Personen-Tracking / Gesichtserkennung**: GEV lehnt Personen als
  Such-/Trackingziel explizit ab; ARGUS zieht dieselbe Grenze. Das
  Erkennungs-Overlay (`js/hud.js`) ist rein dekorativ (keine echte
  Bilderkennung) und bleibt das auch.
- **ALPR-Kamera-Standorte (Kennzeichen-Scanner)**: GEV bindet
  OSM-getaggte ALPR-Standorte ein. Auch wenn nur Standorte und keine
  Kennzeichen-Daten gezeigt werden, passt ein Layer, der gezielt
  Überwachungsinfrastruktur kartiert, nicht zum in `AGENTS.md`/Issue-
  Vorgaben verankerten Verzicht auf Personen-Tracking – bewusst nicht
  übernehmen.
- **Sprachagent (OpenAI Realtime API)**: nicht grundsätzlich
  ausgeschlossen, aber laufende Kosten nach Nutzungsminuten erfordern
  eine explizite Freigabe, bevor das umgesetzt wird (siehe Tier 3).
- **Pinokio-Installer**: Zielgruppe/Vertriebsweg passt nicht zum Projekt.

## 6. Empfohlene Reihenfolge

1. Die drei unmergten Branches (Regenradar WEB-67, Leihräder WEB-70,
   Kamera-Sichtfeld WEB-72) nach `origin/main` bringen – das hebt den
   Tier-2-Stand von „zu 70–80 % erledigt" auf „fast vollständig", ohne
   dass neuer Code nötig ist.
2. ÖPNV und Verkehrssimulation (verbleibender Tier-2-Rest) – beide ohne
   Schlüssel umsetzbar.
3. Satelliten-/Infrastruktur-Objektzahlen erhöhen (mehr CelesTrak-Gruppen,
   mehr Datensätze für Rechenzentren/Dämme/Kabel) – kein neuer Schlüssel,
   nur Datenbeschaffung.
4. Tier 3 erst nach expliziter Freigabe – insbesondere der Sprachagent,
   weil er laufende Kosten verursacht.

## 7. Nächste Schritte

1. Rückmeldung, ob die drei unmergten Tier-1/2-Branches zuerst
   zusammengeführt werden sollen, bevor neue Tier-2-Arbeit (ÖPNV/Verkehr)
   beginnt.
2. Entscheidung einholen, ob die Militärflug-Kennzeichnung (serverseitig
   bereits vorhanden) freigeschaltet werden soll.
3. Laufende Fortschreibung dieses Dokuments bei jedem GEV-Sync, analog
   zur bestehenden Doku-Konvention (echte Schlüssel nie im Repo, nur
   lokal in `.env`).
