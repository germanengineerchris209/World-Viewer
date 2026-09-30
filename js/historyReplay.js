/**
 * historyReplay.js – Zeitleisten-Replay für historische Ereignisse.
 *
 * Kernidee (wie bei Palantir Gotham): eine synchronisierte Karte + Zeitachse.
 * Statt alle Erdbeben/Brände/Raketenstarts der letzten Tage gleichzeitig zu
 * zeigen, blendet dieses Modul sie nacheinander nach ihrem echten Zeitpunkt
 * ein – mit Play/Pause/Scrub und einstellbarer Abspielgeschwindigkeit.
 *
 * Datenquellen – ausschließlich bereits im Projekt genutzte, kostenlose
 * Feeds, kein neuer Schlüssel nötig:
 *   - USGS-Erdbebenfeed, 7-/30-Tage-Varianten (CORS, direkt im Browser)
 *   - NASA FIRMS über /api/fires/history (Key liegt bereits serverseitig)
 *   - Launch Library 2 "previous" über /api/launches/history
 *
 * Läuft unabhängig von der Simulations-Timeline (timeline.js) – die steuert
 * den Zeitraffer für Schiffe/Satelliten/Demo-Flugzeuge, hier geht es um
 * echte historische Ereignisse mit echten Zeitstempeln.
 */

const USGS_WEEK = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson";
const USGS_MONTH = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson";

const ROCKET_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 34 34">
  <path d="M17 3 C21 8 22 15 22 21 L12 21 C12 15 13 8 17 3 Z"
        fill="#c084fc" stroke="#0b0e14" stroke-width="1.2"/>
  <path d="M12 18 L7 25 L12 24 Z M22 18 L27 25 L22 24 Z"
        fill="#c084fc" stroke="#0b0e14" stroke-width="1"/>
  <circle cx="17" cy="12" r="2.6" fill="#0b0e14"/>
