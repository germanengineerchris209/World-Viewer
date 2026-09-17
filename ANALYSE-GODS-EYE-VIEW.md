# Vergleich mit „God's Eye View" & Verbesserungsvorschläge

Stand: 17.09.2026 · Referenzprojekt: [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT-Lizenz)

Dieses Dokument vergleicht World Viewer mit God's Eye View (GEV) – dem
Projekt, aus dem die Cockpit-Mitflug-Ansicht (`js/cockpit.js`) bereits
portiert wurde – und schlägt vor, was als Nächstes übernommen werden
sollte. Es ist die Grundlage für den Umsetzungs-Workflow aus WEB-15.

## 1. Architektur im Vergleich

| | World Viewer | God's Eye View |
|---|---|---|
| Frontend | Vanilla JS (ES6-Module), kein Build-Schritt, CesiumJS via CDN | Vanilla JS + **Vite**-Build, CesiumJS + Google Photorealistic 3D Tiles |
| Server | Node 18+, keine npm-Pakete, ein Proxy-Server für Schlüssel/CORS | Node 24+, npm-Paket-Set, gehärteter Proxy mit SSRF-Schutz, Antwortgrößen-Limits, Ratenbegrenzung pro IP |
| KI | Claude-Text-Chat (Anthropic API), Diktat/Vorlesen über Browser Web Speech API | OpenAI Realtime API – echtes Sprachgespräch, 28 Voice-Tools, Kamera-Regie per Sprache |
| Doku-Prozess | 3 Markdown-Dateien im Root (`DOKUMENTATION.md`, `DATENQUELLEN.md`, `DEPLOYMENT.md`) | `docs/`-Ordner + `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `TESTING.md`, CI-Workflow |

**Bewertung:** Der Verzicht auf einen Build-Schritt ist eine bewusste
Stärke von World Viewer (sofort lauffähig, keine Toolchain) und sollte
**nicht** aufgegeben werden. Die Doku-Struktur und der gehärtete Server
(Rate-Limits, SSRF-Schutz) sind dagegen übernehmenswert unabhängig vom
Build-System.

## 2. Layer/Feature-Gegenüberstellung

| Layer / Feature | World Viewer | God's Eye View | Lücke |
|---|---|---|---|
| Flugzeuge | ✅ live (OpenSky/FR24/adsb.lol) | ✅ live (OpenSky + adsb.lol) | 3D-Flugzeugmodelle je Klasse fehlen (nur Icon/Glyph) |
| Schiffe | ✅ live (AISStream) | ✅ live (AISStream) | – |
| Satelliten | ✅ 12, vereinfachte Kreisbahn | ✅ 838, echte SGP4-Propagation | Objektzahl & Bahngenauigkeit ausbaufähig |
| Erdbeben | ✅ USGS | ✅ USGS | – |
| Raketenstarts | ✅ Launch Library 2 | ✅ Launch Library 2 + Nachflug-Simulation | Scrubbare Launch-Replay-Animation fehlt |
| Brände | ✅ NASA FIRMS | ✅ NASA FIRMS | – |
| Kameras | ✅ 17 eigene + Kataloge | ✅ ~3.600, mit Viewshed-Kegel & Posen-Kalibrierung per Gizmo | Sichtfeld-Visualisierung fehlt |
| Infrastruktur | ✅ 16 Objekte, statisch | ✅ Datacenters (4.351), Dämme (704), Seekabel (712) | Deutlich weniger Objekte/Kategorien |
| Cockpit-Mitflug | ✅ **bereits portiert** | ✅ Original | – |
| Sensor-Stile (NVG/FLIR/CRT/Noir/Snow) | ❌ | ✅ 7 Stile per Tastendruck | fehlt komplett |
| Erkennungs-Overlay (Bounding Boxes) | ❌ | ✅ | fehlt komplett |
| Taktisches HUD | ❌ | ✅ inkl. KI-Kurzfassung der Szene | fehlt komplett |
| Sprachsteuerung (Kamera/Layer per Zuruf) | ❌ (nur Text-Chat) | ✅ OpenAI Realtime, 28 Tools | fehlt, kostenpflichtig |
| Zeichnen/Whiteboard (Grenzen, Routen, Maße) | ❌ | ✅ inkl. Sprachsteuerung | fehlt komplett |
| Szenen-Regisseur (Kamerafahrten aufzeichnen) | ❌ | ✅ | fehlt komplett |
| Share-Links (Kamera+Layer+Ziel in URL) | ❌ | ✅ | fehlt, kein Schlüssel nötig |
| Verkehr (simuliert/live) | ❌ | ✅ OSM-Simulation, optional TomTom live | fehlt |
| ÖPNV (Bus/Bahn/Fähre) | ❌ | ✅ GTFS-Realtime, mehrere Städte | fehlt |
| Leihräder | ❌ | ✅ GBFS | fehlt |
| Radio | ❌ | ✅ Radio Browser mit Tuner-UI | fehlt |
| Routenplanung (Fuß/Rad/Auto) | ❌ | ✅ OSRM, keine Anmeldung | fehlt |
| Setup-Diagnose (`npm run doctor`) | ❌ | ✅ prüft Node-Version, gefundene Keys | fehlt |

## 3. Priorisierte Vorschläge

### Tier 1 – sofort machbar, kein neuer Schlüssel, geringes Risiko
1. **Share-Links**: aktuelle Kameraposition, aktive Layer und getracktes
   Ziel als URL-Parameter kodieren/dekodieren. Rein clientseitig.
2. **Sensor-Stile CRT/NVG/FLIR/Noir/Snow**: als CSS-`filter`/Canvas-Overlay
   über dem Cesium-Viewport, keine echten GLSL-Post-Effekte nötig für einen
   überzeugenden Ersteindruck.
3. **Zusätzliche Infrastruktur-Layer**: Rechenzentren, Staudämme,
   Unterseekabel als eigene, rein statische Datensätze (analog zu
   `data/infrastructure.json`) – keine API, kein Schlüssel.
4. **Setup-Diagnose-Skript**: `node server/doctor.mjs` prüft Node-Version
   und meldet, welche `.env`-Schlüssel gesetzt sind (ohne Werte auszugeben).
5. **Kamera-Sichtfeld (Viewshed)**: einfacher Kegel/Sektor auf Basis der
   bereits vorhandenen Kamera-Koordinaten und Blickrichtung.

### Tier 2 – kostenloser Zusatz-Schlüssel oder rein OSM-basiert
6. **Routenplanung**: OSRM (öffentliche FOSSGIS-Server), keine Anmeldung.
7. **Leihräder**: GBFS-Feeds, keine Anmeldung.
8. **Radio-Layer**: Radio-Browser-API, keine Anmeldung.
9. **ÖPNV-Layer**: GTFS-Realtime-Feeds ausgewählter Städte, meist keine
   Anmeldung.
10. **Verkehr**: OSM-Simulation ohne Schlüssel, TomTom optional für Live-
    Stauwerte (freies Kontingent).

### Tier 3 – größerer Aufwand und/oder laufende Kosten
11. **Sprachagent (OpenAI Realtime API)**: löst nicht den bestehenden
    Claude-Assistenten ab, sondern ergänzt ihn um Sprachsteuerung der
    Kamera/Layer. Kostenpflichtig nach Nutzungsminuten – braucht eine
    bewusste Entscheidung wegen laufender Kosten.
12. **Zeichnen/Whiteboard**: Freihand-Markierungen, Grenzen, Distanzmessung
    auf dem Globus – rein clientseitig, aber UI-intensiv.
13. **Szenen-Regisseur**: Aufzeichnen/Abspielen von Kamerafahrten für Clips.
14. **Erkennungs-Overlay + taktisches HUD**: Bounding-Boxes und
    Telemetrie-Einblendung – baut auf den Sensor-Stilen aus Tier 1 auf.
15. **3D-Flugzeugmodelle je Klasse**: Modelle laden und Glyph→Modell-Wechsel
    beim Heranzoomen, analog zum bestehenden Cockpit-Code.

## 4. Bewusst nicht übernehmen
- **Vite-Build**: World Viewers Stärke ist der fehlende Build-Schritt
  („sofort loslegen mit `python3 -m http.server`"). Beibehalten.
- **Personen-Tracking**: GEV lehnt das explizit ab („People are not a query
  type here") – World Viewer sollte diese Grenze ebenso ziehen.
- **Pinokio-Installer**: Zielgruppe/Vertriebsweg passt nicht zum Projekt.

## 5. Empfohlene Reihenfolge
Tier 1 zuerst (ein bis zwei Arbeitssitzungen, kein Kostenrisiko), danach
Tier 2 (jeweils ein neuer optionaler Schlüssel), Tier 3 erst nach expliziter
Freigabe – insbesondere der Sprachagent, weil er laufende Kosten verursacht.

## 6. Nächste Schritte
1. Rückmeldung, welche Tier(s) im nächsten Workflow-Schritt umgesetzt
   werden sollen (Vorschlag: Tier 1 komplett, Tier 2 nach Bedarf).
2. Nach Abschluss der Umsetzung: eigene Rolle/Agent für laufende
   Projekt-Dokumentation aufsetzen, die Änderungen fortlaufend in
   GitHub-Markdown festhält (Platzhalter-Konvention wie bisher: echte
   Schlüssel nie im Repo, nur lokal in `.env`).
