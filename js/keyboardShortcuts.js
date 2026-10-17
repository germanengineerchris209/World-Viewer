/**
 * keyboardShortcuts.js – Eine Stelle für ALLE globalen Tastenkürzel.
 *
 * Vorher hatte jedes Modul (app.js, ui.js, drawToolsPanel.js, ai/assistant.js)
 * seinen eigenen `document.addEventListener("keydown", ...)`. Das macht die
 * Belegung unübersichtlich und fehleranfällig – siehe WEB-88. Jetzt gibt es
 * genau einen Listener hier; Module registrieren sich darüber.
 *
 * Schema (Parität zu "God's Eye View", github.com/bilawalsidhu/gods-eye-view):
 *   1–7      Sensorstile (siehe sensorStyles.js)
 *   H        Tactical-HUD-Rahmen ein/aus (Eckmarken + Statuszeile)
 *   D        Erkennungs-Overlay ein/aus (Ziel-Boxen + Telemetrie auf Objekten)
 *   C        Cockpit-Ansicht für das ausgewählte Flugzeug ein/aus
 *   `        FPS-Zähler ein/aus
 *   ?        Diese Kurzreferenz ein/aus
 *   Esc      Kette: oberstes Panel schließen → Verfolgen beenden →
 *            Cockpit verlassen (erster zutreffender Schritt gewinnt)
 *
 * Kürzel feuern NICHT, während in einem Eingabefeld (Suche, KI-Chat, ...)
 * getippt wird – sonst würde z.B. "nvg" im Suchfeld einen Sensorstil
 * auslösen. Escape ist davon bewusst ausgenommen: Escape soll auch aus
 * einem Textfeld heraus das nächste Panel schließen können.
 */

function isTypingTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
}

export class KeyboardShortcuts {

    constructor() {
        this._shortcuts = [];    // { key, label, category, handler }
        this._escapeSteps = [];  // { order, handler } – handler() => true, wenn verarbeitet
        this._referencePanel = null;

        document.addEventListener("keydown", (e) => this._onKeyDown(e));
    }

    /**
     * Ein einzelnes Tastenkürzel registrieren (alles außer Escape, dafür
     * siehe registerEscapeStep).
     * @param {{key:string, label:string, category?:string, handler:Function}} shortcut
     */
    register({ key, label, category = "Allgemein", handler }) {
        this._shortcuts.push({ key: key.toLowerCase(), label, category, handler });
    }

    /**
     * Einen Schritt der Esc-Kette registrieren. `order` bestimmt die
     * Reihenfolge (klein = wird zuerst versucht): Panel schließen (10er)
     * vor Tracking beenden (20er) vor Cockpit verlassen (30er).
     * `handler()` muss `true` liefern, wenn er etwas geschlossen/beendet
     * hat – dann stoppt die Kette bei diesem Schritt.
     */
    registerEscapeStep(order, handler) {
        this._escapeSteps.push({ order, handler });
        this._escapeSteps.sort((a, b) => a.order - b.order);
    }

    /** Verbindet die Kurzreferenz-Anzeige (siehe keyboardReference.js). */
    setReferencePanel(panel) {
        this._referencePanel = panel;
    }

    /** Alle registrierten Kürzel für die Kurzreferenz-Anzeige. */
    list() {
        return this._shortcuts.slice();
    }

    _onKeyDown(e) {
        if (e.key === "Escape") {
            for (const step of this._escapeSteps) {
                if (step.handler()) {
                    e.preventDefault();
                    return;
                }
            }
            return;
        }

        if (e.key === "?") {
            if (isTypingTarget(document.activeElement)) return;
            e.preventDefault();
            this._referencePanel?.toggle();
            return;
        }

        if (isTypingTarget(document.activeElement)) return;

        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        for (const s of this._shortcuts) {
            if (s.key === key) {
                e.preventDefault();
                s.handler(e);
                return;
            }
        }
    }
}
