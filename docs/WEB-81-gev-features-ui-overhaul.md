# WEB-81 — New Features + UI Overhaul

**Status:** größter Teil erledigt, drei Features offen, eine Nacharbeit (WEB-142)
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
| WEB-85 | *(kein PR)* | [U1] Layer-Konsole in Kategorien | Sidebar-Liste ersetzt durch sechs Kategorien (Bewegung, Kameras, Infrastruktur, Ereignisse, Wetter, Werkzeuge), `js/layerCategories.js` |
| WEB-86 | [#37](https://github.com/germanengineerchris209/World-Viewer/pull/37) | [U2] Andockbare Panel-Rails | `js/panelDock.js`: Detail-/Graph-/KI-Panel rechts andockbar, verschieb- und skalierbar, Zustand in `localStorage` |
| WEB-87 | [#36](https://github.com/germanengineerchris209/World-Viewer/pull/36) | [U3] POWER-UP-Panel | `js/keyStatusPanel.js` + `/api/keys` (`server/keyRegistry.mjs`): Schlüssel-Status je Dienst, Schlüssel-Badges an betroffenen Layern in der Konsole |
| WEB-88 | [#43](https://github.com/germanengineerchris209/World-Viewer/pull/43) | [U4] Tastatur-Parität + Kurzreferenz | `js/keyboardShortcuts.js` als einzige zentrale Stelle für globale Kürzel, `js/keyboardReference.js` als Overlay (Taste `?`) |
| WEB-92 | [#39](https://github.com/germanengineerchris209/World-Viewer/pull/39) | [F4] Szenen-Regisseur | `js/sceneDirector.js` + `js/sceneDirectorPanel.js`: Kamerafahrten aufnehmen/abspielen, Speichern/Laden über Share-Link; Spezialfall Routen-Flythrough aus `routeTool.js` |
| WEB-96 | [#38](https://github.com/germanengineerchris209/World-Viewer/pull/38) | [F8] 3D-Flugzeugmodelle | `js/aircraftModels.js`: fünf GLB-Modelle (787, ATR-72, Citation, Bell 206, MQ-9) aus dem GEV-„Hangar", Glyph→Modell-Wechsel ab Zoomschwelle |
| WEB-97 | [#44](https://github.com/germanengineerchris209/World-Viewer/pull/44) | [F9] Launch-Replay | `js/launchAscent.js`: rekonstruierte Aufstiegsbahn (Startplatz + Inklinationsschätzung + generisches Höhenprofil) statt Einzelpunkt, deutlich als Rekonstruktion markiert |
| WEB-98 | [#40](https://github.com/germanengineerchris209/World-Viewer/pull/40) | [F10] GOES-Wolken | `js/layers/GoesCloudLayer.js`: Infrarot-Wolkenbild (NASA GIBS, Band 13), Abdeckung nur Amerika/Pazifik/Atlantik |
| WEB-100 | [#45](https://github.com/germanengineerchris209/World-Viewer/pull/45) | [F12] Infrastruktur in Masse | `js/layers/InfrastructureLayer.js` + `CableLayer.js`: Clustering (`BaseLayer.enableClustering`) für Rechenzentren/Dämme/Seekabel in Masse — **siehe Einschränkung unten, WEB-142** |
| WEB-102 | [#34](https://github.com/germanengineerchris209/World-Viewer/pull/34) | AddOn: Weltwetter-Raster | `js/layers/WorldWeatherLayer.js`: weltweites Temperatur-Gradnetz über Open-Meteo. Kein WEB-81-Kind-Issue, aber in derselben Welle mitintegriert und derselben Kategorie zugeordnet |

WEB-85 hatte als einziger Branch keinen PR — die Arbeit war fertig, der
ausführende Agent ist vor dem Öffnen des PRs an einem Quota-Limit gestorben;
der Branch wurde direkt gemerged.

### Offen / verschoben

| Issue | Status | Warum noch offen |
|---|---|---|
| WEB-89 | in_progress | [F1] SGP4-Satellitenpropagation + CelesTrak-Katalog erweitern — echte Bahndaten (CelesTrak + SGP4) liefen schon seit v2.3, WEB-89 sollte das ausbauen; noch nicht umgesetzt |
| WEB-90 | in_progress | [F2] Militärflüge als eigener Layer (adsb.lol, Sonderfarbe) — noch nicht umgesetzt |
| WEB-91 | in_review, **nicht mergebar** | [F3] Contacts-Roster — fertig, aber PR [#41](https://github.com/germanengineerchris209/World-Viewer/pull/41) bringt eine **eigene** rechte Rail (`#right-rail`) samt doppeltem `#detail-panel` statt der inzwischen über U2 (WEB-86) entstandenen `#panel-rail-right`. Nacharbeit: eigene Rail entfernen, `#contacts-panel` als `dock-panel` in `#panel-rail-right` einhängen und über `panelDock.register()` anmelden, dann neu verifizieren |
| WEB-93 | in_progress | [F5] Verkehrs-Layer (OSM-Simulation, TomTom optional) — noch nicht umgesetzt |
| WEB-94 | in_progress | [F6] ÖPNV-Layer (GTFS-Realtime) — noch nicht umgesetzt |
| WEB-95 | in_progress | [F7] Street-Level-Panel (Mapillary) — noch nicht umgesetzt |
| WEB-99 | in_review | [F11] ALPR-Kamerastandorte aus OSM — PR offen, noch nicht gemerged |
| WEB-140 | blocked | [R4] Recherche zu zwei weiteren Layer-Kandidaten (Safecast-Strahlung CC0, NOAA-Tsunami) — bewusst als Recherche für eine spätere Welle angelegt, keine Ablehnung, nur noch nicht beauftragt |

Keines dieser Features wurde inhaltlich abgelehnt. WEB-91 ist technisch
fertig, aber durch die Reihenfolge der Integration (U2 kam nach F3) jetzt
strukturell veraltet und braucht die oben beschriebene Nacharbeit, bevor es
mergebar ist. WEB-89/90/93/94/95/99 sind schlicht noch nicht fertig; WEB-140
ist bewusst als Recherche für eine künftige Welle und nicht als Teil dieser
eingeplant.

### Bekannte Nacharbeit an bereits gemergtem Code: WEB-142

Beim Verifikations-Durchlauf der Integrationswelle (siehe
`docs/WEB-81-integrationswelle.md`) fiel auf, dass `main` drei
Massendatensätze lädt, die im Repository nicht existieren:

```
GET /data/datacenters.json  -> 404
GET /data/dams.json         -> 404
GET /data/cables-osm.json   -> 404
```

Ursache: Diese Dateien werden nicht im Repo gepflegt, sondern von
`npm run build:infrastructure-mass` aus der Overpass API erzeugt (dauert
mehrere Minuten, braucht Internet) — der Build-Lauf wurde vor dem Merge von
WEB-100 (PR #45) nicht ausgeführt bzw. das Ergebnis nicht committet. Kein
Absturz (`loadJSON()` liefert `[]`, die handkuratierten Einträge aus
`data/infrastructure.json` bleiben sichtbar), aber das eigentliche Feature
— Rechenzentren/Dämme/Seekabel in Masse plus Clustering — liefert auf einem
frischen Checkout null zusätzliche Objekte. Offenes Issue **WEB-142**
(Priorität hoch) verfolgt die Nacharbeit: Datensätze erzeugen und committen
(oder den Build-Schritt dokumentiert in die Einrichtung aufnehmen).

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
tatsächlich verfügbaren Schlüssel-Dienste, und `data/` auf das Fehlen der
drei WEB-142-Massendatensätze.

## Offene Folgefragen

- **WEB-91 Nacharbeit** (Contacts-Roster auf die bestehende Panel-Rail
  umstellen) ist die einzige inhaltlich fertige, aber nicht mergebare
  Arbeit aus dieser Welle.
- **WEB-142** muss vor einer öffentlichen Demo behoben sein, sonst wirbt
  die App (README/DATENQUELLEN) mit Rechenzentren/Dämmen/Seekabeln „in
  Masse", die ein frischer Checkout tatsächlich nicht zeigt.
- **F1, F2, F5–F7, F11** (WEB-89, 90, 93, 94, 95, 99) sind die verbliebenen,
  noch nicht umgesetzten Features aus dem ursprünglichen Plan. Dieses
  Dokument wird nicht rückwirkend aktualisiert, wenn sie landen — dafür
  entstehen eigene `docs/WEB-<id>-…md`-Einträge nach Konvention; dieses
  Dossier bleibt der Stand zum Zeitpunkt des Doku-Updates (WEB-101).
- **WEB-140** liegt als Recherche für zwei weitere Layer-Kandidaten
  (Safecast-Strahlung, NOAA-Tsunami) vor, ist aber noch nicht beauftragt.
- Governance-Lehre aus der Integrationswelle (schon in
  `docs/WEB-81-integrationswelle.md` festgehalten, hier wiederholt, weil
  sie für alle offenen F-Issues weiterhin gilt): **wer einen neuen Layer
  registriert, trägt ihn im selben PR in `js/layerCategories.js` ein** —
  der Fallback auf „Werkzeuge" ist eine Notbremse, keine Zuordnung.
