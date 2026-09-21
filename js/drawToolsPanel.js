/**
 * drawToolsPanel.js – Sidebar-UI für Zeichnen & Messen.
 *
 * Bedienung: Werkzeug wählen → Freihand (Maustaste gedrückt halten und
 * ziehen), Punkt (anklicken), Grenze/Distanz (Eckpunkte anklicken, mit
 * rechtem Mausklick oder "Fertig" abschließen). Esc bricht das laufende
 * Werkzeug ab. Fertige Geometrien erscheinen in der Liste (anklickbar →
 * fliegt hin) und lassen sich als GeoJSON-Datei exportieren.
 */

import { TYPE_LABELS, formatDistanceKm, formatAreaKm2 } from "./drawTools.js";
import { downloadTextFile } from "./dossier.js";

const TYPE_ICONS = { point: "📍", line: "✏️", polygon: "⬠", measure: "📏" };

const HINTS = {
    line: "Maustaste gedrückt halten und über die Karte ziehen. Esc beendet.",
    polygon: "Eckpunkte anklicken, mit rechtem Mausklick oder „Fertig“ schließen.",
    point: "Auf die Karte klicken, um einen Punkt zu markieren. Esc beendet.",
    measure: "Punkte anklicken, mit rechtem Mausklick oder „Fertig“ abschließen."
};

export class DrawToolsPanel {

    /**
     * @param {DrawTools} drawTools
     * @param {UI} ui
     */
    constructor(drawTools, ui) {
        this.drawTools = drawTools;
        this.ui = ui;

        this._el = {
            list: document.getElementById("draw-features"),
            hint: document.getElementById("draw-hint"),
            finishBtn: document.getElementById("draw-finish"),
            clearBtn: document.getElementById("draw-clear"),
            exportBtn: document.getElementById("draw-export")
        };

        this._modeButtons = {
            line: document.getElementById("draw-freehand"),
            polygon: document.getElementById("draw-polygon"),
            point: document.getElementById("draw-point"),
            measure: document.getElementById("draw-measure")
        };

        drawTools.onFeaturesChanged = () => this._renderList();
        drawTools.onModeChanged = (mode) => this._reflectMode(mode);

        this._bind();
        this._renderList();
        this._reflectMode(null);
    }

    _bind() {
        for (const [mode, btn] of Object.entries(this._modeButtons)) {
            btn.addEventListener("click", () => {
                if (this.drawTools.activeMode === mode) {
                    this.drawTools.cancelTool();
                } else {
                    this.drawTools.startTool(mode);
                }
            });
        }

        this._el.finishBtn.addEventListener("click", () => this.drawTools.finishDraft());

        this._el.clearBtn.addEventListener("click", () => {
            if (this.drawTools.features.length === 0) return;
            if (!window.confirm("Alle Zeichnungen und Messungen löschen?")) return;
            this.drawTools.clearAll();
        });

        this._el.exportBtn.addEventListener("click", () => {
            if (this.drawTools.features.length === 0) return;
            const stamp = new Date().toISOString().slice(0, 10);
            downloadTextFile(`zeichnungen-${stamp}.geojson`, JSON.stringify(this.drawTools.toGeoJSON(), null, 2));
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.drawTools.activeMode) {
                e.preventDefault();
                this.drawTools.cancelTool();
            }
        });
    }

    _reflectMode(mode) {
        for (const [key, btn] of Object.entries(this._modeButtons)) {
            btn.classList.toggle("active", key === mode);
        }

        const needsFinish = mode === "polygon" || mode === "measure";
        this._el.finishBtn.classList.toggle("hidden", !needsFinish);

        this._el.hint.textContent = mode ? HINTS[mode] : "";
        this._el.hint.classList.toggle("hidden", !mode);
    }

    _renderList() {
        this._el.list.innerHTML = "";
        for (const feature of this.drawTools.features) {
            const row = document.createElement("div");
            row.className = "draw-feature-row";
            row.innerHTML = `
                <span class="df-icon">${TYPE_ICONS[feature.type]}</span>
                <span class="df-name" title="${feature.name}">${feature.name}</span>
                <span class="df-meta">${this._metaText(feature)}</span>
                <button class="df-remove" title="Entfernen">✕</button>`;
            row.querySelector(".df-name").addEventListener("click", () => {
                this.drawTools.flyToFeature(feature.id);
            });
            row.querySelector(".df-remove").addEventListener("click", (e) => {
                e.stopPropagation();
                this.drawTools.removeFeature(feature.id);
            });
            this._el.list.appendChild(row);
        }

        if (this.drawTools.features.length === 0) {
            this._el.list.innerHTML = `<p class="watchlist-empty">Noch keine Zeichnungen.</p>`;
        }
    }

    _metaText(feature) {
        if (feature.type === "polygon") return formatAreaKm2(feature.areaKm2);
        if (feature.type === "measure" || feature.type === "line") return formatDistanceKm(feature.distanceKm);
        return TYPE_LABELS[feature.type] ?? "";
    }
}
