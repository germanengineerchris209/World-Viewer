/**
 * HeatmapLayer.js – Pattern-of-Life-Heatmap (Aktivitäts-Hotspots).
 *
 * Keine neue Datenquelle: reine clientseitige Weiterverarbeitung der
 * bereits geladenen Live-Positionen von Aircraft/Ships (OpenSky/AIS).
 * Alle paar Sekunden wird eine Stichprobe der aktuellen Positionen in
 * ein rollierendes Zeitfenster (Standard 30 Minuten) aufgenommen, zu
 * einem Gitter aggregiert und als eingefärbte Rechtecke dargestellt –
 * je frischer und dichter, desto "heißer" (blau → grün → gelb → rot).
 *
 * Analog zur Bewegungsspur (BaseLayer._recordTrailPoint, siehe WEB-20):
 * dieselbe Idee einer kurzen Positions-Historie, hier aber über alle
 * Objekte hinweg räumlich aggregiert statt pro Objekt als Linie.
 */

import { BaseLayer } from "./BaseLayer.js";

const SOURCE_LAYER_IDS = ["aircraft", "ships"];
const MAX_SAMPLES = 20_000;

const CFG = () => window.WORLD_VIEWER_CONFIG?.heatmap ?? {};

// Klassischer Heat-Gradient: kalt (wenig Aktivität) → heiß (viel Aktivität)
const GRADIENT = [
    { t: 0.0, color: [37, 99, 235] },    // blau
    { t: 0.35, color: [52, 211, 153] },  // grün
    { t: 0.6, color: [250, 204, 21] },   // gelb
    { t: 0.8, color: [251, 146, 60] },   // orange
    { t: 1.0, color: [248, 113, 113] }   // rot
];

function heatColor(t) {
    t = Cesium.Math.clamp(t, 0, 1);
    for (let i = 1; i < GRADIENT.length; i++) {
        if (t <= GRADIENT[i].t) {
            const a = GRADIENT[i - 1], b = GRADIENT[i];
            const f = (t - a.t) / (b.t - a.t || 1);
            return Cesium.Color.fromBytes(
                a.color[0] + (b.color[0] - a.color[0]) * f,
                a.color[1] + (b.color[1] - a.color[1]) * f,
                a.color[2] + (b.color[2] - a.color[2]) * f
            );
        }
    }
    const last = GRADIENT[GRADIENT.length - 1].color;
    return Cesium.Color.fromBytes(...last);
}

export class HeatmapLayer extends BaseLayer {

    /**
     * @param {WorldViewer} worldViewer
     * @param {LayerManager} layerManager  liefert die Positionen von
     *        Aircraft/Ships – der Heatmap-Layer erzeugt selbst keine.
     */
    constructor(worldViewer, layerManager) {
        super(worldViewer, {
            id: "heatmap",
            name: "Pattern-of-Life-Heatmap",
            icon: "🔥",
            type: "heatmap",
            dataUrl: null
        });

        this.layerManager = layerManager;

        this._samples = [];      // { lat, lon, t }
        this._activeCells = 0;
        this._lastSampleAt = 0;
        this._lastRebuildAt = 0;

        // Analyse-Overlay, das die Karte stark einfärbt – bewusst
        // standardmäßig aus, im Gegensatz zu den Daten-Layern selbst.
        this.hide();
    }

    /** Keine eigenen Daten zu laden – reine Weiterverarbeitung anderer Layer. */
    async load() {}

    /** Zahl der aktuell dargestellten Hotspot-Zellen (statt Objektanzahl). */
    get count() { return this._activeCells; }

    get _windowMs() { return (CFG().windowMinutes ?? 30) * 60_000; }
    get _sampleIntervalMs() { return (CFG().sampleIntervalSeconds ?? 15) * 1000; }
    get _rebuildIntervalMs() { return (CFG().rebuildSeconds ?? 5) * 1000; }
    get _gridCells() { return CFG().gridCells ?? 24; }

