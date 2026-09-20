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
| WEB-20 | Open Source Palantir – Gotham-Features | erledigt | [WEB-20-open-source-palantir.md](./WEB-20-open-source-palantir.md) |

*(Wird vom Documentation Agent bei jedem neuen/aktualisierten Task ergänzt.)*
