# WEB-81 — New Features + UI Overhaul

**Status:** vollständig umgesetzt (R1–R4, U1–U4, F1–F12 gemerged); offene
Folgearbeiten sind unten gelistet. Stand 21.10.2026.
**Auftrag:** Die Features aus dem Referenzvideo zu „God's Eye View"
([bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view),
MIT-Lizenz) in ARGUS übernehmen und die UI entsprechend anpassen. Dafür wurde
das Epic in Einzel-Tasks zerlegt (Recherche R1–R4, UI-Fundament U1–U4,
Features F1–F12) und auf mehrere Agenten verteilt. Dieses Dokument fasst
zusammen, was davon **tatsächlich auf `main` gelandet ist** – nicht den
ursprünglichen Plan. Randbedingungen galten unverändert: kein Build-Schritt
(ES6-Module über CDN, `python3 -m http.server` muss reichen), UI-Texte auf
Deutsch, keine echten Schlüssel im Repo, kein Personen-Tracking/keine
Gesichtserkennung.

Zwölf fertige Branches liefen zeitweise als offene Pull Requests vor `main`,
weil sie alle dieselben vier Stellen anfassen (`index.html`, `js/app.js`,
`js/ui.js`, `style.css`). Die eigentliche Integration (Merge-Reihenfolge,
Konfliktauflösung, drei erst durch die Kombination entstandene Regressionen)
ist bereits in [`docs/WEB-81-integrationswelle.md`](./WEB-81-integrationswelle.md)
dokumentiert und wird hier nicht wiederholt. Dieses Dossier ist die
Gesamtsicht auf das Epic, jenes der Integrationsbericht zu einem einzelnen
Merge-Tag.

## Umgesetzt

Reihenfolge nach Abhängigkeit: zuerst die Recherche (R1–R3), dann das
UI-Fundament (U1–U4), dann die Features, die darauf aufsetzen.

