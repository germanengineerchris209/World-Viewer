/**
 * deepSpace.js – "Wo ist Voyager gerade?" – Tracker für aktive Raumsonden.
 *
 * Datenquelle: NASA JPL Horizons über den eigenen Server (/api/deepspace),
 * weil Horizons keine CORS-Header sendet und seine Ephemeriden als
 * Klartextblock ausliefert – das Parsen passiert in server/deepSpace.mjs.
 *
 * Warum kein Layer auf dem Globus?
 * Voyager 1 steht rund 172 AE entfernt, also etwa 25,8 Mrd. km. Maßstäblich
 * auf dem Erdglobus wäre das sinnlos: zwischen der Erdoberfläche und einem
 * Punkt in 172 AE liegen zwölf Größenordnungen. Der Asteroiden-Layer
 * (WEB-75) staucht Entfernungen noch logarithmisch in Globushöhen, weil
 * NEOs in Mondentfernungen bleiben – bei interstellaren Distanzen trägt
 * dieser Trick nicht mehr. Dieses Modul zeigt die Missionen deshalb als
 * eigene kompakte Ansicht: harte Kennzahlen (Entfernung zu Sonne und Erde,
 * Signallaufzeit, Tempo) plus eine schematische Draufsicht auf die
 * Ekliptik, in der nur die Richtung echt ist und der Radius bewusst
 * logarithmisch gestaucht – so bleibt die Anordnung lesbar, ohne
 * Maßstabstreue zu behaupten.
 */

const CFG = () => window.WORLD_VIEWER_CONFIG?.deepSpace ?? {};

const API_URL = () => CFG().apiUrl ?? "/api/deepspace";

/** Positionen ändern sich langsam; der Server cacht 6 h und wählt je
 *  Abruf den passenden Stützpunkt – halbstündlich nachladen genügt. */
const DEFAULT_REFRESH_SECONDS = 1800;

/* ═══════════ Schematische Draufsicht ═══════════ */

const VIEW = 240;                  // SVG-Kantenlänge (quadratisch)
const CENTER = VIEW / 2;
const R_INNER = 15;                // Radius der Sonnenscheibe
const R_OUTER = CENTER - 14;       // äußerster nutzbarer Radius
const SCALE_MAX_AU = 180;          // oberes Ende der Radialskala

/**
 * Referenzkreise zur Einordnung – echte mittlere Bahnradien.
 * Die Heliopause ist der von Voyager 1/2 gemessene Übergang zum
 * interstellaren Medium (etwa 120 AE).
 */
const REFERENCE_ORBITS = [
    { au: 1, label: "Erde" },
    { au: 5.2, label: "Jupiter" },
    { au: 30.1, label: "Neptun" },
    { au: 123, label: "Heliopause" }
];

/**
 * Logarithmisch gestauchter Radius: nur zur relativen Einordnung,
 * NICHT maßstabsgetreu (siehe Modulkopf).
 */
function scaledRadius(au) {
    const t = Math.log10(1 + Math.max(0, au)) / Math.log10(1 + SCALE_MAX_AU);
    return R_INNER + (R_OUTER - R_INNER) * Math.min(1, t);
}

/**
 * Ekliptikale Länge + gestauchter Radius → SVG-Koordinate.
 * Die Y-Achse wird gespiegelt, damit die Draufsicht wie üblich
 * nordwärts der Ekliptik orientiert ist (Gegenuhrzeigersinn).
 */
function plot(longitudeDeg, au) {
    const rad = longitudeDeg * Math.PI / 180;
    const r = scaledRadius(au);
    return {
        x: CENTER + r * Math.cos(rad),
        y: CENTER - r * Math.sin(rad)
    };
}

/* ═══════════ Zahlenformate (deutsch) ═══════════ */

const nf = (digits) => new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
});

/** Große Kilometerzahlen in Mio./Mrd. km, damit die Spalte schmal bleibt. */
function formatKm(km) {
    if (!Number.isFinite(km)) return "–";
    if (km >= 1e9) return `${nf(2).format(km / 1e9)} Mrd. km`;
    if (km >= 1e6) return `${nf(1).format(km / 1e6)} Mio. km`;
    return `${nf(0).format(km)} km`;
}

