# WEB-84 — Spezifikation: SGP4-Satellitenpropagation ohne Build-Schritt

**Status:** Recherche abgeschlossen, keine Implementierung (wie im Ticket gefordert).
**Zweck:** Vorbedingung für F1 (Epic WEB-81) klären, damit der Frontend-Engineer
`js/layers/SatelliteLayer.js` direkt von der vereinfachten Kreisbahn (12 Objekte)
auf echte SGP4-Propagation im GEV-Maßstab (~838 Objekte) heben kann.
Referenz: [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT).

Alle Zahlen unten stammen aus `scripts/satellite-propagation-benchmark.mjs`,
ausgeführt am 2026-10-11 gegen echte CelesTrak-Daten (kein Mock).

---

## 0. Wichtiger Befund zuerst: Ein Großteil ist bereits umgesetzt

Der aktuelle Stand von `js/layers/SatelliteLayer.js` (seit WEB-31) ist **weiter
fortgeschritten als die Ticket-Beschreibung annimmt**. Die Beschreibung "12
Satelliten, vereinfachte Kreisbahn" trifft nur noch auf den **Demo-Fallback**
zu (`data/satellites.json`, greift wenn CelesTrak nicht erreichbar ist). Im
Live-Betrieb lädt der Layer bereits:

- TLEs von CelesTrak über `server/dataProxies.mjs` (`handleCelestrak`,
  `TLE_GROUPS`), mit 6h-Server-Cache und Serve-Stale — **exakt das im Ticket
  vorgeschlagene Muster**.
- Propagation per `satellite.js` (CDN, UMD-Script-Tag, Version 6.0.2).
- GMST-eingefrorene Bahnringe (`showOrbit()`), inklusive Kommentar, der das
  Drift-Problem korrekt beschreibt.
- 1×/Sekunde-Drosselung der Propagation (`update()`, Akkumulator-Pattern).

**Was fehlt, um auf GEV-Maßstab (838 Objekte) zu kommen:** nur die
Gruppenauswahl/-kappung. `SatelliteLayer.js` begrenzt aktuell `maxPerGroup`
auf 60 und nutzt nur 5 der 7 verfügbaren Gruppen (`stations, visual, gps-ops,
galileo, geo` — **ohne** `glo-ops` und ohne `starlink`). Das ist der einzige
Hebel, den F1 umlegen muss. Die restlichen Abschnitte liefern dafür die
Zahlen.

---

## 1. TLE-Datenquelle, Aktualisierung, Caching

### Woher
CelesTrak GP-Endpunkt (Nachfolger des alten TLE-Formats, liefert aber mit
`FORMAT=tle` weiterhin klassische Two-Line-Elements):

```
GET https://celestrak.org/NORAD/elements/gp.php?GROUP=<gruppe>&FORMAT=tle
```

Bereits vollständig in `server/dataProxies.mjs::TLE_GROUPS` abgebildet:

| Tag | CelesTrak-Pfad | Objekte (gemessen 2026-10-11) |
|---|---|---|
| stations | `stations` | 19 |
| visual | `visual` | 156 |
| gps | `gps-ops` | 32 |
| glonass | `glo-ops` | 27 |
| galileo | `galileo` | 32 |
| geo | `geo` | 567 |
| starlink | `starlink` | 10656 |

**Zentraler Befund:** Alle Gruppen **außer Starlink** dedupliziert ergeben
**830 Objekte** — das liegt praktisch exakt auf dem GEV-Zielwert von 838.
Starlink ist der Ausreißer (10656 Objekte, >92 % des gesamten Katalogs) und
muss getrennt behandelt werden (siehe Abschnitt 3, DENSE-Schalter).

### Wie oft erneuern
TLEs verändern sich langsam (Bahnkorrekturen, neue Starts, Reentry) — kein
Echtzeit-Datum. CelesTrak selbst aktualisiert seine Gruppen-Dateien ca.
alle paar Stunden. Der bestehende **6h-TTL** in `server/dataProxies.mjs`
(`TLE_TTL_MS`) ist angemessen und muss nicht geändert werden.

### Caching — Server-Cache + statischer Fallback
Beide im Ticket vorgeschlagenen Bausteine existieren bereits und passen 1:1:

1. **Server-Cache mit Serve-Stale** (`cachedFetch()` in `dataProxies.mjs`):
   liefert bei CelesTrak-Ausfall die letzte erfolgreiche Antwort weiter aus,
   auch wenn sie älter als die TTL ist. Kein Unterschied zum Vulkan-Muster
   nötig.
