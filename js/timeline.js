/**
 * timeline.js – Zeitsteuerung der Simulation.
 *
 * Phase 1: steuert die Bewegungssimulation (Play / Pause / Reset / Speed).
 * Die Klasse ist so aufgebaut, dass später Live-Daten und historische
 * Wiedergabe ergänzt werden können (Modus "live" | "sim" | "history").
 */

export class Timeline {

    constructor() {
        this.playing = true;
        this.speed = 10;             // Zeitraffer-Faktor
        this.simElapsed = 0;         // vergangene Simulationssekunden
        this.mode = "sim";           // vorbereitet: "live" | "history"

        this._el = {
            play: document.getElementById("tl-play"),
            pause: document.getElementById("tl-pause"),
            restart: document.getElementById("tl-restart"),
            speed: document.getElementById("tl-speed"),
            clock: document.getElementById("tl-clock"),
            progress: document.getElementById("timeline-progress"),
            live: document.getElementById("tl-live"),
            statSim: document.getElementById("stat-sim")
        };

        this.onReset = null;   // Callback für app.js (Daten neu laden)

        this._bind();
        this._updateButtons();
    }

    _bind() {
        this._el.play.addEventListener("click", () => this.play());
        this._el.pause.addEventListener("click", () => this.pause());
        this._el.restart.addEventListener("click", () => this.reset());
        this._el.speed.addEventListener("change", (e) => {
            this.speed = parseFloat(e.target.value);
        });
        // Standard-Speed aus config.js übernehmen
        const cfg = window.WORLD_VIEWER_CONFIG?.simulation;
        if (cfg?.defaultSpeed) {
            this.speed = cfg.defaultSpeed;
            this._el.speed.value = String(cfg.defaultSpeed);
        }
    }

    play() { this.playing = true; this._updateButtons(); }

    pause() { this.playing = false; this._updateButtons(); }

    reset() {
        this.simElapsed = 0;
        if (this.onReset) this.onReset();
        this._updateClock();
    }

    /**
     * Wird pro Frame von app.js aufgerufen.
     * @param {number} realDeltaSeconds  reale Sekunden seit letztem Frame
     * @returns {number} Simulations-Delta (0 wenn pausiert)
     */
    tick(realDeltaSeconds) {
        if (!this.playing) return 0;
        const simDelta = realDeltaSeconds * this.speed;
        this.simElapsed += simDelta;
        this._updateClock();
        return simDelta;
    }

    _updateClock() {
        const total = Math.floor(this.simElapsed);
        const h = String(Math.floor(total / 3600)).padStart(2, "0");
        const m = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
        const s = String(total % 60).padStart(2, "0");
        this._el.clock.textContent = `${h}:${m}:${s}`;

        // Fortschrittsbalken: eine "Runde" = 1 simulierte Stunde
        const pct = ((this.simElapsed % 3600) / 3600) * 100;
        this._el.progress.style.width = `${pct}%`;
    }

    _updateButtons() {
        this._el.play.classList.toggle("active", this.playing);
        this._el.pause.classList.toggle("active", !this.playing);
        this._el.live.classList.toggle("paused", !this.playing);
        this._el.live.textContent = this.playing ? "LIVE SIM" : "PAUSIERT";
        this._el.statSim.textContent = this.playing ? "läuft" : "pausiert";
    }
}
