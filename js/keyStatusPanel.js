/**
 * keyStatusPanel.js – POWER-UP-Chip + Panel „Schlüssel & Dienste" (WEB-87).
 *
 * Zeigt je Dienst aus server/keyRegistry.mjs den Status (gesetzt / fehlt /
 * extern gesetzt), was er freischaltet, den Kostenhinweis und einen Link
 * zur Registrierung. Die Werte selbst kommen nie an – /api/keys liefert
 * ausschließlich Status-Strings (siehe server/keyRegistry.mjs).
 *
 * Läuft die App ohne Node-Server (nur "python3 -m http.server"), gibt es
 * /api/keys nicht – das Panel zeigt dann einen Hinweis statt eines Fehlers,
 * und die Schlüssel-Badges in der Layer-Konsole (UI._renderKeyBadges)
 * bleiben einfach aus.
 */

const STATUS_LABEL = {
    set: "✅ gesetzt",
    external: "🌐 extern gesetzt",
    missing: "⬜ fehlt"
};
const STATUS_CLASS = {
    set: "live",
    external: "live",
    missing: "demo"
};
const COST_LABEL = {
    gratis: "gratis",
    "gratis-kontingent": "Gratis-Kontingent",
    kostenpflichtig: "kostenpflichtig"
};

export class KeyStatusPanel {

    /** @param {import("./ui.js").UI} ui */
    constructor(ui) {
        this.ui = ui;
        this.statuses = null;

        this._el = {
            button: document.getElementById("keys-button"),
            panel: document.getElementById("keys-panel"),
            close: document.getElementById("keys-close"),
            hint: document.getElementById("keys-hint"),
            list: document.getElementById("keys-list")
        };
        if (!this._el.button || !this._el.panel) return;

        this._bind();
        this._load();
    }

    _bind() {
        this._el.button.addEventListener("click", () => this.toggle());
        this._el.close.addEventListener("click", () => this.close());
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !this._el.panel.classList.contains("hidden")) {
                this.close();
            }
        });
    }

    toggle() {
        this._el.panel.classList.contains("hidden") ? this.open() : this.close();
    }

    open() {
        this._el.panel.classList.remove("hidden");
        this._el.button.classList.add("active");
    }

    close() {
        this._el.panel.classList.add("hidden");
        this._el.button.classList.remove("active");
    }

    async _load() {
        try {
            const res = await fetch("/api/keys");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            this.statuses = data.keys ?? [];
            this._render();
        } catch (err) {
            // Reiner Static-Server ohne /api/* – Panel degradiert sauber
            // statt einen Fehler zu zeigen (Abnahmekriterium WEB-87).
            this.statuses = [];
            this._renderOffline();
        }
        this.ui.applyKeyBadges?.(this.statuses);
    }

    _render() {
        if (!this.statuses.length) {
            this._renderOffline();
            return;
        }
        this._el.hint.textContent = "Status aus server/doctor.mjs – Schlüsselwerte "
            + "selbst bleiben immer auf dem Server, nie im Browser.";
        this._el.list.innerHTML = this.statuses.map((svc) => this._itemHtml(svc)).join("");
    }

    _renderOffline() {
        this._el.hint.textContent = "Kein Server erreichbar (läuft die App nur über "
            + "\"python3 -m http.server\"?) – ohne node server/server.mjs ist der "
            + "Schlüssel-Status hier nicht verfügbar.";
        this._el.list.innerHTML = "";
    }

    _itemHtml(svc) {
        const statusLabel = STATUS_LABEL[svc.status] ?? svc.status;
        const statusClass = STATUS_CLASS[svc.status] ?? "demo";
        const costLabel = COST_LABEL[svc.cost] ?? svc.cost;
        return `
            <li class="keys-item">
                <div class="keys-item-head">
                    <span class="keys-item-name">${svc.name}</span>
                    <span class="flight-badge ${statusClass}">${statusLabel}</span>
                </div>
                <p class="keys-item-unlocks">${svc.unlocks}</p>
                <div class="keys-item-foot">
                    <span class="keys-item-cost">${costLabel}</span>
                    <a href="${svc.signupUrl}" target="_blank" rel="noopener noreferrer">Registrieren →</a>
                </div>
            </li>`;
    }
}
