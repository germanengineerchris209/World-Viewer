/**
 * RadarLayer.js – Live-Niederschlagsradar als Kachel-Overlay (RainViewer).
 *
 * Datenquelle: RainViewer Weather Maps API
 * (https://www.rainviewer.com/api/weather-maps-api.html), kostenlos für
 * private/Bildungszwecke, ohne Account/Key, CORS ist laut Doku gesetzt.
 * https://api.rainviewer.com/public/weather-maps.json liefert die
 * Zeitschritte der letzten ~2 Stunden (10-Minuten-Takt); zu jedem Zeitschritt
 * gehört ein Host+Pfad, aus dem sich eine normale {z}/{x}/{y}-Kachel-URL
 * bauen lässt.
 *
 * Anders als die übrigen Layer (Punkt-Entities über BaseLayer/CustomDataSource)
 * ist das hier ein Kachel-Overlay: pro Zeitschritt eine eigene
 * Cesium.ImageryLayer, von denen immer nur eine sichtbar ist – Play/Pause
 * schaltet zwischen ihnen durch (siehe historyReplay.js für dasselbe Muster
 * bei Entities statt Kacheln).
 *
 * Fällt die API aus oder antwortet unerwartet, bleibt der bisherige
 * Punkt-Wetter-Layer (WeatherLayer.js, WEB-56) unberührt nutzbar – alle
 * Fehler hier werden abgefangen und nur protokolliert, nie geworfen.
 */

import { BaseLayer } from "./BaseLayer.js";

const FRAMES_URL = "https://api.rainviewer.com/public/weather-maps.json";
const TILE_SIZE = 256;
const COLOR_SCHEME = 4;      // RainViewer-Farbschema "Universal Blue"
const TILE_OPTIONS = "1_1";  // smooth=1, snow=1
const MAX_ZOOM = 7;          // laut RainViewer-Doku die höchste unterstützte Stufe

const CFG = () => window.WORLD_VIEWER_CONFIG?.radar ?? {};

