# WEB-33 — UI Update: Liquid-Glass-Auswahlflächen + Rebranding zu ARGUS

**Status:** erledigt
**Auftrag:** UI-Update mit einem "Liquid Glass"-Effekt für die
Auswahlflächen (Buttons, Umschalter, Panels). Die grundsätzliche
Weltansicht (3D-Globus) bleibt unverändert. Der Produktname wird von
"World Viewer"/"Gods Eye" auf einen neuen, prägnanten Namen umgestellt
(ähnlich "Gotham") und im Branding oben in der Sidebar angezeigt.
Änderungen werden dokumentiert.

## Neuer Name: ARGUS

Gewählt wurde **ARGUS** – nach Argos Panoptes aus der griechischen
Mythologie, dem hundertäugigen Wächter, der nie vollständig schläft und
alles im Blick behält. Das trifft die Funktion der App (globale
Beobachtung von Flugzeugen, Schiffen, Satelliten, Kameras, Infrastruktur
in Echtzeit) sehr direkt, ist als Einzelwort einprägsam und markenfähig
(ähnlich wie "Gotham" bei Palantir) und vermeidet die vorherigen,
wörtlich beschreibenden bzw. an "God's Eye" angelehnten Namen.

Geändert wurden ausschließlich sichtbare Branding-Stellen:

| Datei | Stelle | Vorher | Nachher |
|---|---|---|---|
| `index.html` | `<title>` | `World Viewer` | `ARGUS` |
| `index.html` | Sidebar-Logo `<h1>` | `WORLD VIEWER` | `ARGUS` |
| `index.html` | Ladeanzeige-Text | `Initialisiere World Viewer …` | `Initialisiere ARGUS …` |

Bewusst **nicht** geändert: Repository-/Paketname (`world-viewer`),
interne Klassennamen wie `WorldViewer` in `js/viewer.js`, Dateinamen und
Doku-Historie (`ANALYSE-GODS-EYE-VIEW.md`, ältere `docs/`-Einträge) –
das sind interne Implementierungsdetails bzw. Historie, keine
Nutzer-Branding-Flächen, und eine Umbenennung dort wäre eine größere,
risikoreichere Änderung außerhalb des Auftrags.

## Liquid-Glass-Effekt

In `style.css` wurden neue CSS-Variablen für ein wiederverwendbares
Glas-Erscheinungsbild ergänzt (`--glass-bg`, `--glass-bg-hover`,
`--glass-border`, `--glass-border-hover`, `--glass-blur`,
`--glass-shadow`, `--glass-shadow-hover`) sowie eine Basisklasse
`.liquid-glass` mit:

- `backdrop-filter: blur(16px) saturate(180%)` – Frost-Unschärfe mit
  angehobener Sättigung (typisch für "Liquid Glass"/"Glassmorphism")
- diagonalem Verlaufshintergrund statt flacher Fläche
- spiegelndem Kantenlicht oben (`inset box-shadow`) und einem
  Glanzstreifen (`::before`-Pseudoelement)
- weichem Hover-/Active-Übergang (Aufhellung, leichte Skalierung)

Angewendet auf die eigentlichen **Auswahlflächen**:

- `.tool-btn` (alle Werkzeug-Buttons in der Sidebar/im Detailpanel)
- `.basemap-btn` (Kartenansicht-Auswahl)
- `#search-box` (Suchfeld)
- `.layer-switch` (Ebenen-Umschalter)
- `#tl-speed` (Zeitraffer-Auswahl)
- `.ai-chip` (Vorschlagsfragen im KI-Chat)

Zusätzlich wurden die bereits halbtransparenten Panels
(`#detail-panel`, `#ai-panel`, `#timeline-bar`, `#cockpit-hud`,
`#ai-button`) von einfachem `blur()` auf `blur() saturate()` mit
Verlaufshintergrund und Kantenlicht umgestellt, damit sie stilistisch
zum neuen Auswahlflächen-Look passen.

**Nicht verändert:** Layout/Struktur der Sidebar, Cesium-Globus/3D-Welt-
ansicht, Interaktionslogik (JS unverändert – reine CSS/HTML-Textänderung).

## Getestet

- Lokalen Server gestartet (`node server/server.mjs`), Seite per
  Playwright/Chromium headless geladen.
- `<title>` und Sidebar-`<h1>` liefern `ARGUS`.
- Screenshot bestätigt: Globus/Weltansicht unverändert, Sidebar-Buttons,
  Kartenansicht-Kacheln, Ebenen-Umschalter und Zeitleiste zeigen den
  Frost-/Glanz-Effekt; Hover-Zustand eines `.tool-btn` zeigt sichtbares
  Kantenlicht und Akzent-Aufhellung.
- `console --errors` zeigt ausschließlich die bereits bekannten,
  unabhängigen API-Fehler (429/503 von Flugdaten-Anbietern ohne Key,
  siehe Demo-Hinweis im UI) – keine neuen Fehler durch die CSS/HTML-
  Änderung.