2. **Statischer Fallback** (`data/satellites.json`, 12 Objekte, vereinfachte
   Kreisbahn): greift nur, wenn *auch* der Server nicht erreichbar ist oder
   `cfg.mode === "demo"` gesetzt wurde. Analog zu `data/volcanoes.json`.
   Für F1 reicht die bestehende Datei unverändert aus — sie ist explizit der
   Notfall-Fallback, keine Qualitätsanforderung.

**Empfehlung:** Caching-Architektur unverändert übernehmen. Einzige
Änderung: `TLE_GROUPS`-Liste in `SatelliteLayer.js` um `glo-ops` erweitern
(ist serverseitig schon verfügbar, wird clientseitig nur noch nicht
abgerufen) und `starlink` optional hinter dem DENSE-Schalter (Abschnitt 3).

---

## 2. SGP4-Implementierung ohne Bundler

### Bibliothek: `satellite.js`, Version 6.0.2 (bereits im Einsatz)

- **Lizenz:** MIT (verifiziert über npm-Registry-Metadaten). Keine
  Runtime-Abhängigkeiten.
- **ES6-Modul ohne Bundler:** jsDelivr bietet einen echten ESM-Build über
  den `+esm`-Endpunkt:
  ```js
  import * as satellite from "https://cdn.jsdelivr.net/npm/satellite.js@6.0.2/+esm";
  ```
  Verifiziert: Die Antwort ist ein gültiges ES-Modul mit sauberem
  `export { ... }`-Statement am Dateiende (von jsDelivr aus dem offiziellen
  `dist/satellite.es.js` gebündelt/minifiziert, Rollup+esbuild).
- **Verbesserungsvorschlag für F1:** `SatelliteLayer.js` lädt die Bibliothek
  aktuell per `<script>`-Tag als globales `window.satellite` (UMD). Das
  funktioniert, ist aber unnötig global. Der `+esm`-Import ist die sauberere
  Variante **ohne Verhaltensänderung** — reiner Austausch des Loaders, kein
  Build-Schritt nötig, keine neue Abhängigkeit (bleibt CDN-only).

### Geprüft, aber nicht empfohlen: satellite.js 7.1.0

Neueste Version (7.1.0) hat echtes `"type": "module"`-Paket mit lesbarem
(nicht minifiziertem) ESM-Export, re-exportiert aber zusätzlich einen
`wasm/`-Pfad. Verifiziert: Die für uns relevanten Funktionen
(`propagate`, `sgp4`, `gstime`, `eciToGeodetic`, `twoline2satrec`) bleiben
**synchrones, reines JavaScript** ohne WASM-Abhängigkeit — der WASM-Export
ist ein optionaler Zusatzpfad, den wir nicht importieren müssten. Trotzdem:
**kein Versionswechsel empfohlen.** Kein funktionaler Vorteil für diesen
Anwendungsfall, zusätzliches Risiko durch unbekannte Signaturänderungen
zwischen Major-Versionen (6→7), und die aktuell gepinnte 6.0.2 läuft bereits
produktiv. Eigene SGP4-Implementierung: **nicht nötig** — satellite.js 6.0.2
erfüllt Lizenz-, Größen- und API-Anforderungen vollständig, eine
Eigenentwicklung wäre reine Risikoaufnahme ohne Gegenwert (SGP4 hat
zahlreiche Sonderfälle: Deep-Space-Umschaltung SGP4/SDP4, Bahnzerfall-
Erkennung, numerische Stabilität nahe dem Perigäum — alles bereits in
satellite.js gelöst und getestet).

---

## 3. Performance-Budget: ~840 Objekte bei 60 fps

### Messmethode
`scripts/satellite-propagation-benchmark.mjs` (neu, siehe Code) lädt alle
7 CelesTrak-Gruppen live, baut `satrec`-Objekte und misst reine
Rechenzeit (kein Cesium, kein Rendering) mit `performance.now()`,
Aufwärmphase vor jeder Messung.

### Ergebnisse (2026-10-11, Node 20.20.2, echte TLE-Daten)

