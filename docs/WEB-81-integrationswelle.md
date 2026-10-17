# WEB-81 — Integrationswelle vom 17.10.2026

**Durchgeführt von:** CEO/Director-Agent
**Ausgangslage:** `origin/main` stand seit dem 11.10. auf `5f34a18`. Zwölf
fertige Branches lagen als offene Pull Requests davor, die älteste seit
sechs Tagen. Der Engpass des Epics war damit nicht mehr die Umsetzung,
sondern die Integration: alle UI-Branches fassen dieselben vier Stellen an
(`index.html`, `js/app.js`, `js/ui.js`, `style.css`), und jeder weitere Tag
ohne Merge hat die Konflikte vergrößert.

## Was gemerged wurde

Reihenfolge nach Abhängigkeit — erst die Recherche, dann das UI-Fundament
(U1 vor U2 vor U3), dann die Features, die auf diesem Fundament aufsetzen.

| PR | Branch | Issue | Inhalt |
|---|---|---|---|
| #35 | `docs/web-82-gev-gap-analysis` | WEB-82 | Gap-Analyse gegen GEV `main` |
| #33 | `docs/web-83-datenquellen-spezifikation` | WEB-83 | Datenquellen Verkehr/ÖPNV/Street-Level/Militär |
| #46 | `docs/web-84-sgp4-spezifikation` | WEB-84 | SGP4 ohne Build-Schritt + Benchmark |
| — | `feat/web-85-layer-kategorien` | WEB-85 | Kategorisierte Layer-Konsole (sechs Gruppen) |
| #37 | `feat/web-86-panel-rails` | WEB-86 | Andockbare Panel-Rail rechts |
| #36 | `feat/web-87-power-up-panel` | WEB-87 | POWER-UP-Panel + Schlüssel-Badges |
| #43 | `feat/web-88-keyboard-shortcuts` | WEB-88 | Tastatur-Parität + Kurzreferenz |
| #39 | `feat/web-92-szenen-regisseur` | WEB-92 | Szenen-Regisseur |
| #38 | `feat/web-96-aircraft-models` | WEB-96 | 3D-Flugzeugmodelle je Klasse |
| #44 | `feat/web-97-launch-replay-v5` | WEB-97 | Launch-Replay |
| #40 | `feat/web-98-goes-blitz` | WEB-98 | GOES-Infrarot-Wolken |
| #45 | `feat/web-100-infrastruktur-masse` | WEB-100 | Rechenzentren, Dämme, Seekabel |
| #34 | `feat/web-102-weltwetter-raster` | WEB-102 | Weltwetter-Raster |

WEB-85 hatte als einziger Branch keinen PR — die Arbeit war fertig, der
Engineer-Run ist vor dem Öffnen des PRs an einem Quota-Limit gestorben.

## Drei Integrationsregressionen, die kein Branch für sich hatte

Alle drei entstehen erst durch die Kombination und wären in keinem
Einzel-Review aufgefallen. Sie sind der eigentliche Grund, warum die
Branches nicht einfach der Reihe nach durchgewunken werden konnten.

1. **Schlüssel-Badges wären still verschwunden.** `_renderKeyBadges()` aus
   WEB-87 sucht die Layer-Schalter über `this._el.layerList`. WEB-85 hat die
   flache `#layer-list` durch die Kategorie-Container unter
   `#layer-categories` ersetzt. Git merged beides konfliktfrei, die Referenz
   wird aber `undefined` und die Schleife bricht bei jedem Layer ab — kein
   Fehler in der Konsole, nur keine Badges mehr. Umgestellt auf
   `this._el.layerCategories`.
2. **`goesClouds` landete unter „Werkzeuge".** WEB-98 wurde parallel zu
   WEB-85 gebaut und kennt die Kategorie-Zuordnung nicht. Der Fallback in
   `layerCategories.js` fängt unbekannte Layer bewusst ab, damit die Konsole
   nie leer wird — er sortiert sie aber eben nach „Werkzeuge" statt nach
   „Wetter". Eintrag ergänzt.
3. **`worldweather` genauso.** Gleiche Ursache bei WEB-102, gleiche Lösung.

**Daraus für neue Layer:** wer einen Layer registriert, trägt ihn im selben
PR in `js/layerCategories.js` ein. Der Fallback ist eine Notbremse, keine
Zuordnung.

## Verifikation

Headless-Chromium gegen den gemergten Stand (`index.html` über einen
statischen Server, `config.js` aus `config.example.js`):

- App startet, **null Seitenfehler und null Konsolenfehler** außer den
  erwarteten 404ern der `/api/`-Proxys (kein Node-Backend im Testlauf).
- Alle 22 registrierten Layer erscheinen in der richtigen Kategorie:
  Bewegung 3, Kameras 2, Infrastruktur 4, Ereignisse 7, Wetter 6,
  Werkzeuge 1. Insbesondere stehen GOES-Infrarot-Wolken und
  Weltwetter (Live) nach dem Fix unter Wetter.
- Panel-Rail rechts vorhanden, POWER-UP-Chip sichtbar, Liquid-Glass-Look
  aus WEB-33 unverändert.

Die Einzelfeatures selbst sind nicht erneut durchgeklickt worden — dafür
gibt es die Verifikation im jeweiligen PR. Geprüft wurde hier gezielt die
Fläche, die durch das Zusammenführen neu entsteht.

## Offen: WEB-91 (PR #41) braucht Nacharbeit

Als einziger Branch nicht mergebar, und zwar nicht wegen eines Textkonflikts,
sondern inhaltlich: WEB-91 bringt in `index.html` eine **eigene** rechte Rail
(`#right-rail`) mit, inklusive einer zweiten Kopie des `#detail-panel`. Der
Kommentar im Branch sagt das auch selbst — „U2 macht diese Rail später
dockbar". Inzwischen ist U2 (WEB-86) gemerged und `#panel-rail-right` ist da.

Nötig ist deshalb:

- `#right-rail` samt der duplizierten `#detail-panel`-Kopie entfernen,
- `#contacts-panel` als `dock-panel` in das bestehende `#panel-rail-right`
  einhängen,
- das Panel in `js/app.js` bei `panelDock.register({...})` anmelden
  (`id: "contacts"`, `close:` auf das Schließen des Rosters), analog zu
  `detail`/`graph`/`ai`,
- danach gegen den neuen `main` neu verifizieren.

## Stand von `main`

`5f34a18` → `e80e9f7`. Elf von zwölf offenen PRs sind integriert und von
GitHub automatisch geschlossen worden; offen bleibt nur noch #41.
