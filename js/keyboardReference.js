/**
 * keyboardReference.js – Einblendbare Kurzreferenz aller Tastenkürzel.
 *
 * Erzeugt ihr Overlay selbst (wie hud.js seinen Canvas) statt index.html
 * anzufassen – das hält diese Datei unabhängig von der parallel laufenden
 * Panel-Rails-Arbeit (WEB-86/U2). Toggle per `?` (siehe keyboardShortcuts.js)
 * oder per Klick auf den kleinen "⌨" Knopf unten links.
 */

export class KeyboardReference {

    /** @param {import("./keyboardShortcuts.js").KeyboardShortcuts} shortcuts */
    constructor(shortcuts) {
        this.shortcuts = shortcuts;
        this._open = false;

        this._button = document.createElement("button");
        this._button.id = "kb-reference-button";
        this._button.title = "Tastenkürzel anzeigen (Taste ?)";
        this._button.textContent = "⌨";
        this._button.addEventListener("click", () => this.toggle());

        this._panel = document.createElement("div");
        this._panel.id = "kb-reference-panel";
        this._panel.classList.add("hidden");

        const main = document.getElementById("main");
        main.appendChild(this._button);
        main.appendChild(this._panel);

        shortcuts.setReferencePanel(this);
    }

    toggle() {
        this._open ? this.close() : this.open();
    }

    open() {
        this._render();
        this._panel.classList.remove("hidden");
        this._open = true;
    }

    close() {
        this._panel.classList.add("hidden");
        this._open = false;
    }

    get isOpen() { return this._open; }

    _render() {
        const byCategory = new Map();
        for (const s of this.shortcuts.list()) {
            if (!byCategory.has(s.category)) byCategory.set(s.category, []);
            byCategory.get(s.category).push(s);
        }

        // Escape und ? werden speziell behandelt (keyboardShortcuts.js) und
        // stehen deshalb nicht in der normalen Liste – hier von Hand ergänzen.
        const extra = [
            { key: "esc", label: "Zurück: Panel schließen → Verfolgen beenden → Cockpit verlassen" },
            { key: "?", label: "Diese Kurzreferenz ein-/ausblenden" }
        ];

        const section = (title, items) => `
            <section class="kb-ref-section">
                <h3>${title}</h3>
                <ul>
                    ${items.map(s => `
                        <li><kbd>${s.key === " " ? "Leertaste" : s.key.toUpperCase()}</kbd>
                            <span>${s.label}</span></li>`).join("")}
                </ul>
            </section>`;

        let html = `
            <header id="kb-reference-header">
                <h2>⌨ Tastenkürzel</h2>
                <button id="kb-reference-close" title="Schließen">✕</button>
            </header>`;

        for (const [category, items] of byCategory) {
            html += section(category, items);
        }
        html += section("Navigation", extra);

        this._panel.innerHTML = html;
        this._panel.querySelector("#kb-reference-close")
            .addEventListener("click", () => this.close());
    }
}