    update() {
        const now = Date.now();

        if (now - this._lastSampleAt >= this._sampleIntervalMs) {
            this._lastSampleAt = now;
            this._collectSamples(now);
        }

        // Fenster laufend rollieren, auch während ausgeblendet – so zeigt
        // sich beim Einschalten sofort ein aussagekräftiges Bild.
        const cutoff = now - this._windowMs;
        if (this._samples.length && this._samples[0].t < cutoff) {
            this._samples = this._samples.filter(s => s.t >= cutoff);
        }

        if (!this.enabled) return;
        if (now - this._lastRebuildAt >= this._rebuildIntervalMs) {
            this._lastRebuildAt = now;
            this._rebuild(now);
        }
    }

    /** Aktuelle Positionen der Quell-Layer als Stichprobe übernehmen. */
    _collectSamples(now) {
        for (const id of SOURCE_LAYER_IDS) {
            const layer = this.layerManager?.get(id);
            if (!layer?.enabled) continue;
            for (const obj of layer.objects) {
                this._samples.push({
                    lat: obj.position.latitude,
                    lon: obj.position.longitude,
                    t: now
                });
            }
        }
        if (this._samples.length > MAX_SAMPLES) {
            this._samples.splice(0, this._samples.length - MAX_SAMPLES);
        }
    }

    /** Gitter aus den aktuellen Stichproben aufbauen und als Rechtecke zeichnen. */
    _rebuild(now) {
        this.dataSource.entities.removeAll();
        this._activeCells = 0;
        if (this._samples.length < 3) return;

        let west = 180, east = -180, south = 90, north = -90;
        for (const s of this._samples) {
            if (s.lon < west) west = s.lon;
            if (s.lon > east) east = s.lon;
            if (s.lat < south) south = s.lat;
            if (s.lat > north) north = s.lat;
        }
        // Mindestgröße, falls (fast) alle Punkte an derselben Stelle liegen
        if (east - west < 1) { west -= 0.5; east += 0.5; }
        if (north - south < 1) { south -= 0.5; north += 0.5; }
        // etwas Rand, damit Randpunkte nicht exakt auf der Gitterkante liegen
        const padLon = (east - west) * 0.05, padLat = (north - south) * 0.05;
        west -= padLon; east += padLon; south -= padLat; north += padLat;

        const cols = this._gridCells, rows = this._gridCells;
        const cellW = (east - west) / cols, cellH = (north - south) / rows;
        const windowMs = this._windowMs;

        const grid = new Map(); // "row-col" → Gewicht
        for (const s of this._samples) {
            const c = Math.min(cols - 1, Math.floor((s.lon - west) / cellW));
            const r = Math.min(rows - 1, Math.floor((s.lat - south) / cellH));
            const age = now - s.t;
            const weight = Math.max(0, 1 - age / windowMs); // frischer = schwerer
            const key = `${r}-${c}`;
            grid.set(key, (grid.get(key) ?? 0) + weight);
        }

        let max = 0;
        for (const w of grid.values()) if (w > max) max = w;
        if (max <= 0) return;

        for (const [key, weight] of grid) {
            const [r, c] = key.split("-").map(Number);
            const intensity = weight / max;
            const cellSouth = south + r * cellH, cellNorth = cellSouth + cellH;
            const cellWest = west + c * cellW, cellEast = cellWest + cellW;

            this.dataSource.entities.add({
                id: `heat-${key}`,
                rectangle: {
                    coordinates: Cesium.Rectangle.fromDegrees(
                        cellWest, cellSouth, cellEast, cellNorth
                    ),
                    material: heatColor(intensity).withAlpha(0.15 + intensity * 0.55),
                    height: 0,
                    outline: false
                }
            });
            this._activeCells++;
        }
    }

    show() {
        super.show();
        this._lastRebuildAt = 0; // beim Einschalten sofort neu aufbauen
    }

    hide() {
        super.hide();
        this.dataSource.entities.removeAll();
        this._activeCells = 0;
    }

    clear() {
        this._samples = [];
        this._activeCells = 0;
        super.clear();
    }
}
