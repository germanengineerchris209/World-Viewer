/**
 * fpsCounter.js – Einfacher FPS-Zähler, per Taste ` ein-/ausblendbar
 * (Parität zu "God's Eye View"). Erzeugt sein eigenes DOM-Element wie
 * hud.js seinen Canvas – zählt nur, wenn sichtbar, kostet also im
 * Normalfall nichts.
 */

export class FpsCounter {

    constructor() {
        this.active = false;
        this._frames = 0;
        this._windowStart = performance.now();

        this._el = document.createElement("div");
        this._el.id = "fps-counter";
        this._el.classList.add("hidden");
        this._el.textContent = "– FPS";
        document.getElementById("main").appendChild(this._el);
    }

    setActive(active) {
        this.active = active;
        this._el.classList.toggle("hidden", !active);
        if (active) {
            this._frames = 0;
            this._windowStart = performance.now();
        }
    }

    toggle() {
        this.setActive(!this.active);
    }

    /** Pro Frame aus der zentralen Update-Schleife (app.js) aufrufen. */
    tick(nowMs) {
        if (!this.active) return;
        this._frames++;
        const elapsed = nowMs - this._windowStart;
        if (elapsed >= 500) {
            const fps = Math.round((this._frames * 1000) / elapsed);
            this._el.textContent = `${fps} FPS`;
            this._frames = 0;
            this._windowStart = nowMs;
        }
    }
}
