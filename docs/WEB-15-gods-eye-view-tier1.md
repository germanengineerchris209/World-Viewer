# WEB-15 — God's-Eye-View-Vergleich + Tier-1-Umsetzung

**Status:** erledigt
**Auftrag:** World Viewer mit dem Referenzprojekt
[bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view)
(MIT-Lizenz, Quelle des bereits portierten Cockpit-Mitflugs) vergleichen,
priorisierte Verbesserungsvorschläge ableiten und die risikoärmste Stufe
(Tier 1) direkt umsetzen.

## Umgesetzt

| # | Teil | PR | Beschreibung |
|---|---|---|---|
| 1 | Kamera-Katalog | [#2](https://github.com/germanengineerchris209/World-Viewer/pull/2) | 5 neue handverlesene Live-Webcams (Niagarafälle, Piazza San Marco, Dubai Marina, Sydney Harbour Bridge & Opera House, Fuji-san) zu `data/cameras.json` ergänzt, Video-IDs vorab per YouTube-oEmbed-API verifiziert |
| 2 | Feature-Vergleich | [#3](https://github.com/germanengineerchris209/World-Viewer/pull/3) | `ANALYSE-GODS-EYE-VIEW.md`: Architektur- und Layer-Gegenüberstellung mit God's Eye View, priorisierte Verbesserungsvorschläge in drei Tiers nach Aufwand/Kosten |
| 3 | Tier-1-Umsetzung | [#4](https://github.com/germanengineerchris209/World-Viewer/pull/4) | Share-Links (`js/shareLink.js`), Sensor-Stile CRT/NVG/FLIR/Noir/Snow (`js/sensorStyles.js`), zusätzliche Infrastruktur-Kategorien Rechenzentrum/Staudamm (8 neue Objekte), Setup-Diagnose `npm run doctor` (`server/doctor.mjs`) |

Kamera-Sichtfeld (Viewshed), ursprünglich ebenfalls Teil von Tier 1, wurde
in PR #4 bewusst auf Tier 2 verschoben: `cameras.json` hat keine
Blickrichtungs-/FOV-Felder, das erfordert erst eine
Datenmodell-Erweiterung.

Alle Tier-1-Punkte nutzen ausschließlich clientseitige Logik bzw. rein
statische Datensätze – kein neuer Schlüssel, keine neue Sicherheitsfläche.

## Ergebnis des Vergleichs (Kurzfassung)

Siehe `ANALYSE-GODS-EYE-VIEW.md` für die vollständige Tabelle. Bewusst
**nicht** übernommen: der Vite-Build (World Viewers Stärke ist der
fehlende Build-Schritt) und Personen-Tracking (von GEV selbst
ausgeschlossen). Tier 2 (Routenplanung, Leihräder, Radio, ÖPNV, Verkehr)
und Tier 3 (Sprachagent, Zeichnen/Whiteboard, Szenen-Regisseur,
Erkennungs-Overlay, 3D-Flugzeugmodelle) sind zurückgestellt – Tier 3
insbesondere wegen laufender Kosten (Sprachagent) explizit
freigabepflichtig.

## Getestet

Laut Testplänen der einzelnen PRs:

- PR #2: `data/cameras.json` als valides JSON geprüft, Server lokal
  gestartet und `/data/cameras.json` per HTTP abgerufen (17 Kameras
  korrekt ausgeliefert), alle 5 neuen YouTube-Video-IDs per oEmbed-API
  verifiziert
- PR #3: reine Dokumentation, kein Code geändert
- PR #4: `node --check` auf allen neuen/geänderten JS-Dateien,
  Playwright/Chromium headless ohne Konsolenfehler (bis auf erwarteten
  503 für `/api/fires` ohne FIRMS-Key), Share-Button erzeugt eine URL und
  das erneute Öffnen stellt Kamera+Layer korrekt wieder her, Tasten 1–6
  wechseln sichtbar den Canvas-Filter, `/data/infrastructure.json` liefert
  die neuen Kategorien `datacenter` und `dam`

## Offene Folgefragen

- Tier 2/3 aus `ANALYSE-GODS-EYE-VIEW.md` sind nicht umgesetzt und liegen
  laut WEB-20-Dokumentation (`docs/WEB-20-open-source-palantir.md`) jetzt
  im Aufgabenbereich des Feature-Research-Agents.
- Kamera-Sichtfeld (Viewshed) braucht vor der Umsetzung eine Erweiterung
  von `cameras.json` um Blickrichtung/FOV.
