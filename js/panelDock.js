/**
 * panelDock.js – Andock-/Verschiebe-/Skalierlogik für die rechte Panel-Rail
 * (Detail-, KI- und Graph-Panel). Siehe WEB-86.
 *
 * Panels bleiben strukturell unverändert (gleiche IDs, gleiche
 * show()/hide()-Logik in ui.js/assistant.js) – dieses Modul beobachtet nur
 * ihre "hidden"-Klasse per MutationObserver und übernimmt Position, Größe
 * und Stapel-Reihenfolge. Unterhalb von 821px Breite (WEB-60 Mobile-Breakpoint)
 * bleibt die bisherige Vollbild-Darstellung unverändert, da dort keine
 * Drag-/Resize-Handler aktiv werden.
 */

const STORAGE_KEY = "wv.panelDock.v1";
const DESKTOP_QUERY = "(min-width: 821px)";
const REDOCK_MARGIN = 32;
const DRAG_THRESHOLD = 4;

export class PanelDock {
    /** @param {string} railSelector CSS-Selektor der rechten Rail */
    constructor(railSelector) {
        this.rail = document.querySelector(railSelector);
        this.panels = new Map();
        this.openStack = [];
        this._zCounter = 200;
        this._state = this._loadState();

        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            // Cockpit hat seine eigene Esc-Bedeutung (Kamera verlassen) – nicht
            // zusätzlich noch ein Panel schließen, siehe WEB-86-Abstimmung mit U4.
            if (document.body.classList.contains("cockpit-mode")) return;
            this.closeTopmost();
        });
    }

    _isDesktop() {
        return window.matchMedia(DESKTOP_QUERY).matches;
    }

    _loadState() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
        } catch {
            return {};
        }
    }

    _saveState() {
        const out = {};
        for (const [id, p] of this.panels) {
            out[id] = { mode: p.mode, x: p.x, y: p.y, width: p.width, height: p.height };
        }
        if (this.rail) {
            out.__order = [...this.rail.querySelectorAll(":scope > .dock-panel")]
                .map(el => el.dataset.panelId);
        }
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
        } catch { /* Speicher voll/blockiert – Layout bleibt nur für die Sitzung erhalten */ }
    }

    /**
     * @param {object} opts
     * @param {string} opts.id
     * @param {HTMLElement} opts.el       Panel-Wurzelelement (trägt "hidden" wenn geschlossen)
     * @param {HTMLElement} opts.header   Kopfzeile – dient als Ziehgriff
     * @param {number} [opts.minWidth]
     * @param {number} [opts.minHeight]
     * @param {() => void} opts.close     Echtes Schließen (ruft die bestehende hide-Logik auf)
     */
    register({ id, el, header, minWidth = 260, minHeight = 160, close }) {
        const saved = this._state[id] || {};
        const panel = {
            id, el, header, minWidth, minHeight, close,
            mode: saved.mode === "floating" ? "floating" : "docked",
            x: saved.x, y: saved.y, width: saved.width, height: saved.height
        };
        this.panels.set(id, panel);
        el.dataset.panelId = id;
        el.classList.add("dock-panel");

        this._applyMode(panel);
        this._bindDrag(panel);
        this._bindResize(panel);

        new MutationObserver(() => {
            const isOpen = !el.classList.contains("hidden");
            const idx = this.openStack.indexOf(id);
            if (isOpen) {
                if (idx !== -1) this.openStack.splice(idx, 1);
                this.openStack.push(id);
                if (panel.mode === "floating") this._bringToFront(panel);
            } else if (idx !== -1) {
                this.openStack.splice(idx, 1);
            }
        }).observe(el, { attributes: true, attributeFilter: ["class"] });

        return panel;
    }

    /** Ordnet die Rail-Kinder in der zuletzt gespeicherten Reihenfolge an. */
    applySavedOrder() {
        const order = this._state.__order;
        if (!Array.isArray(order) || !this.rail) return;
        for (const id of order) {
            const panel = this.panels.get(id);
            if (panel && panel.mode === "docked") this.rail.appendChild(panel.el);
        }
    }

    /** Schließt das zuletzt geöffnete/fokussierte verwaltete Panel (Esc). */
    closeTopmost() {
        const id = this.openStack[this.openStack.length - 1];
        if (!id) return;
        this.panels.get(id)?.close?.();
    }

    _bringToFront(panel) {
        panel.el.style.zIndex = String(++this._zCounter);
    }

    _applyMode(panel) {
        panel.el.classList.toggle("docked", panel.mode === "docked");
        panel.el.classList.toggle("floating", panel.mode === "floating");
        if (panel.mode === "floating") {
            panel.el.style.left = (panel.x ?? 80) + "px";
            panel.el.style.top = (panel.y ?? 80) + "px";
            if (panel.width) panel.el.style.width = panel.width + "px";
            if (panel.height) panel.el.style.height = panel.height + "px";
            this._bringToFront(panel);
        } else {
            panel.el.style.left = "";
            panel.el.style.top = "";
            panel.el.style.width = "";
            panel.el.style.zIndex = "";
            if (panel.height) panel.el.style.height = panel.height + "px";
        }
    }

    _bindDrag(panel) {
        panel.header.classList.add("dock-panel-header-draggable");

        panel.header.addEventListener("pointerdown", (e) => {
            if (!this._isDesktop()) return;
            if (e.button !== 0) return;
            if (e.target.closest("button, input, textarea, select, a")) return;

            e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const startRect = panel.el.getBoundingClientRect();
            const grabX = startX - startRect.left, grabY = startY - startRect.top;
            let moved = false;

            document.body.classList.add("wv-dragging-panel");
            panel.el.classList.add("dragging");
            this._bringToFront(panel);

            const reorderIfNeeded = (clientY) => {
                const siblings = [...this.rail.querySelectorAll(":scope > .dock-panel")]
                    .filter(el => el !== panel.el);
                let target = null;
                for (const sib of siblings) {
                    const r = sib.getBoundingClientRect();
                    if (clientY < r.top + r.height / 2) { target = sib; break; }
                }
                if (target) {
                    if (panel.el.nextSibling !== target) this.rail.insertBefore(panel.el, target);
                } else if (this.rail.lastElementChild !== panel.el) {
                    this.rail.appendChild(panel.el);
                }
            };

            const onMove = (ev) => {
                const dx = ev.clientX - startX, dy = ev.clientY - startY;
                if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
                moved = true;

                const railRect = this.rail.getBoundingClientRect();
                const overRail = this._isDesktop() &&
                    ev.clientX >= railRect.left - REDOCK_MARGIN && ev.clientX <= railRect.right + REDOCK_MARGIN &&
                    ev.clientY >= railRect.top - REDOCK_MARGIN && ev.clientY <= railRect.bottom + REDOCK_MARGIN;

                if (overRail) {
                    if (panel.mode === "floating") {
                        panel.mode = "docked";
                        panel.el.style.left = "";
                        panel.el.style.top = "";
                        panel.el.style.width = "";
                        panel.el.classList.remove("floating");
                        panel.el.classList.add("docked");
                    }
                    reorderIfNeeded(ev.clientY);
                } else {
                    panel.mode = "floating";
                    panel.width = panel.width ?? startRect.width;
                    panel.height = panel.height ?? startRect.height;
                    panel.x = ev.clientX - grabX;
                    panel.y = ev.clientY - grabY;
                    panel.el.classList.remove("docked");
                    panel.el.classList.add("floating");
                    panel.el.style.left = panel.x + "px";
                    panel.el.style.top = panel.y + "px";
                    if (panel.width) panel.el.style.width = panel.width + "px";
                }
            };

            const onUp = () => {
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onUp);
                document.body.classList.remove("wv-dragging-panel");
                panel.el.classList.remove("dragging");
                if (moved) this._saveState();
            };

            document.addEventListener("pointermove", onMove);
            document.addEventListener("pointerup", onUp);
        });
    }

    _bindResize(panel) {
        const bottom = document.createElement("div");
        bottom.className = "dock-resize-handle dock-resize-bottom";
        bottom.title = "Höhe ändern";
        const corner = document.createElement("div");
        corner.className = "dock-resize-handle dock-resize-corner";
        corner.title = "Größe ändern";
        panel.el.append(bottom, corner);

        const start = (withWidth) => (e) => {
            if (!this._isDesktop()) return;
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();

            const startX = e.clientX, startY = e.clientY;
            const rect = panel.el.getBoundingClientRect();
            const startW = rect.width, startH = rect.height;

            const onMove = (ev) => {
                const newHeight = Math.max(panel.minHeight, startH + (ev.clientY - startY));
                panel.height = newHeight;
                panel.el.style.height = newHeight + "px";
                if (withWidth && panel.mode === "floating") {
                    const newWidth = Math.max(panel.minWidth, startW + (ev.clientX - startX));
                    panel.width = newWidth;
                    panel.el.style.width = newWidth + "px";
                }
            };
            const onUp = () => {
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onUp);
                this._saveState();
            };
            document.addEventListener("pointermove", onMove);
            document.addEventListener("pointerup", onUp);
        };

        bottom.addEventListener("pointerdown", start(false));
        corner.addEventListener("pointerdown", start(true));
    }
}
