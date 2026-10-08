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
import { PROFILE_LABELS, formatDuration } from "./routeTool.js";

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
     * @param {RouteTool} routeTool
     * @param {UI} ui
     */
    constructor(drawTools, routeTool, ui) {
        this.drawTools = drawTools;
        this.routeTool = routeTool;
        this.ui = ui;

        this._el = {
            list: document.getElementById("draw-features"),
            hint: document.getElementById("draw-hint"),
            finishBtn: document.getElementById("draw-finish"),
            clearBtn: document.getElementById("draw-clear"),
            exportBtn: document.getElementById("draw-export"),
            routeProfile: document.getElementById("route-profile"),
            routeStartBtn: document.getElementById("route-start"),
            routeClearBtn: document.getElementById("route-clear"),
            routeHint: document.getElementById("route-hint"),
            routeResult: document.getElementById("route-result")
        };

        this._modeButtons = {
            line: document.getElementById("draw-freehand"),
            polygon: document.getElementById("draw-polygon"),
            point: document.getElementById("draw-point"),
            measure: document.getElementById("draw-measure")
        };

        drawTools.onFeaturesChanged = () => this._renderList();
        drawTools.onModeChanged = (mode) => this._reflectMode(mode);
        routeTool.onChange = (state) => this._renderRoute(state);

        this._bind();
        this._renderList();
        this._reflectMode(null);
        this._renderRoute(routeTool.getState());
    }

    _bind() {
        for (const [mode, btn] of Object.entries(this._modeButtons)) {
            btn.addEventListener("click", () => {
                if (this.drawTools.activeMode === mode) {
                    this.drawTools.cancelTool();
                } else {
                    this.routeTool.cancelPicking();
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

        this._el.routeStartBtn.addEventListener("click", () => {
            if (this.routeTool.picking) {
                this.routeTool.cancelPicking();
            } else {
                this.drawTools.cancelTool();
                this.routeTool.startPicking();
            }
        });

        this._el.routeClearBtn.addEventListener("click", () => this.routeTool.clear());

        this._el.routeProfile.addEventListener("change", () => {
            this.routeTool.setProfile(this._el.routeProfile.value);
        });

        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (this.drawTools.activeMode) {
                e.preventDefault();
                this.drawTools.cancelTool();
            }
            if (this.routeTool.picking) {
                e.preventDefault();
                this.routeTool.cancelPicking();
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

    _renderRoute(state) {
        this._el.routeStartBtn.classList.toggle("active", !!state.picking);
        this._el.routeStartBtn.textContent =
            state.picking === "start" ? "🧭 Startpunkt anklicken…" :
            state.picking === "end" ? "🧭 Zielpunkt anklicken…" :
            "🧭 Route planen";

        this._el.routeHint.classList.toggle("hidden", !state.picking);
        if (state.picking === "start") this._el.routeHint.textContent = "Startpunkt auf dem Globus anklicken.";
        if (state.picking === "end") this._el.routeHint.textContent = "Zielpunkt auf dem Globus anklicken. Esc bricht ab.";

        this._el.routeProfile.value = state.profile;

        const resultEl = this._el.routeResult;
        if (state.status === "idle") {
            resultEl.className = "route-result hidden";
            resultEl.textContent = "";
        } else if (state.status === "loading") {
            resultEl.className = "route-result route-loading";
            resultEl.textContent = "⏳ Route wird beim OSRM-Demo-Server abgefragt …";
        } else if (state.status === "error") {
            resultEl.className = "route-result route-error";
            resultEl.textContent = `⚠️ ${state.errorMessage}`;
        } else if (state.status === "ok") {
            resultEl.className = "route-result route-ok";
            const profileLabel = PROFILE_LABELS[state.profile] ?? state.profile;
            resultEl.textContent =
                `${profileLabel}: ${formatDistanceKm(state.distanceKm)} · ${formatDuration(state.durationSec)}`;
        }
    }

    _metaText(feature) {
        if (feature.type === "polygon") return formatAreaKm2(feature.areaKm2);
        if (feature.type === "measure" || feature.type === "line") return formatDistanceKm(feature.distanceKm);
        return TYPE_LABELS[feature.type] ?? "";
    }
}
