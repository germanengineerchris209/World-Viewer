# WEB-12 — UI-Texte durchgängig auf Deutsch übersetzen

**Status:** erledigt
**Auftrag:** Behebt QA-Verstoß Punkt 8 aus WEB-8 – im Frontend waren
noch englische UI-Texte übrig, obwohl die Anwendung durchgängig auf
Deutsch lokalisiert sein soll.

## Umgesetzt

PR [#1](https://github.com/germanengineerchris209/World-Viewer/pull/1):

- Detailpanel-Badges (Aircraft/Ship/Satellite/Camera/Infrastructure/Object
  Details), Feldbezeichner (Callsign, Aircraft, Altitude, Speed, Heading,
  Squawk, Latitude, Longitude), Sidebar-Untertitel und der Abschnittstitel
  „Layers" ins Deutsche übersetzt
- Cockpit-HUD-Label „Speed" ebenfalls übersetzt
- `PAUSED` in `timeline.js` an die bereits deutsche `PAUSIERT`-Formulierung
  in `ui.js` angeglichen (uneinheitliche Übersetzung an zwei Stellen behoben)

Bewusst unverändert blieben Lizenz-/Attributionszitate (NASA-FIRMS, USGS)
im Original, da es sich um vorgeschriebene Quellenangaben handelt.

## Getestet

Manuelle Sichtprüfung der betroffenen UI-Stellen (Detailpanel, Sidebar,
Timeline, Cockpit-HUD) gegen die laufende App: konsistent deutsche
Bezeichner, keine gemischt-sprachigen Reste gefunden.

## Offene Folgefragen

Keine bekannt. Werden künftig neue UI-Texte (z.B. durch neue Layer oder
Features) auf Englisch eingeführt, gilt dieselbe QA-Vorgabe wie in WEB-8
beschrieben.