export class RadarLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "radar",
            name: "Niederschlagsradar",
            icon: "📡",
            type: "radar",
            dataUrl: null
        });

        this._frames = [];          // [{ timeMs, url }], älteste zuerst
        this._frameIndex = -1;
        this._imageryLayer = null;  // aktuell sichtbare Cesium.ImageryLayer
        this._playing = false;
        this._timer = null;         // Abspiel-Timer (Frame-Wechsel)
        this._refreshTimer = null;  // periodisches Neuladen der Zeitschritte
        this.lastError = "";
        this.lastFetchAt = 0;

        this._el = {
            section: document.getElementById("radar-section"),
            play: document.getElementById("radar-play"),
            pause: document.getElementById("radar-pause"),
            scrub: document.getElementById("radar-scrub"),
            clock: document.getElementById("radar-clock"),
            status: document.getElementById("radar-status")
        };
        this._bind();
    }

    _bind() {
        if (!this._el.play) return; // UI-Bedienelemente sind optional
        this._el.play.addEventListener("click", () => this.play());
        this._el.pause.addEventListener("click", () => this.pause());
        this._el.scrub.addEventListener("input", (e) => this.seek(Number(e.target.value)));
    }

    async load() {
        await this.refresh();

        // Neue Zeitschritte kommen alle ~10 Minuten dazu – ähnlich wie beim
        // Wetter-Layer reicht ein moderates Intervall zum Nachladen.
        const seconds = CFG().refreshSeconds ?? 300;
        this._refreshTimer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 15_000);
            const res = await fetch(CFG().apiUrl || FRAMES_URL, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const json = await res.json();
            const host = json?.host;
            const past = Array.isArray(json?.radar?.past) ? json.radar.past : [];
            if (!host || past.length === 0) throw new Error("keine Zeitschritte in der Antwort");

            const wasPlaying = this._playing;
            this._frames = past.map(f => ({
                timeMs: f.time * 1000,
                url: this._tileUrl(host, f.path)
            }));
            this.lastFetchAt = Date.now();
            this.lastError = "";

            if (this._el.scrub) this._el.scrub.max = String(this._frames.length - 1);
            this._setStatus(`${this._frames.length} Zeitschritte · letzte ${this._formatTime(this._frames.at(-1).timeMs)}`);

            this._showFrame(this._frames.length - 1); // jüngster Zeitstempel zuerst
            if (wasPlaying) this.play();

        } catch (err) {
            this.lastError = err.message;
            console.warn("[Radar] Abruf fehlgeschlagen, Wetter-Layer (WEB-56) bleibt nutzbar:", err.message);
            this._setStatus(`Nicht verfügbar (${err.message})`);
        }
    }

    _tileUrl(host, path) {
        return `${host}${path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${TILE_OPTIONS}.png`;
    }

    _formatTime(ms) {
        return new Date(ms).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    }

    _setStatus(text) {
        if (this._el.status) this._el.status.textContent = text;
    }

    /** Blendet den Frame mit gegebenem Index ein (ersetzt die aktuelle ImageryLayer). */
    _showFrame(index) {
        if (!this._frames.length) return;
        index = Math.max(0, Math.min(index, this._frames.length - 1));

        const frame = this._frames[index];
        const provider = new Cesium.UrlTemplateImageryProvider({
            url: frame.url,
            tileWidth: TILE_SIZE,
            tileHeight: TILE_SIZE,
            maximumLevel: MAX_ZOOM,
            // Pflicht-Namensnennung laut RainViewer-Doku, erscheint automatisch
            // in Cesiums Credit-Leiste unten rechts (siehe style.css .cesium-viewer-bottom)
            credit: new Cesium.Credit(
                'Niederschlagsradar: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener noreferrer">RainViewer API</a>',
                true
            )
        });

        const previous = this._imageryLayer;
        const next = this.viewer.imageryLayers.addImageryProvider(provider);
        next.alpha = 0.75;
        next.show = this.enabled;
        this._imageryLayer = next;
        this._frameIndex = index;

        // Erst nach dem Hinzufügen der neuen Ebene die alte entfernen – sonst
        // flackert der Globus kurz ohne Radar-Kacheln.
        if (previous) this.viewer.imageryLayers.remove(previous, true);

        if (this._el.scrub) this._el.scrub.value = String(index);
        if (this._el.clock) this._el.clock.textContent = this._formatTime(frame.timeMs);
    }

    play() {
        if (!this.enabled || !this._frames.length) return;
        this._playing = true;
        this._el.play?.classList.add("active");
        this._el.pause?.classList.remove("active");
        this._stopPlayTimer();
        this._timer = setInterval(() => {
            const next = this._frameIndex + 1 >= this._frames.length ? 0 : this._frameIndex + 1;
            this._showFrame(next);
        }, CFG().frameIntervalMs ?? 700);
    }

    pause() {
        this._playing = false;
        this._el.play?.classList.remove("active");
        this._el.pause?.classList.add("active");
        this._stopPlayTimer();
    }

    seek(index) {
        this.pause();
        this._showFrame(index);
    }

    _stopPlayTimer() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    _stopRefreshTimer() {
        if (this._refreshTimer) { clearInterval(this._refreshTimer); this._refreshTimer = null; }
    }

    show() {
        super.show();
        this._el.section?.classList.remove("hidden");
        if (this._imageryLayer) this._imageryLayer.show = true;
        if (!this._frames.length && !this.lastError) this.refresh();
    }

    hide() {
        super.hide();
        this.pause();
        this._el.section?.classList.add("hidden");
        if (this._imageryLayer) this._imageryLayer.show = false;
    }

    clear() {
        this._stopPlayTimer();
        this._stopRefreshTimer();
        if (this._imageryLayer) {
            this.viewer.imageryLayers.remove(this._imageryLayer, true);
            this._imageryLayer = null;
        }
        this._frames = [];
        this._frameIndex = -1;
        super.clear();
    }

    get count() { return this._frames.length; }
}
