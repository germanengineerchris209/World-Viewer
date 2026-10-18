# Task-Dokumentation

Dieser Ordner enthält ein Dokument pro Task (Paperclip-Issue), gepflegt vom
Documentation Agent. Er ergänzt `DOKUMENTATION.md` (Architekturüberblick) um
die Historie *pro Task*: was war der Auftrag, was wurde umgesetzt, wie wurde
es getestet, welche PRs gehören dazu.

## Namenskonvention

```
docs/<ISSUE-ID>-<kurzer-titel-in-kebab-case>.md
```

- `<ISSUE-ID>` ist die Paperclip-Issue-ID (z.B. `WEB-20`) – das *ist* die
  Nummerierung. Es gibt bewusst kein zweites, eigenes Nummernschema.
- `<kurzer-titel>` ist eine kurze, sprechende Kurzfassung des Issue-Titels
  in Kleinschreibung mit Bindestrichen.
- Beispiel: `docs/WEB-20-open-source-palantir.md`

Ändert sich ein Feature später erneut (z.B. über ein Folge-Issue), bekommt
es ein neues Dokument mit der neuen Issue-ID – bestehende Dokumente werden
nicht rückwirkend umbenannt.

## Dokument-Übersicht

| Issue | Titel | Status | Datei |
|---|---|---|---|
| WEB-12 | UI-Texte durchgängig auf Deutsch übersetzen | erledigt | [WEB-12-ui-uebersetzung-deutsch.md](./WEB-12-ui-uebersetzung-deutsch.md) |
| WEB-15 | God's-Eye-View-Vergleich + Tier-1-Umsetzung | erledigt | [WEB-15-gods-eye-view-tier1.md](./WEB-15-gods-eye-view-tier1.md) |
| WEB-20 | Open Source Palantir – Gotham-Features | erledigt | [WEB-20-open-source-palantir.md](./WEB-20-open-source-palantir.md) |
| WEB-33 | UI Update – Liquid Glass + Rebranding zu ARGUS | erledigt | [WEB-33-ui-update-liquid-glass.md](./WEB-33-ui-update-liquid-glass.md) |
| WEB-83 | [R2] Datenquellen-Spezifikation Verkehr/ÖPNV/Street-Level/Militär | erledigt | [WEB-83-datenquellen-verkehr-oepnv-streetlevel-militaer.md](./WEB-83-datenquellen-verkehr-oepnv-streetlevel-militaer.md) |
| WEB-84 | [R3] SGP4-Satellitenpropagation ohne Build-Schritt | erledigt | [WEB-84-sgp4-satellitenpropagation-ohne-build-schritt.md](./WEB-84-sgp4-satellitenpropagation-ohne-build-schritt.md) |
| WEB-81 | New Features + UI Overhaul (Epic-Dossier) | größter Teil erledigt, Details siehe Dokument | [WEB-81-gev-features-ui-overhaul.md](./WEB-81-gev-features-ui-overhaul.md) |
| — | Integrationsbericht zur WEB-81-Welle vom 17.10.2026 | erledigt | [WEB-81-integrationswelle.md](./WEB-81-integrationswelle.md) |

*(Wird vom Documentation Agent bei jedem neuen/aktualisierten Task ergänzt.)*