</svg>`;

function svgDataUri(svg) {
    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}

const CFG = () => window.WORLD_VIEWER_CONFIG?.history ?? {};

export class HistoryReplay {

    /**
     * @param {WorldViewer} worldViewer
     * @param {LayerManager} layerManager
     * @param {UI} ui
     */
    constructor(worldViewer, layerManager, ui) {
        this.worldViewer = worldViewer;
        this.viewer = worldViewer.viewer;
        this.layerManager = layerManager;
        this.ui = ui;

        this.active = false;
        this.playing = false;
        this.speed = 3600;      // Ereignis-Sekunden pro Realsekunde
        this.rangeDays = CFG().defaultRangeDays ?? 7;
        this.startMs = 0;
        this.endMs = 0;
        this.cursorMs = 0;

        this.events = [];               // { id, type, timeMs, lat, lon, meta }
        this._shownIds = new Set();
        this._hiddenLiveLayers = [];
        this._rocketIcon = svgDataUri(ROCKET_SVG);

        this.dataSource = new Cesium.CustomDataSource("history-replay");
        this.dataSource.show = false;
        this.viewer.dataSources.add(this.dataSource);

        this._el = {
            toggle: document.getElementById("history-toggle"),
            options: document.getElementById("history-options"),
            range: document.getElementById("history-range"),
            eq: document.getElementById("history-eq"),
            fire: document.getElementById("history-fire"),
            launch: document.getElementById("history-launch"),
            status: document.getElementById("history-status"),
            bar: document.getElementById("history-bar"),
            simBar: document.getElementById("timeline-bar"),
            play: document.getElementById("hp-play"),
            pause: document.getElementById("hp-pause"),
            restart: document.getElementById("hp-restart"),
            close: document.getElementById("history-close"),
            scrub: document.getElementById("history-scrub"),
            speed: document.getElementById("hp-speed"),
            clock: document.getElementById("history-clock")
        };

        this._bind();
    }

    _bind() {
        this._el.toggle.addEventListener("click", () => this.toggle());
        this._el.close.addEventListener("click", () => this.deactivate());
        this._el.play.addEventListener("click", () => this.play());
        this._el.pause.addEventListener("click", () => this.pause());
        this._el.restart.addEventListener("click", () => this.seek(0));
        this._el.scrub.addEventListener("input", (e) => this.seek(Number(e.target.value)));
        this._el.speed.addEventListener("change", (e) => { this.speed = Number(e.target.value); });
        this._el.range.addEventListener("change", () => { if (this.active) this._reload(); });
        for (const key of ["eq", "fire", "launch"]) {
            this._el[key].addEventListener("change", () => this._applyCursor());
        }
    }

    async toggle() {
        if (this.active) this.deactivate();
        else await this.activate();
    }

    async activate() {
        this.active = true;
        this.playing = false;
        this._el.toggle.classList.add("active");
        this._el.toggle.textContent = "🕰️ Replay läuft …";
        this._el.options.classList.remove("hidden");
        this._el.bar.classList.remove("hidden");
        this._el.simBar?.classList.add("hidden");

        // Live-Ebenen der gleichen Typen ausblenden, sonst zeigt die Karte
        // Live- und historische Ereignisse gleichzeitig – verwirrend.
        this._hiddenLiveLayers = [];
        for (const id of ["earthquakes", "fires", "launches"]) {
            const layer = this.layerManager.get(id);
            if (layer?.enabled) {
                layer.hide();
                this._hiddenLiveLayers.push(id);
            }
        }
        this.ui.buildLayerToggles();

        this.dataSource.show = true;
        await this._reload();
    }

    deactivate() {
        this.active = false;
        this.playing = false;
        this._el.toggle.classList.remove("active");
        this._el.toggle.textContent = "🕰️ Replay starten";
        this._el.options.classList.add("hidden");
        this._el.bar.classList.add("hidden");
        this._el.simBar?.classList.remove("hidden");

        this.dataSource.entities.removeAll();
        this.dataSource.show = false;
        this._shownIds.clear();

        for (const id of this._hiddenLiveLayers) this.layerManager.get(id)?.show();
        this._hiddenLiveLayers = [];
        this.ui.buildLayerToggles();
    }

    async _reload() {
        this.rangeDays = Number(this._el.range.value) || 7;
        this._el.status.textContent = "Lade historische Ereignisse …";

        this.endMs = Date.now();
        this.startMs = this.endMs - this.rangeDays * 86_400_000;

        const [quakes, fires, launches] = await Promise.allSettled([
            this._loadEarthquakes(),
            this._loadFires(),
            this._loadLaunches()
        ]);

        this.dataSource.entities.removeAll();
        this._shownIds.clear();

        const counts = { eq: 0, fire: 0, launch: 0 };
        this.events = [];
        if (quakes.status === "fulfilled") { this.events.push(...quakes.value); counts.eq = quakes.value.length; }
        else console.warn("[Replay] Erdbeben:", quakes.reason?.message);
        if (fires.status === "fulfilled") { this.events.push(...fires.value); counts.fire = fires.value.length; }
        else console.info("[Replay] Brände nicht verfügbar:", fires.reason?.message);
        if (launches.status === "fulfilled") { this.events.push(...launches.value); counts.launch = launches.value.length; }
        else console.info("[Replay] Starts nicht verfügbar:", launches.reason?.message);
        this.events.sort((a, b) => a.timeMs - b.timeMs);

        const failed = [quakes, fires, launches].filter(r => r.status === "rejected").length;
        this._el.status.textContent = `🌋 ${counts.eq} · 🔥 ${counts.fire} · 🚀 ${counts.launch}`
            + (failed ? ` – ${failed} Quelle(n) nicht erreichbar` : "");

        this._el.scrub.min = "0";
        this._el.scrub.max = String(Math.max(1, this.endMs - this.startMs));
        this.seek(0);
    }

    async _loadEarthquakes() {
        const url = this.rangeDays <= 7 ? USGS_WEEK : USGS_MONTH;
        const minMagnitude = window.WORLD_VIEWER_CONFIG?.earthquakes?.minMagnitude ?? 2.5;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`USGS antwortete mit ${res.status}`);
        const geojson = await res.json();

        const out = [];
        for (const f of geojson.features ?? []) {
            const magnitude = Number(f.properties?.mag);
            if (!Number.isFinite(magnitude) || magnitude < minMagnitude) continue;

            const [lon, lat, depthKm] = f.geometry?.coordinates ?? [];
            const timeMs = Number(f.properties?.time);
            if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(timeMs)) continue;
            if (timeMs < this.startMs || timeMs > this.endMs) continue;

            out.push({
                id: `hist-eq-${f.id}`,
                type: "earthquake",
                timeMs, lat, lon,
                meta: {
                    magnitude,
                    depthKm: Number(depthKm) || 0,
                    place: f.properties?.place ?? "",
                    label: `M ${magnitude.toFixed(1)}`
                }
            });
        }
        return out;
    }

    async _loadFires() {
        const cfg = CFG().fires ?? {};
        const apiUrl = cfg.apiUrl ?? "/api/fires/history";
        const days = Math.min(this.rangeDays, 10);

        const res = await fetch(`${apiUrl}?days=${days}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

        const limit = cfg.maxFires ?? 4000;
        const fires = (data.fires ?? [])
            .filter(f => f.acquiredAt >= this.startMs && f.acquiredAt <= this.endMs)
            .sort((a, b) => (b.frp ?? 0) - (a.frp ?? 0))
            .slice(0, limit);

        return fires.map((f, i) => ({
            id: `hist-fire-${i}-${f.latitude.toFixed(3)}-${f.longitude.toFixed(3)}-${f.acquiredAt}`,
            type: "fire",
            timeMs: f.acquiredAt, lat: f.latitude, lon: f.longitude,
            meta: { frp: f.frp ?? 0, confidence: f.confidence ?? 0.5 }
        }));
    }

    async _loadLaunches() {
        const cfg = CFG().launches ?? {};
        const apiUrl = cfg.apiUrl ?? "/api/launches/history";

        const res = await fetch(`${apiUrl}?days=${this.rangeDays}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

        const out = [];
        for (const l of data.launches ?? []) {
            const timeMs = Date.parse(l.net);
            const lat = Number(l.latitude), lon = Number(l.longitude);
            if (!Number.isFinite(timeMs) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
            if (timeMs < this.startMs || timeMs > this.endMs) continue;

            out.push({
                id: `hist-launch-${l.id}`,
                type: "launch",
                timeMs, lat, lon,
                meta: { name: l.name ?? "Start", provider: l.provider ?? "", status: l.status ?? "" }
            });
        }
        return out;
    }

    /* ─────────── Wiedergabe ─────────── */

    play() {
        if (!this.active || this.events.length === 0) return;
        if (this.cursorMs >= this.endMs) this.seek(0);
        this.playing = true;
        this._updateButtons();
    }

    pause() { this.playing = false; this._updateButtons(); }

    seek(offsetMs) {
        const span = Math.max(1, this.endMs - this.startMs);
        this.cursorMs = this.startMs + Math.max(0, Math.min(offsetMs, span));
        this._el.scrub.value = String(this.cursorMs - this.startMs);
        this._updateClock();
        this._applyCursor();
    }

    /** Von app.js einmal pro Frame aufgerufen, solange aktiv. */
    tick(realDeltaSeconds) {
        if (!this.active || !this.playing) return;

        const next = this.cursorMs + realDeltaSeconds * this.speed * 1000;
        if (next >= this.endMs) {
            this.cursorMs = this.endMs;
            this.playing = false;
            this._updateButtons();
        } else {
            this.cursorMs = next;
        }
        this._el.scrub.value = String(this.cursorMs - this.startMs);
        this._updateClock();
        this._applyCursor();
    }

    _updateClock() {
        this._el.clock.textContent = new Date(this.cursorMs).toLocaleString("de-DE", {
            day: "2-digit", month: "2-digit", year: "numeric",
            hour: "2-digit", minute: "2-digit"
        });
    }

    _updateButtons() {
        this._el.play.classList.toggle("active", this.playing);
        this._el.pause.classList.toggle("active", !this.playing);
    }

    /** Zeigt/entfernt Entities je nachdem, ob ihr Zeitpunkt schon erreicht ist. */
    _applyCursor() {
        const showEq = this._el.eq.checked;
        const showFire = this._el.fire.checked;
        const showLaunch = this._el.launch.checked;

        for (const ev of this.events) {
            const typeVisible = (ev.type === "earthquake" && showEq)
                || (ev.type === "fire" && showFire)
                || (ev.type === "launch" && showLaunch);
            const shouldShow = typeVisible && ev.timeMs <= this.cursorMs;
            const already = this._shownIds.has(ev.id);

            if (shouldShow && !already) {
                this._createEntity(ev);
                this._shownIds.add(ev.id);
            } else if (!shouldShow && already) {
                this.dataSource.entities.removeById(ev.id);
                this._shownIds.delete(ev.id);
            }
        }
    }

    _createEntity(ev) {
        const position = Cesium.Cartesian3.fromDegrees(ev.lon, ev.lat, 0);

        if (ev.type === "earthquake") {
            const { magnitude, depthKm } = ev.meta;
            const color = depthKm < 70 ? "#f87171" : depthKm < 300 ? "#fb923c" : "#fbbf24";
            const radius = Math.pow(2, magnitude) * 1000;
            this.dataSource.entities.add({
                id: ev.id,
                position,
                ellipse: {
                    semiMinorAxis: radius,
                    semiMajorAxis: radius,
                    material: Cesium.Color.fromCssColorString(color).withAlpha(0.35),
                    outline: true,
                    outlineColor: Cesium.Color.fromCssColorString(color).withAlpha(0.9),
                    outlineWidth: 2,
                    classificationType: Cesium.ClassificationType.TERRAIN
                }
            });
            return;
        }

        if (ev.type === "fire") {
            const { frp = 0, confidence = 0.5 } = ev.meta;
            const heat = Math.min(1, Math.sqrt(Math.max(0, frp) / 150) * 0.85 + confidence * 0.15);
            const color = heat > 0.72 ? "#ff3b30" : heat > 0.42 ? "#ff8c00" : "#ffd400";
            this.dataSource.entities.add({
                id: ev.id,
                position,
                point: {
                    pixelSize: 7,
                    color: Cesium.Color.fromCssColorString(color).withAlpha(0.85),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
            });
            return;
        }

        // launch
        this.dataSource.entities.add({
            id: ev.id,
            position,
            billboard: {
                image: this._rocketIcon,
                width: 22, height: 22,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                text: ev.meta.name,
                font: "10px 'SF Mono', Consolas, monospace",
                fillColor: Cesium.Color.fromCssColorString("#c084fc"),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, 16),
                verticalOrigin: Cesium.VerticalOrigin.TOP,
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 5e6, 0.0)
            }
        });
    }
}