function formatAu(au) {
    if (!Number.isFinite(au)) return "–";
    return `${nf(au < 1 ? 4 : 2).format(au)} AE`;
}

/** Signallaufzeit in der jeweils sprechendsten Einheit. */
function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) return "–";
    if (seconds < 60) return `${nf(1).format(seconds)} s`;
    if (seconds < 3600) return `${nf(1).format(seconds / 60)} min`;
    if (seconds < 86_400) return `${nf(2).format(seconds / 3600)} h`;
    return `${nf(2).format(seconds / 86_400)} Tage`;
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export class DeepSpacePanel {

    constructor() {
        this.missions = [];
        this.failed = [];
        this.epoch = null;
        this.error = "";
        this.loading = true;
        this.selectedId = null;

        this._timer = null;

        this._el = {
            section: document.getElementById("deepspace-section"),
            map: document.getElementById("deepspace-map"),
            list: document.getElementById("deepspace-list"),
            hint: document.getElementById("deepspace-hint"),
            refresh: document.getElementById("deepspace-refresh")
        };

        this._el.refresh?.addEventListener("click", () => this.refresh());

        // Klicks auf Listeneinträge und Kartenpunkte wählen eine Mission
        // (Delegation, weil die Inhalte bei jedem Rendern neu entstehen).
        for (const host of [this._el.list, this._el.map]) {
            host?.addEventListener("click", (event) => {
                const id = event.target.closest("[data-mission]")?.dataset.mission;
                if (!id) return;
                this.selectedId = this.selectedId === id ? null : id;
                this._render();
            });
        }
    }

    async start() {
        if (!this._el.section) return;   // Markup fehlt (z.B. abgespeckte Seite)
        await this.refresh();
        const seconds = CFG().refreshSeconds ?? DEFAULT_REFRESH_SECONDS;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    stop() {
        clearInterval(this._timer);
        this._timer = null;
    }

    async refresh() {
        if (!this._el.section) return;
        this.loading = !this.missions.length;
        this._render();

        try {
            const response = await fetch(API_URL(), { headers: { Accept: "application/json" } });
            const json = await response.json();
            if (!response.ok || json.error) {
                throw new Error(json.error ?? `Server antwortete mit ${response.status}`);
            }

            this.missions = json.missions ?? [];
            this.failed = json.failed ?? [];
            this.epoch = json.epoch ?? null;
            this.error = "";
            console.info(`[DeepSpace] ${this.missions.length} Missionen zur Epoche ${this.epoch}.`);

        } catch (err) {
            // Ohne laufenden Server (reine Dateiansicht) ist das der
            // Normalfall – deshalb nur ein Hinweis, keine Fehlerflut.
            this.error = err.message;
            console.warn(`[DeepSpace] Abruf fehlgeschlagen: ${err.message}`);

        } finally {
            this.loading = false;
            this._render();
        }
    }

    /* ─────────── Darstellung ─────────── */

    _render() {
        if (!this._el.section) return;
        this._renderMap();
        this._renderList();
        this._renderHint();
    }

    /** Schematische Draufsicht auf die Ekliptik. */
    _renderMap() {
        const map = this._el.map;
        if (!map) return;

        if (!this.missions.length) {
            map.innerHTML = "";
            return;
        }

        const rings = REFERENCE_ORBITS.map(orbit => {
            const r = scaledRadius(orbit.au);
            return `
                <circle cx="${CENTER}" cy="${CENTER}" r="${r.toFixed(1)}"
                        class="ds-orbit"/>
                <text x="${CENTER}" y="${(CENTER - r - 2).toFixed(1)}"
                      class="ds-orbit-label">${orbit.label}</text>`;
        }).join("");

        const probes = this.missions.map(mission => {
            const { x, y } = plot(mission.eclipticLongitudeDeg, mission.sunDistanceAu);
            const active = this.selectedId === mission.id;
            // Strich von der Sonne nach außen: macht die Richtung ablesbar
            const inner = plot(mission.eclipticLongitudeDeg, 0);
            return `
                <g data-mission="${escapeHtml(mission.id)}"
                   class="ds-probe${active ? " active" : ""}"
                   tabindex="0" role="button"
                   aria-label="${escapeHtml(mission.name)}">
                    <line x1="${inner.x.toFixed(1)}" y1="${inner.y.toFixed(1)}"
                          x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"
                          stroke="${escapeHtml(mission.color)}"/>
                    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}"
                            r="${active ? 6 : 4}"
                            fill="${escapeHtml(mission.color)}"/>
                </g>`;
        }).join("");

        map.innerHTML = `
            <svg viewBox="0 0 ${VIEW} ${VIEW}" class="ds-svg"
                 role="img" aria-label="Schematische Draufsicht auf die Ekliptik">
                ${rings}
                <circle cx="${CENTER}" cy="${CENTER}" r="7" class="ds-sun"/>
                ${probes}
            </svg>`;
    }

    /** Kompakte Liste; der gewählte Eintrag klappt Detailwerte auf. */
    _renderList() {
        const list = this._el.list;
        if (!list) return;

        if (this.loading && !this.missions.length) {
            list.innerHTML = `<p class="ds-empty">Lade Ephemeriden …</p>`;
            return;
        }
        if (!this.missions.length) {
            list.innerHTML = `<p class="ds-empty">Keine Missionsdaten.</p>`;
            return;
        }

        list.innerHTML = this.missions.map(mission => {
            const active = this.selectedId === mission.id;
            const details = active ? `
                <div class="ds-details">
                    <div class="stat-row"><span>Entfernung Sonne</span><span>${formatAu(mission.sunDistanceAu)}</span></div>
                    <div class="stat-row"><span></span><span>${formatKm(mission.sunDistanceKm)}</span></div>
                    <div class="stat-row"><span>Entfernung Erde</span><span>${formatAu(mission.earthDistanceAu)}</span></div>
                    <div class="stat-row"><span></span><span>${formatKm(mission.earthDistanceKm)}</span></div>
                    <div class="stat-row"><span>Signal hin und zurück</span><span>${formatDuration(mission.roundTripSeconds)}</span></div>
                    <div class="stat-row"><span>Tempo (zur Sonne)</span><span>${nf(1).format(mission.speedKmS)} km/s</span></div>
                    <div class="stat-row"><span>Ziel</span><span>${escapeHtml(mission.goal)}</span></div>
                    <div class="stat-row"><span>Start</span><span>${escapeHtml(mission.launched)}</span></div>
                    <p class="ds-note">${escapeHtml(mission.note)}</p>
                </div>` : "";

            return `
                <div class="ds-item${active ? " active" : ""}" data-mission="${escapeHtml(mission.id)}">
                    <div class="ds-item-head">
                        <span class="ds-dot" style="background:${escapeHtml(mission.color)}"></span>
                        <span class="ds-name">${escapeHtml(mission.name)}</span>
                    </div>
                    <div class="ds-item-values">
                        <span>${formatAu(mission.earthDistanceAu)}</span>
                        <span class="ds-light" title="Signallaufzeit einfach">
                            ⏱ ${formatDuration(mission.lightSeconds)}
                        </span>
                    </div>
                    ${details}
                </div>`;
        }).join("");
    }

    _renderHint() {
        const hint = this._el.hint;
        if (!hint) return;

        if (this.error) {
            hint.innerHTML = `${escapeHtml(this.error)} – für echte Ephemeriden den Server starten: `
                + `<code>node server/server.mjs</code>`;
            return;
        }

        const parts = [];
        if (this.epoch) parts.push(`Epoche ${escapeHtml(this.epoch.replace(/\.0+$/, ""))} TDB`);
        if (this.failed.length) {
            parts.push(`${this.failed.length} Ziel(e) ohne Daten: `
                + this.failed.map(f => escapeHtml(f.name)).join(", "));
        }
        parts.push(`Radien logarithmisch gestaucht, Richtung echt`);

        hint.innerHTML = parts.join(" · ")
            + ` · Quelle: <a href="https://ssd.jpl.nasa.gov/horizons/" target="_blank"`
            + ` rel="noopener noreferrer">NASA/JPL Horizons</a> ↗`;
    }
}
