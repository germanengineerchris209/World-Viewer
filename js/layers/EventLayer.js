/**
 * EventLayer.js – Globale Ereignis-Lage aus Nachrichtenmedien.
 *
 * Quelle: GDELT Project GEO 2.0 API, öffentlich, kein Key nötig
 * (https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/). Läuft über
 * den eigenen Server (/api/events), weil die GDELT-API keine
 * CORS-Header setzt.
 *
 * GDELT durchsucht weltweite Nachrichtenmedien und geokodiert erwähnte
 * Orte automatisch – die Trefferqualität schwankt naturgemäß (siehe
 * DATENQUELLEN.md), ist aber die einzige frei zugängliche Quelle für
 * ein globales Ereignis-Lagebild ohne eigenes Nachrichten-Crawling.
 *
 * Externe Abhängigkeit ohne Zuverlässigkeitsgarantie: Schlägt der Abruf
 * fehl oder liefert GDELT ein Rate-Limit, bleibt der Layer einfach bei
 * seinem letzten Stand (bzw. leer) statt einen Fehler zu werfen.
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord } from "../dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.events ?? {};

const THEME_STYLE = {
    conflict: { color: "#ef4444", icon: "⚔️" },
    protest: { color: "#f97316", icon: "📢" },
    disaster: { color: "#facc15", icon: "🌪️" },
    crisis: { color: "#a855f7", icon: "🚨" }
};
const DEFAULT_STYLE = { color: "#94a3b8", icon: "📰" };

export class EventLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "events",
            name: "Ereignisse",
            icon: "📰",
            type: "event",
            dataUrl: null
        });

        this.available = true;
        this.lastError = "";
        this._timer = null;
    }

    async load() {
        await this.refresh();
        // GDELT aktualisiert seine Kartendaten selbst alle 15 Minuten
        const seconds = CFG().refreshSeconds ?? 900;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        if (!this.enabled) return;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20_000);
            const res = await fetch(CFG().apiUrl || "/api/events", { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            this._rebuild(data.events ?? []);
            this.available = true;
            this.lastError = "";

        } catch (err) {
            // Sauber ausblenden statt Fehler werfen: die bisherigen Marker
            // bleiben stehen, bis der nächste Abruf wieder klappt.
            this.available = false;
            this.lastError = err.message;
            console.info("[Ereignisse] nicht verfügbar:", err.message);
        }
    }

    _rebuild(events) {
        const limit = CFG().maxEvents ?? 800;
        const capped = events.slice(0, limit);

        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        capped.forEach((ev, index) => {
            if (!Number.isFinite(ev.latitude) || !Number.isFinite(ev.longitude)) return;

            const style = THEME_STYLE[ev.theme] ?? DEFAULT_STYLE;
            const obj = normalizeRecord({
                id: ev.id ?? `event-${index}`,
                name: ev.name || `${style.icon} ${ev.themeLabel ?? "Ereignis"}`,
                latitude: ev.latitude,
                longitude: ev.longitude,
                altitude: 0,
                ...ev
            }, "event");

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        });

        console.info(`[Ereignisse] ${this.objects.length} von ${events.length} Meldungen dargestellt.`);
    }

    createEntity(obj) {
        const { theme, count = 0 } = obj.metadata;
        const style = THEME_STYLE[theme] ?? DEFAULT_STYLE;

        // Punktgröße nach Erwähnungshäufigkeit (GDELTs "count"-Feld)
        const size = Math.max(7, Math.min(18, Math.round(7 + Math.sqrt(count) * 1.5)));
        const significant = count >= 10;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, 0),
            point: {
                pixelSize: size,
                color: Cesium.Color.fromCssColorString(style.color).withAlpha(0.85),
                outlineColor: Cesium.Color.BLACK.withAlpha(0.6),
                outlineWidth: 1,
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.2, 2e7, 0.4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: significant ? {
                ...this._makeLabel(obj.name, Cesium.Color.fromCssColorString(style.color)),
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 1.5e7, 0.0)
            } : undefined
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
