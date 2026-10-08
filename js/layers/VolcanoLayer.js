/**
 * VolcanoLayer.js – Aktive & überwachte Vulkane weltweit.
 *
 * Quellen (öffentlich, kein Schlüssel):
 *   • Smithsonian Global Volcanism Program – https://volcano.si.edu
 *     Weltkatalog + die global laufenden Ausbrüche
 *   • USGS Volcano Hazards Program – https://www.usgs.gov/programs/VHP
 *     amtliche Warnstufen (Aviation Color Code) für US-Vulkane
 *
 * Reine Naturphänomene, kein Personenbezug.
 *
 * Datenweg: Das GVP sendet keine CORS-Header, deshalb führt der Server die
 * Quellen unter /api/volcanoes zusammen (siehe server/dataProxies.mjs).
 * Läuft kein Server – etwa beim Öffnen per file:// – greift der Layer auf
 * den mitgelieferten Schnappschuss data/volcanoes.json zurück. Die Karte
 * bleibt also in jedem Fall gefüllt, kennzeichnet aber, woher der Status
 * stammt.
 *
 * Aktivitätsstatus als Ampel, wie beim bestehenden Erdbeben-Layer:
 *   grün = keine aktuelle Meldung · gelb = Hinweis/Unruhe ·
 *   orange = erhöhte Aktivität · rot = Ausbruch im Gange
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord, svgDataUri } from "../dataManager.js";

const API_URL = "/api/volcanoes";
const FALLBACK_URL = "./data/volcanoes.json";

const STATUS_STYLE = {
    green:  { color: "#34d399", label: "Keine aktuelle Meldung", rank: 3 },
    yellow: { color: "#fbbf24", label: "Hinweis / Unruhe",       rank: 2 },
    orange: { color: "#fb923c", label: "Erhöhte Aktivität",      rank: 1 },
    red:    { color: "#f87171", label: "Ausbruch im Gange",      rank: 0 },
    default:{ color: "#a3a3a3", label: "Unbekannt",              rank: 4 }
};

/** Woher die Einstufung kommt – das gehört sichtbar ins Detailpanel. */
const SOURCE_LABEL = {
    usgs: "USGS-Warnstufe (amtlich)",
    gvp: "Smithsonian GVP – laufender Ausbruch",
    catalog: "GVP-Katalog – keine aktuelle Meldung"
};

const CFG = () => window.WORLD_VIEWER_CONFIG?.volcanoes ?? {};

function markerSvg(color) {
    // Vulkankegel mit Krater – Farbe zeigt den Aktivitätsstatus
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
  <path d="M15 4 L26 25 L4 25 Z" fill="${color}" stroke="#111" stroke-width="1.2"/>
  <path d="M12 12 L18 12 L21 18 L9 18 Z" fill="#111"/>
</svg>`;
}

export class VolcanoLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "volcanoes",
            name: "Vulkane",
            icon: "🗻",
            type: "volcano",
            // Daten holt refresh() selbst – BaseLayer.load() wird überschrieben
            dataUrl: null
        });

        this._icons = {};
        for (const [key, style] of Object.entries(STATUS_STYLE)) {
            this._icons[key] = svgDataUri(markerSvg(style.color));
        }

        this.lastFetchAt = 0;
        this.lastError = "";
        this.dataOrigin = "";     // "live" | "fallback"
        this.sources = [];
        this._timer = null;
    }

    static statusLabel(status) {
        return (STATUS_STYLE[status] ?? STATUS_STYLE.default).label;
    }

    static statusSourceLabel(source) {
        return SOURCE_LABEL[source] ?? "";
    }

    async load() {
        await this.refresh();
        // Warnstufen ändern sich im Tagesrhythmus – stündlich reicht
        const seconds = CFG().refreshSeconds ?? 3600;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        if (!this.enabled) return;

        try {
            const payload = await this._fetchJson(CFG().apiUrl || API_URL);
            this._rebuild(this._extract(payload));
            this.sources = payload?.sources ?? [];
            this.dataOrigin = "live";
            this.lastFetchAt = Date.now();
            this.lastError = payload?.warnings?.join("; ") ?? "";

        } catch (err) {
            // Beim ersten Versuch auf den Schnappschuss zurückfallen.
            // Steht schon etwas auf der Karte, bleibt es stehen – alte
            // Daten sind besser als eine leergeräumte Karte.
            if (this.objects.length) {
                this.lastError = err.message;
                console.warn("[Vulkane] Aktualisierung fehlgeschlagen:", err.message);
                return;
            }

            try {
                const payload = await this._fetchJson(FALLBACK_URL);
                this._rebuild(this._extract(payload));
                this.dataOrigin = "fallback";
                this.lastFetchAt = Date.now();
                this.lastError = `Live-Abruf fehlgeschlagen (${err.message}) – Schnappschuss aktiv`;
                console.warn(`[Vulkane] ${this.lastError}`);

            } catch (fallbackErr) {
                this.lastError = fallbackErr.message;
                console.warn("[Vulkane] Auch der Schnappschuss fehlt:", fallbackErr.message);
            }
        }
    }

    async _fetchJson(url) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
            const res = await fetch(url, { signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status} für ${url}`);
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    }

    /** Schnappschuss und API teilen sich das Format; ein nacktes Array geht auch. */
    _extract(payload) {
        const rows = Array.isArray(payload) ? payload : payload?.volcanoes;
        if (!Array.isArray(rows) || !rows.length) throw new Error("Keine Vulkandaten in der Antwort");
        return rows;
    }

    _rebuild(rows) {
        // Auffällige Vulkane behalten Vorrang, wenn die Liste gekappt wird
        const limit = CFG().maxVolcanoes ?? 600;
        const sorted = [...rows].sort((a, b) =>
            (STATUS_STYLE[a.status] ?? STATUS_STYLE.default).rank
            - (STATUS_STYLE[b.status] ?? STATUS_STYLE.default).rank);

        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        for (const row of sorted.slice(0, limit)) {
            const lat = Number(row.latitude ?? row.position?.latitude);
            const lon = Number(row.longitude ?? row.position?.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

            const obj = normalizeRecord(row, this.type);
            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        }
        console.info(`[Vulkane] ${this.objects.length} Vulkane geladen `
            + `(${this.dataOrigin === "fallback" ? "Schnappschuss" : "live"}).`);
    }

    createEntity(obj) {
        const status = obj.metadata.status ?? "default";
        const style = STATUS_STYLE[status] ?? STATUS_STYLE.default;
        const icon = this._icons[status] ?? this._icons.default;
        const critical = status === "red" || status === "orange";

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: icon,
                width: critical ? 28 : 22,
                height: critical ? 28 : 22,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                // Ruhige Vulkane verschwinden beim Herauszoomen früher,
                // damit die aktiven Kegel auf der Weltkarte lesbar bleiben
                scaleByDistance: critical
                    ? new Cesium.NearFarScalar(1e4, 1.0, 8e6, 0.35)
                    : new Cesium.NearFarScalar(1e4, 0.9, 3e6, 0.0),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(obj.name, Cesium.Color.fromCssColorString(style.color)),
                scaleByDistance: new Cesium.NearFarScalar(5e4, 1.0, 4e6, critical ? 0.35 : 0.0)
            }
        });
    }

    show() {
        super.show();
        if (!this._timer) this.load();
    }

    hide() {
        super.hide();
        this._stopTimer();
    }

    clear() {
        this._stopTimer();
        super.clear();
    }

    _stopTimer() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }
}