| Messung | Ergebnis |
|---|---|
| Einzelpropagation (inkl. `new Date()` + `gstime()` pro Aufruf) | 0,0252 ms |
| Einzelpropagation (GMST einmal pro Tick wiederverwendet) | **0,0082 ms** |
| Alle 838 Objekte, 1 Durchlauf (GEV-Maßstab, ohne Starlink) | **3,73 ms** |
| Alle 11.486 Objekte, 1 Durchlauf (inkl. vollem Starlink-Shell) | 47,25 ms |
| Ein Bahnring (`showOrbit()`, 180 Stützpunkte) | 0,66 ms |

### Einordnung gegen das 60-fps-Budget (16,67 ms/Frame)

- **838 Objekte passen mit Reserve sogar in ein einzelnes Frame** (3,73 ms
  von 16,67 ms = 22 % des Budgets). Das bedeutet: Propagation **pro Frame**
  wäre für den GEV-Maßstab technisch möglich — ist aber trotzdem **nicht
  empfohlen**, weil:
  1. TLE-Positionsänderungen pro Frame (16 ms) sind für das Auge nicht
     unterscheidbar von 1×/Sekunde-Updates — reine Verschwendung von
     CPU-Zeit und Akku.
  2. Das bestehende Muster in `SatelliteLayer.update()` (Akkumulator,
     Propagation 1×/s, Darstellung läuft über
     `Cesium.CallbackProperty` mit den zuletzt berechneten Werten weiter)
     ist bereits korrekt und sollte unverändert bleiben.
- **Mit vollem Starlink-Shell (11.486 Objekte) wird 1×/Sekunde zur
  Pflicht:** 47,25 ms überschreitet bereits ein einzelnes 16,67-ms-Frame-
  Budget um das Dreifache. Bei 1 Hz ist das dagegen unproblematisch
  (47 ms Rechenzeit verteilt auf ein ganzes Sekundenintervall = 4,7 % CPU-
  Last durch SGP4 allein).
- **Keine Interpolation zwischen Propagationen nötig.** Bei LEO-
  Geschwindigkeiten (~7,5 km/s) bewegt sich ein Satellit zwischen zwei
  1-Hz-Updates um ~7,5 km — bei Kamerahöhen, in denen einzelne Punkte
  sichtbar sind, unauffällig. Sprünge sieht man nicht, weil Punkte auf
  dieser Zoomstufe ohnehin nur wenige Pixel groß sind.

### DENSE-Schalter (Starlink-Dichte, analog GEV)

**Empfehlung:** Starlink **standardmäßig ausgeschlossen** lassen (deckt
sich mit der bisherigen `groups`-Konfiguration, die `starlink` gar nicht
erst lädt) und nur bei explizitem Nutzer-Toggle ("DENSE") nachladen:

- **Ohne DENSE:** 830–838 Objekte, 3,7 ms/Propagationsdurchlauf, passt
  locker in 1 Hz.
- **Mit DENSE:** zusätzlich 10.656 Starlink-Objekte, Gesamtkosten springen
  auf 47 ms/Durchlauf. Für F1 bedeutet das: Beim Umschalten auf DENSE
  **muss** die Propagationsfrequenz bei 1 Hz bleiben (nicht erhöhen) und
  die Punktdarstellung sollte auf das günstigste Cesium-Primitiv
  (`PointPrimitiveCollection` statt einzelner `Entity`-Objekte) wechseln,
  falls Performance-Tests im Browser (nicht Teil dieser reinen
  Rechenzeit-Messung) GPU-seitige Engpässe zeigen — das ist aber ein
  Rendering-Thema, nicht SGP4, und damit außerhalb des Scopes von WEB-84.
- Rohdaten für Starlink sind bereits serverseitig verfügbar
  (`TLE_GROUPS` enthält `starlink`), es fehlt nur die clientseitige
  UI (Schalter) und das bedingte Nachladen — Implementierungsaufwand für
  F1, nicht für diese Recherche.

---

## 4. GMST-Ausrichtung der Bahnringe

### Formel
`satellite.js::gstime(date)` berechnet die mittlere Greenwich-Sternzeit
(GMST) aus dem Julianischen Datum nach der Standardformel (IAU 1982,
Polynom in Jahrhunderten seit J2000). Rückgabe in Radiant. Wird in
`eciToGeodetic(positionEci, gmst)` gebraucht, um ECI-Koordinaten (erdfest
im Inertialsystem) in geodätische Lat/Lon (erdfest *rotierend*) umzurechnen.

Gemessene Drehrate: **0,004178°/Sekunde** (≈ 360,986°/Tag, die bekannte
siderische statt solare Tageslänge — korrekt, GMST läuft schneller als die
Sonnenzeit).

