/**
 * sceneDirectorPanel.js – Sidebar-UI für den Szenen-Regisseur (WEB-92).
 *
 * Konzept aus "God's Eye View" (Bilawal Sidhu, MIT-Lizenz) übernommen:
 * Kamerapositionen als Stationen einer Fahrt aufnehmen, Reihenfolge und
 * Haltedauer bearbeiten, dann weich abspielen. "Speichern/Laden" nutzt
 * denselben URL-Mechanismus wie der normale Share-Link (shareLink.js)
 * statt eines eigenen Dateiformats. Esc bricht eine laufende Fahrt ab
 * (eigener Listener, nach demselben Muster wie drawToolsPanel.js).
 */

import { buildSceneShareUrl, readSceneFromUrl } from "./shareLink.js";

export class SceneDirectorPanel {

    /**
     * @param {import("./sceneDirector.js").SceneDirector} sceneDirector
     * @param {import("./routeTool.js").RouteTool} routeTool
     */
    constructor(sceneDirector, routeTool) {
        this.sceneDirector = sceneDirector;
        this.routeTool = routeTool;

        this._el = {
            list: document.getElementById("scene-list"),
            addBtn: document.getElementById("scene-add"),
            playBtn: document.getElementById("scene-play"),
            clearBtn: document.getElementById("scene-clear"),
            saveBtn: document.getElementById("scene-save"),
            loadInput: document.getElementById("scene-load-input"),
            loadBtn: document.getElementById("scene-load"),
            hint: document.getElementById("scene-hint"),
            routeFlyBtn: document.getElementById("scene-route-fly")
        };

        sceneDirector.onChange = () => this._renderList();
        sceneDirector.onPlaybackChange = (playing) => this._reflectPlayback(playing);

        // routeTool.onChange gehört bereits DrawToolsPanel (Routenergebnis-Anzeige) –
        // hier zusätzlich einhängen statt überschreiben, damit beide weiterlaufen.
        const previousRouteChange = routeTool.onChange;
        routeTool.onChange = (state) => {
            previousRouteChange?.(state);
            this._reflectRoute(state);
        };

        this._bind();
        this._renderList();
        this._reflectPlayback(false);
        this._reflectRoute(routeTool.getState());
    }

    _bind() {
        this._el.addBtn.addEventListener("click", () => {
            if (this.sceneDirector.playing) return;
            this.sceneDirector.addStation();
        });

        this._el.playBtn.addEventListener("click", () => {
            if (this.sceneDirector.playing) {
                this.sceneDirector.stop();
            } else {
                this.sceneDirector.play();
            }
        });

        this._el.clearBtn.addEventListener("click", () => {
            if (this.sceneDirector.stations.length === 0) return;
            if (!window.confirm("Alle Stationen der Fahrt löschen?")) return;
            this.sceneDirector.clear();
        });

        this._el.saveBtn.addEventListener("click", async (e) => {
            if (this.sceneDirector.stations.length === 0) return;
            const url = buildSceneShareUrl(this.sceneDirector.stations);
            const btn = e.currentTarget;
            const original = btn.textContent;
            try {
                await navigator.clipboard.writeText(url);
                btn.textContent = "✅ Kopiert";
            } catch {
                window.prompt("Link kopieren:", url);
            }
            setTimeout(() => { btn.textContent = original; }, 1800);
        });

        this._el.loadBtn.addEventListener("click", () => {
            const raw = this._el.loadInput.value.trim();
            if (!raw) return;
            const stations = readSceneFromUrl(raw);
            if (!stations) {
                this._el.hint.textContent = "⚠️ Kein gültiger Fahrt-Link erkannt.";
                this._el.hint.classList.remove("hidden");
                return;
            }
            this.sceneDirector.setStations(stations);
            this._el.loadInput.value = "";
            this._el.hint.classList.add("hidden");
        });

        this._el.routeFlyBtn.addEventListener("click", () => {
            if (this.sceneDirector.playing) {
                this.sceneDirector.stop();
                return;
            }
            if (!this.routeTool.routeCoordinates) return;
            this.sceneDirector.playRoute(this.routeTool.routeCoordinates);
        });

        // Beim Start evtl. per Link mitgegebene Fahrt übernehmen (wie applyShareLinkFromUrl).
        const initialStations = readSceneFromUrl();
        if (initialStations) this.sceneDirector.setStations(initialStations);

        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape") return;
            if (this.sceneDirector.playing) {
                e.preventDefault();
                this.sceneDirector.stop();
            }
        });
    }

    _renderList() {
        const stations = this.sceneDirector.stations;
        this._el.list.innerHTML = "";

        stations.forEach((station, index) => {
            const row = document.createElement("div");
            row.className = "scene-station-row";
            row.innerHTML = `
                <span class="scene-station-index">${index + 1}</span>
                <span class="scene-station-name" title="Zur Vorschau hinfliegen">
                    📍 ${station.latitude.toFixed(2)}°, ${station.longitude.toFixed(2)}°
                </span>
                <input type="number" class="scene-hold-input" min="0" step="0.5"
                       value="${station.holdSeconds}" title="Haltedauer in Sekunden">
                <button class="scene-move-up" title="Nach oben">▲</button>
                <button class="scene-move-down" title="Nach unten">▼</button>
                <button class="scene-remove" title="Entfernen">✕</button>`;

            row.querySelector(".scene-station-name").addEventListener("click", () => {
                this.sceneDirector.previewStation(station.id);
            });
            row.querySelector(".scene-hold-input").addEventListener("change", (e) => {
                this.sceneDirector.setHoldSeconds(station.id, e.target.value);
            });
            row.querySelector(".scene-move-up").addEventListener("click", () => {
                this.sceneDirector.moveStation(station.id, -1);
            });
            row.querySelector(".scene-move-down").addEventListener("click", () => {
                this.sceneDirector.moveStation(station.id, 1);
            });
            row.querySelector(".scene-remove").addEventListener("click", () => {
                this.sceneDirector.removeStation(station.id);
            });

            this._el.list.appendChild(row);
        });

        if (stations.length === 0) {
            this._el.list.innerHTML = `<p class="watchlist-empty">Noch keine Stationen aufgenommen.</p>`;
        }

        this._el.saveBtn.disabled = stations.length === 0;
        this._el.clearBtn.disabled = stations.length === 0;
        this._refreshPlaybackButtons();
    }

    _reflectPlayback() {
        this._refreshPlaybackButtons();
    }

    _reflectRoute() {
        this._refreshPlaybackButtons();
    }

    /** Play-/Stop-Zustand beider Buttons (Fahrt + Routen-Flythrough) zusammen aktualisieren. */
    _refreshPlaybackButtons() {
        const playing = this.sceneDirector.playing;
        const hasRoute = !!this.routeTool.routeCoordinates;

        this._el.playBtn.textContent = playing ? "■ Stop (Esc)" : "▶ Fahrt abspielen";
        this._el.playBtn.classList.toggle("active", playing);
        this._el.playBtn.disabled = !playing && this.sceneDirector.stations.length < 2;
        this._el.addBtn.disabled = playing;

        this._el.routeFlyBtn.textContent = playing ? "■ Stop (Esc)" : "🛣️ Route abfliegen";
        this._el.routeFlyBtn.classList.toggle("active", playing);
        this._el.routeFlyBtn.disabled = !playing && !hasRoute;
    }
}
