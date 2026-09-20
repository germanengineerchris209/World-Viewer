# WEB-20 — Open Source Palantir (Gotham-Features)

**Status:** erledigt
**Auftrag:** Öffentliche Features, die Palantir Gotham bietet, im Open-Source-Code
umsetzen – ausschließlich mit öffentlich verfügbaren Quellen, ohne Sicherheitslücken
auszunutzen.

## Umgesetzt

| # | Feature | PR | Beschreibung |
|---|---|---|---|
| 1 | Beobachtungszonen (Geofence-Alarme) | [#5](https://github.com/germanengineerchris209/World-Viewer/pull/5) | Kreiszonen per Kartenklick anlegen; jedes Objekt aller Layer wird alle 2s per Haversine-Distanz geprüft, Ein-/Austritte erscheinen als anklickbare Alarme. |
| 2 | Bewegungsspuren (Track-Verlauf) | [#6](https://github.com/germanengineerchris209/World-Viewer/pull/6) | Kurze Positions-Historie (≤25 Punkte, alle 4s) für Flugzeuge und Schiffe, per Schalter „🧵 Spuren" ein-/ausblendbar. |
| 3 | Verknüpfungen (Link-Analyse) | [#7](https://github.com/germanengineerchris209/World-Viewer/pull/7) | Detailpanel zeigt verwandte Objekte über gemeinsame Attribute (Airline, Flagge, Betreiber, Kategorie) und räumliche Nähe (30 km). |
| 4 | Objekt-Dossier-Export | [#7](https://github.com/germanengineerchris209/World-Viewer/pull/7) | Button „📄 Dossier" lädt eine Textdatei mit Feldern, Kurzbeschreibung und Verknüpfungen des Objekts herunter. |

Alle vier Features nutzen ausschließlich bereits im Projekt vorhandene,
öffentliche Live-/Referenzdaten (OpenSky, AIS, Wikipedia, statische
Infrastruktur-Daten) – keine neue Datenquelle, keine Server-Änderung, keine
neue Sicherheitsfläche.

## Architektur-Referenzen

Details zu jedem Feature stehen in `DOKUMENTATION.md`:

- 1.10 Beobachtungszonen / Alarme
- 1.11 Bewegungsspuren / Track-Verlauf
- 1.12 Verknüpfungen / Link-Analyse
- 1.13 Objekt-Dossier

## Getestet

Jedes Feature wurde vor dem jeweiligen PR per Playwright (headless Chromium,
GPU-lose Sandbox) gegen die laufende App verifiziert – siehe Testpläne der
einzelnen PRs für Details (Zonenanlage inkl. echter Live-Alarme bei
Frankfurt Airport, Spur-Rendering, Link-Navigation, Dossier-Downloadinhalt).

## Repo-Hinweis (für Nachfolge-Tasks relevant)

Während dieses Tasks wurde festgestellt, dass das lokale Arbeitsverzeichnis
und `origin/main` zwischenzeitlich unverbundene Git-Historien hatten. Gelöst
wurde das, indem jede Feature-Änderung als frischer Branch von `origin/main`
umgesetzt und per Pull Request gemergt wurde (nicht per Direkt-Push). Dieses
Vorgehen sollte für alle künftigen Änderungen an diesem Repo beibehalten
werden.

## Folge-Idee (nicht umgesetzt)

Aus der ursprünglichen Recherche blieb offen: weitere GEV-/Gotham-inspirierte
Features (siehe `ANALYSE-GODS-EYE-VIEW.md`, Tier 2/3) – Zeichnen/Whiteboard,
Szenen-Regisseur, Sprachagent u.a. Diese liegen jetzt im Aufgabenbereich des
Feature-Research-Agents.