### Der Fallstrick (im Code bereits korrekt gelöst)
Ein Bahnring wird aus mehreren ECI-Punkten entlang einer Umlaufperiode
berechnet. Jeder Punkt braucht eine GMST, um nach Lat/Lon umgerechnet zu
werden. **Falsch** wäre, für jeden Punkt die *tatsächliche* GMST zum
jeweiligen Zeitpunkt zu verwenden — dann würde sich die Erde unter dem Ring
weiterdrehen, und der Ring für einen LEO-Satelliten (Umlaufzeit ~90 min)
klafft um ca. 90 min × 0,004178°/s × 60 ≈ **22,6°** auf (die Code-Kommentare
in `showOrbit()` nennen korrekt "rund 24°", sehr nah an dieser Rechnung).

**Richtige Lösung (bereits implementiert):** GMST **einmal** zum
Referenzzeitpunkt berechnen (`fixedGmst = gstime(reference)`) und für
**alle** Stützpunkte des Rings wiederverwenden. Das ist physikalisch
korrekt, weil der Ring die Bahn im Inertialsystem darstellt, projiziert auf
die Erdoberfläche *zu einem festen Zeitpunkt* — nicht die tatsächliche
Bodenspur (Ground Track), die sich wegen Erdrotation pro Umlauf seitlich
verschiebt. Für eine reine Visualisierung "wo verläuft die Bahn gerade"
ist das die richtige Wahl und deckt sich mit dem GEV-Ansatz.

**Weitere Fallstricke, die im Code bereits vermieden werden:**
- `Date`-Objekte in JS sind UTC-basiert; `gstime()` erwartet UTC — kein
  Zeitzonenfehler möglich, solange kein manuelles Offset eingerechnet wird
  (ist hier nicht der Fall).
- Deep-Space-Satelliten (Umlaufzeit ≥ 225 min, z.B. GEO) nutzen intern
  SDP4 statt SGP4 — `satellite.js` wählt das automatisch anhand der
  mittleren Bewegung im TLE, keine Handhabung durch unseren Code nötig.
- TLE-Epoche vs. Abfragezeitpunkt: SGP4-Genauigkeit nimmt mit Abstand zur
  TLE-Epoche ab (Richtwert: Fehler wächst auf mehrere km nach einigen
  Tagen). Der 6h-Cache ist kurz genug, dass dieser Effekt nicht relevant
  wird.

---

## 5. Zusammenfassung / Konkrete Empfehlung für F1

1. **Caching/Datenquelle:** unverändert lassen (bereits korrekt: CelesTrak
   + 6h-Server-Cache mit Serve-Stale + `data/satellites.json`-Fallback).
2. **Gruppenauswahl erweitern:** `glo-ops` zur Default-Gruppenliste in
   `SatelliteLayer.js` hinzufügen, `maxPerGroup` großzügiger fassen oder
   entfernen (die echten Gruppengrößen außer Starlink sind klein genug,
   dass eine Kappung bei 60/Gruppe unnötig Objekte verschenkt — z.B. `geo`
   hat 567 Objekte real, aktuell auf 60 gekappt). Ergebnis: ~830 Objekte,
   praktisch GEV-Niveau.
3. **SGP4-Bibliothek:** `satellite.js` 6.0.2 beibehalten, optional den
   Loader von UMD-`<script>`-Tag auf echten ESM-Import
   (`.../satellite.js@6.0.2/+esm`) umstellen — kein Build-Schritt,
   sauberer Code.
4. **Propagationsfrequenz:** 1×/Sekunde beibehalten (bestehendes
   Akkumulator-Muster), auch für den DENSE-Fall. Keine Interpolation
   nötig.
5. **DENSE-Schalter:** Starlink-Gruppe (10.656 Objekte) hinter einem
   expliziten UI-Toggle, nicht in der Default-Ansicht. Serverseite ist
   bereits vorbereitet (`TLE_GROUPS` enthält `starlink`).
6. **GMST-Bahnringe:** bestehende Logik (GMST einmalig zum
   Referenzzeitpunkt einfrieren) ist korrekt und bedarf keiner Änderung.

**Aufwandseinschätzung für F1:** gering. Der Großteil der Infrastruktur
existiert bereits; die Arbeit beschränkt sich auf Konfigurationsänderungen
(Gruppenliste, Kappung) plus das neue DENSE-Toggle in der UI.