| Issue | PR | Titel | Inhalt |
|---|---|---|---|
| WEB-82 | [#35](https://github.com/germanengineerchris209/World-Viewer/pull/35) | [R1] Gap-Analyse gegen GEV `main` | Vergleich aktualisiert, Basis für F1–F12 |
| WEB-83 | [#33](https://github.com/germanengineerchris209/World-Viewer/pull/33) | [R2] Datenquellen-Spezifikation Verkehr/ÖPNV/Street-Level/Militär | Spezifikation für F2, F5–F7 (siehe `docs/WEB-83-…md`) |
| WEB-84 | [#46](https://github.com/germanengineerchris209/World-Viewer/pull/46) | [R3] SGP4 ohne Build-Schritt | Spezifikation + Benchmark-Skript, Basis für F1 (siehe `docs/WEB-84-…md`) |
| WEB-85 | [#42](https://github.com/germanengineerchris209/World-Viewer/pull/42) | [U1] Layer-Konsole in Kategorien | Sidebar-Liste ersetzt durch sechs Kategorien (Bewegung, Kameras, Infrastruktur, Ereignisse, Wetter, Werkzeuge), `js/layerCategories.js` |
| WEB-86 | [#37](https://github.com/germanengineerchris209/World-Viewer/pull/37) | [U2] Andockbare Panel-Rails | `js/panelDock.js`: Detail-/Graph-/KI-Panel rechts andockbar, verschieb- und skalierbar, Zustand in `localStorage` |
| WEB-87 | [#36](https://github.com/germanengineerchris209/World-Viewer/pull/36) | [U3] POWER-UP-Panel | `js/keyStatusPanel.js` + `/api/keys` (`server/keyRegistry.mjs`): Schlüssel-Status je Dienst, Schlüssel-Badges an betroffenen Layern in der Konsole |
| WEB-88 | [#43](https://github.com/germanengineerchris209/World-Viewer/pull/43) | [U4] Tastatur-Parität + Kurzreferenz | `js/keyboardShortcuts.js` als einzige zentrale Stelle für globale Kürzel, `js/keyboardReference.js` als Overlay (Taste `?`) |
| WEB-92 | [#39](https://github.com/germanengineerchris209/World-Viewer/pull/39) | [F4] Szenen-Regisseur | `js/sceneDirector.js` + `js/sceneDirectorPanel.js`: Kamerafahrten aufnehmen/abspielen, Speichern/Laden über Share-Link; Spezialfall Routen-Flythrough aus `routeTool.js` |
| WEB-96 | [#38](https://github.com/germanengineerchris209/World-Viewer/pull/38) | [F8] 3D-Flugzeugmodelle | `js/aircraftModels.js`: fünf GLB-Modelle (787, ATR-72, Citation, Bell 206, MQ-9) aus dem GEV-„Hangar", Glyph→Modell-Wechsel ab Zoomschwelle |
| WEB-97 | [#44](https://github.com/germanengineerchris209/World-Viewer/pull/44) | [F9] Launch-Replay | `js/launchAscent.js`: rekonstruierte Aufstiegsbahn (Startplatz + Inklinationsschätzung + generisches Höhenprofil) statt Einzelpunkt, deutlich als Rekonstruktion markiert |
| WEB-98 | [#40](https://github.com/germanengineerchris209/World-Viewer/pull/40) | [F10] GOES-Wolken | `js/layers/GoesCloudLayer.js`: Infrarot-Wolkenbild (NASA GIBS, Band 13), Abdeckung nur Amerika/Pazifik/Atlantik |
| WEB-100 | [#45](https://github.com/germanengineerchris209/World-Viewer/pull/45) | [F12] Infrastruktur in Masse | `js/layers/InfrastructureLayer.js` + `CableLayer.js`: Clustering (`BaseLayer.enableClustering`) für Rechenzentren/Dämme/Seekabel in Masse — **siehe Einschränkung unten, WEB-142** |
| WEB-102 | [#34](https://github.com/germanengineerchris209/World-Viewer/pull/34) | AddOn: Weltwetter-Raster | `js/layers/WorldWeatherLayer.js`: weltweites Temperatur-Gradnetz über Open-Meteo. Kein WEB-81-Kind-Issue, aber in derselben Welle mitintegriert und derselben Kategorie zugeordnet |
| WEB-89 | [#48](https://github.com/germanengineerchris209/World-Viewer/pull/48) | [F1] Satelliten auf GEV-Maßstab | `js/layers/SatelliteLayer.js`: Gruppen `glo-ops` und `starlink` ergänzt, `maxPerGroup` von 60 auf 2000 gehoben (eigene Kappung für Starlink). Echte SGP4-Propagation lief schon seit v2.3 — umgelegt wurde, wie in `docs/WEB-84-…md` empfohlen, nur die Gruppenauswahl |
| WEB-90 | [#52](https://github.com/germanengineerchris209/World-Viewer/pull/52) | [F2] Militärflüge | `server/flightProviders.mjs` + `js/flightData.js`: adsb.lol als eigene Quelle, Militärmaschinen bernsteinfarben in `AircraftLayer.js` abgesetzt |
| WEB-91 | [#41](https://github.com/germanengineerchris209/World-Viewer/pull/41) | [F3] Contacts-Roster | `js/contactsRoster.js` + `js/contactsPanel.js`: Objekte im einstellbaren Radius um das Kamerazentrum, mit Distanz und Peilung, nach Distanz sortiert. Als `dock-panel` in der Rail aus U2 |
| WEB-93 | [#54](https://github.com/germanengineerchris209/World-Viewer/pull/54) | [F5] Verkehrs-Layer | `js/layers/TrafficLayer.js`: OSM-Simulation als Standard (Overpass scheitert aus der Sandbox an einer IP-Sperre, `statusText()` benennt die Simulation), optionale TomTom-Live-Schicht nur mit `TOMTOM_API_KEY` |
| WEB-94 | [#50](https://github.com/germanengineerchris209/World-Viewer/pull/50) | [F6] ÖPNV-Layer | `js/layers/TransitLayer.js` + `server/gtfsRealtime.mjs`: GTFS-Realtime-Fahrzeugpositionen für Boston/MBTA und die Niederlande |
| WEB-95 | [#53](https://github.com/germanengineerchris209/World-Viewer/pull/53) | [F7] Street-Level-Panel | `js/layers/StreetLevelLayer.js` + `js/streetLevelPanel.js`: Mapillary-Abdeckungslinien und Bildpanel; Schlüssel optional über das POWER-UP-Panel, ohne Schlüssel bleibt der Layer leer statt zu scheitern |
| WEB-99 | [#47](https://github.com/germanengineerchris209/World-Viewer/pull/47) | [F11] ALPR-Kamerastandorte | `js/layers/ALPRLayer.js`: Kennzeichenleser aus OSM/DeFlock über Overpass-Proxy, **nur Standorte und Gerätetags** — keine Kennzeichen-, Fahrzeug- oder Personendaten |

Bei WEB-85, WEB-88, WEB-97 und WEB-100 war die Arbeit fertig auf dem Remote,
aber der ausführende Run ist nach dem Push an einem Adapter-Auth-Fehler
(`claude_auth_required`) gestorben, **bevor er den PR öffnen konnte** — die
Branches lagen tagelang unsichtbar da. Die PRs #42–#45 wurden nachträglich
geöffnet. Dasselbe galt für die R3-Spezifikation (WEB-84), die nur
uncommitted im geteilten Checkout lag und als #46 gesichert wurde.

### Offen / verschoben

Das Epic ist inhaltlich vollständig: **alle 20 geplanten Tasks (R1–R3, U1–U4,
F1–F12) sind umgesetzt und gemerged.** Offen sind nur Folgearbeiten, die aus
dem Epic heraus entstanden sind:

| Issue | Status | Was noch offen ist |
|---|---|---|
| WEB-154 | todo, `low` | [A] Strahlungsmessnetz-Layer (Safecast, CC0, keyless). Aus der R4-Recherche. Niedrig priorisiert, weil Safecast Community-Daten sind und viele Uploads nachträglich statt echtzeitnah eingepflegt werden |
| WEB-155 | todo, `medium` | [B] Tsunami-Warn-Layer (NOAA/PTWC Atom-Feed, keyless). Aus der R4-Recherche. Vor WEB-154 eingeplant: amtliche Warndaten, passt in das Alarm-Muster aus WEB-20/WEB-54 und deckt WEB-43 (GDACS) teilweise mit ab |
| WEB-131 | blocked (Status-Schreibfehler, siehe unten) | [F10b] Blitzdichte-Overlay (GOES-GLM). Die ursprüngliche Blocker-Begründung „keine verifizierte schlüssellose Quelle" ist **widerlegt**: NOAA GOES-18/19 liefern GLM-L2-LCFA über öffentliche, unauthentifizierte S3-Buckets (am 17.10.2026 verifiziert, ~20-s-Kadenz). Aufwand aber groß — serverseitige Binärdaten-Pipeline (S3-Polling, NetCDF4/HDF5 via `h5wasm`, Gitter-Aggregation). Gehört in den `backlog`, nicht in die nächste Welle |
| WEB-151 | todo | Dammdaten aus WEB-142 mit Wikidata-Filter neu erzeugen |

Keines dieser Features wurde inhaltlich abgelehnt.

Bewusst **nicht** übernommen bleiben, wie im Plan festgehalten: der Vite-Build
(ARGUS' Stärke ist der fehlende Build-Schritt), Personen-Tracking und
Gesichtserkennung (GEV schließt das selbst aus, ARGUS zieht dieselbe Grenze)
und der Sprachagent mit OpenAI Realtime (laufende Kosten pro Minute,
freigabepflichtig).

### Behobene Nacharbeit an gemergtem Code: WEB-142

Beim Verifikations-Durchlauf der Integrationswelle (siehe
`docs/WEB-81-integrationswelle.md`) fiel auf, dass `main` drei
Massendatensätze lädt, die im Repository nicht existieren:

```
GET /data/datacenters.json  -> 404
GET /data/dams.json         -> 404
GET /data/cables-osm.json   -> 404
```

Ursache: Diese Dateien wurden damals nicht im Repo gepflegt, sondern von
`npm run build:infrastructure-mass` aus der Overpass API erzeugt (dauert
mehrere Minuten, braucht Internet) — und der Build-Lauf war vor dem Merge von
WEB-100 (PR #45) nicht ausgeführt bzw. das Ergebnis nicht committet worden. Kein
Absturz (`loadJSON()` liefert `[]`, die handkuratierten Einträge aus
`data/infrastructure.json` bleiben sichtbar), aber das eigentliche Feature
— Rechenzentren/Dämme/Seekabel in Masse plus Clustering — liefert auf einem
frischen Checkout null zusätzliche Objekte. **Behoben:** WEB-142 (PR [#49](https://github.com/germanengineerchris209/World-Viewer/pull/49))
hat die Datensätze erzeugt und eingecheckt — 4.813 Rechenzentren, 16.630 Dämme,
195 OSM-Seekabel. Ein frischer Checkout zeigt sie jetzt ohne Build-Schritt.

Daraus ist eine Restarbeit entstanden: 16.630 Dämme enthalten auch
Kleinstwehre. **WEB-151** filtert den Datensatz über Wikidata nach.

## Getestet

Direkt in diesem Doku-Update nicht erneut durchgeklickt — die Verifikation
der gemergten Welle steht bereits in `docs/WEB-81-integrationswelle.md`:
Headless-Chromium gegen den gemergten Stand, null Seiten-/Konsolenfehler
außer den erwarteten 404ern der `/api/`-Proxys ohne laufenden Server, alle
22 registrierten Layer in der richtigen Kategorie, Panel-Rail rechts
vorhanden, POWER-UP-Chip sichtbar. Die Einzelfeatures selbst sind jeweils in
ihrem eigenen PR verifiziert (Screenshots u.a. zu WEB-86 in
`docs/web-86-verification/`).

Für dieses Dossier wurde zusätzlich der tatsächliche Code-Stand auf `main`
(`cf0aed8`) geprüft, nicht nur die PR-Beschreibungen — u.a. `js/app.js` auf
die tatsächlich registrierten Tastenkürzel, `js/layerCategories.js` auf die
tatsächliche Kategorie-Zuordnung, `server/keyRegistry.mjs` auf die
tatsächlich verfügbaren Schlüssel-Dienste, und `data/` auf die
WEB-142-Massendatensätze (beim damaligen Stand fehlten sie; inzwischen sind
sie eingecheckt).

Für den Nachtrag vom 21.10. wurde erneut gegen `main` (`b8d45a0`) geprüft:
die sieben nachgemergten PRs, die Existenz und Objektzahl der drei
Massendatensätze, sowie die Kategorie-Zuordnung der neuen Layer in
`js/layerCategories.js`.

## Nachtrag 21.10.2026

Dieses Dossier wurde ursprünglich am 17.10. geschrieben, als F1, F2, F3, F5,
F6, F7 und F11 noch offen waren, und erklärte, es werde **nicht** rückwirkend
aktualisiert. Diese Festlegung wurde bewusst aufgehoben: die sieben Features
sind inzwischen gemerged (PRs #41, #47, #48, #50, #52, #53, #54), und ein
Dossier, das sieben gelieferte Features als „noch nicht umgesetzt" führt, ist
schlechter als eines, das nachgezogen wird. Die Tabelle „Umgesetzt" oben ist
auf dem Stand von `main` (Merge von PR #54).

## Offene Folgefragen

- **WEB-151**: Dammdaten aus WEB-142 mit Wikidata-Filter neu erzeugen.
- **WEB-154 / WEB-155**: die zwei Layer-Kandidaten aus der R4-Recherche
  (WEB-140, abgeschlossen). Reihenfolge entschieden: Tsunami (B) vor
  Strahlung (A) — Begründung in der Tabelle oben.
- **WEB-131**: Datenquelle gefunden und verifiziert, Aufwand aber groß.
  Gehört in den `backlog`, nicht in die nächste Welle.
- Governance-Lehre aus der Integrationswelle (schon in
  `docs/WEB-81-integrationswelle.md` festgehalten, hier wiederholt, weil
  sie für alle offenen F-Issues weiterhin gilt): **wer einen neuen Layer
  registriert, trägt ihn im selben PR in `js/layerCategories.js` ein** —
  der Fallback auf „Werkzeuge" ist eine Notbremse, keine Zuordnung.
