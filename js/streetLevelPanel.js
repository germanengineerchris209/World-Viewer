/**
 * streetLevelPanel.js – Rail-Panel für Street-Level-Bilder (WEB-95, F7).
 *
 * Bettet den offiziellen mapillary-js-Viewer ein (CDN, nur lazy geladen,
 * wenn tatsächlich ein Bild geöffnet wird – kein Build-Schritt nötig,
 * gleiches Muster wie hls.js in streamPlayer.js).
 *
 * Der Mapillary-Zugriffstoken kommt bei jedem Öffnen frisch von
 * /api/mapillary/token statt fest im Client-Code zu liegen (WEB-95:
 * "Token über den Server brokern"). Das ist nötig, weil mapillary-js seine
 * Kachel-/Mesh-Anfragen selbst direkt aus dem Browser stellt – anders als
 * die Abdeckungssuche (StreetLevelLayer), die komplett über den Server läuft.
 */

const MAPILLARY_JS_CDN = "https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.js";
const MAPILLARY_CSS_CDN = "https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.css";

const fmtDate = new Intl.DateTimeFormat("de-DE", { year: "numeric", month: "2-digit", day: "2-digit" });

let mapillaryLoader = null;

/** mapillary-js einmalig nachladen (nur wenn wirklich ein Bild geöffnet wird). */
function loadMapillaryJs() {
    if (window.mapillary) return Promise.resolve(window.mapillary);
    if (mapillaryLoader) return mapillaryLoader;

    if (!document.querySelector(`link[href="${MAPILLARY_CSS_CDN}"]`)) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = MAPILLARY_CSS_CDN;
        document.head.appendChild(link);
    }

    mapillaryLoader = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = MAPILLARY_JS_CDN;
        script.onload = () => resolve(window.mapillary);
        script.onerror = () => reject(new Error("mapillary-js konnte nicht geladen werden"));
        document.head.appendChild(script);
    });
    return mapillaryLoader;
}

export class StreetLevelPanel {

    /**
     * @param {import("./layers/StreetLevelLayer.js").StreetLevelLayer} layer
     */
    constructor(layer) {
        this.layer = layer;
        this.viewer = null;        // aktive mapillary.Viewer-Instanz
        this.currentImage = null;

        this._el = {
            panel: document.getElementById("streetlevel-panel"),
            close: document.getElementById("streetlevel-close"),
            viewerBox: document.getElementById("streetlevel-viewer"),
            meta: document.getElementById("streetlevel-meta"),
            filterType: document.getElementById("streetlevel-filter-type"),
            filterStart: document.getElementById("streetlevel-filter-start"),
            filterEnd: document.getElementById("streetlevel-filter-end"),
            hint: document.getElementById("streetlevel-hint")
        };
        if (!this._el.panel) return;

        this._bind();
    }

    _bind() {
        this._el.close.addEventListener("click", () => this.close());
        this._el.filterType.addEventListener("change", () => this._applyFilters());
        this._el.filterStart.addEventListener("change", () => this._applyFilters());
        this._el.filterEnd.addEventListener("change", () => this._applyFilters());
    }

    _applyFilters() {
        const startMs = this._el.filterStart.value ? new Date(this._el.filterStart.value).getTime() : null;
        // Ende des gewählten Tages, nicht Mitternacht davor
        const endMs = this._el.filterEnd.value ? new Date(this._el.filterEnd.value).getTime() + 86_400_000 - 1 : null;
        this.layer.setFilters({ imageType: this._el.filterType.value, startMs, endMs });
    }

    get isOpen() {
        return this._el.panel && !this._el.panel.classList.contains("hidden");
    }

    /** Von app.js aufgerufen, wenn ein Bildkegel auf dem Globus angeklickt wird. */
    async openImage(obj) {
        if (!this._el.panel) return;
        this.currentImage = obj;
        this._el.panel.classList.remove("hidden");

        this._el.meta.textContent = `${obj.metadata.isPano ? "🌐 360°" : "📷 Flach"} · ${fmtDate.format(new Date(obj.timestamp))}`;
        this._el.hint.textContent = "Lade Bild …";

        try {
            const tokenRes = await fetch("/api/mapillary/token");
            const tokenData = await tokenRes.json();
            if (!tokenRes.ok) throw new Error(tokenData.message ?? `HTTP ${tokenRes.status}`);

            const mapillary = await loadMapillaryJs();
            this._destroyViewer();
            this.viewer = new mapillary.Viewer({
                accessToken: tokenData.token,
                container: this._el.viewerBox,
                imageId: obj.id
            });
            this._el.hint.textContent = "Imagery © Mapillary contributors";

        } catch (err) {
            this._el.hint.textContent = `Bild konnte nicht geladen werden: ${err.message}`;
        }
    }

    close() {
        if (!this._el.panel) return;
        this._el.panel.classList.add("hidden");
        this._destroyViewer();
        this.currentImage = null;
    }

    _destroyViewer() {
        if (this.viewer) {
            try { this.viewer.remove(); } catch { /* egal, Panel schließt trotzdem */ }
            this.viewer = null;
        }
    }
}
