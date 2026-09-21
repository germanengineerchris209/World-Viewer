/**
 * ui.js – Sidebar, Layer-Schalter, Kartenauswahl, Detailpanel.
 *
 * Zentrale Funktion: showObjectDetails(object) – generisches
 * Detailpanel für ALLE Objekttypen, inklusive:
 *   • Bild des Objekts (Wikipedia-Foto oder generierte Illustration)
 *   • bei Kameras: eingebetteter Livestream statt Standbild
 *   • Kurzbeschreibung
 *   • typspezifische Datenfelder
 */

import { InfrastructureLayer } from "./layers/InfrastructureLayer.js";
import { getObjectImage, getPlaceholderImage } from "./imageProvider.js";
import { playCameraStream, playRadioStream, stopActiveStream } from "./streamPlayer.js";
import { findLinkedObjects } from "./linkAnalysis.js";
import { buildDossierText, dossierFilename, downloadTextFile } from "./dossier.js";

const fmt = new Intl.NumberFormat("de-DE");

const LINK_TYPE_ICONS = {
    aircraft: "✈️", ship: "🚢", satellite: "🛰️",
    camera: "📷", infrastructure: "🏗️", earthquake: "🌋",
    launch: "🚀", fire: "🔥", radio: "📻"
};

/** Formatierungs-Helfer */
const F = {
    meters: (v) => v != null ? `${fmt.format(Math.round(v))} m` : "–",
    km: (v) => v != null ? `${fmt.format(Math.round(v))} km` : "–",
    kmh: (v) => v != null ? `${fmt.format(Math.round(v))} km/h` : "–",
    knots: (v) => v != null ? `${fmt.format(v)} kn (${fmt.format(Math.round(v * 1.852))} km/h)` : "–",
    deg: (v) => v != null ? `${Math.round(v)}°` : "–",
    coord: (v) => v != null ? v.toFixed(4) : "–",
    min: (v) => v != null ? `${fmt.format(v)} min` : "–",
    text: (v) => (v != null && v !== "") ? String(v) : "–",
    vertical: (v) => {
        if (v == null || Math.abs(v) < 0.3) return "konstant";
        const fpm = Math.round(v * 196.85);          // m/s → Fuß/Minute
        return `${v > 0 ? "▲ steigt" : "▼ sinkt"} ${fmt.format(Math.abs(fpm))} ft/min`;
    }
};

/**
 * Definiert pro Objekttyp, welche Felder im Detailpanel erscheinen.
 * Neue Typen: einfach einen Eintrag ergänzen.
 */
const DETAIL_SCHEMAS = {
    aircraft: {
        badge: "Flugzeug-Details",
        title: (o) => o.metadata.callsign ?? o.name,
        fields: (o) => {
            const m = o.metadata;
            const rows = [
                ["Rufzeichen", F.text(m.callsign)],
                ["Flugzeugtyp", F.text(m.aircraftType ?? m.type)]
            ];
            // Diese Angaben liefert nur Flightradar24, nicht OpenSky
            if (m.registration) rows.push(["Registrierung", F.text(m.registration)]);
            if (m.flightNumber && m.flightNumber !== m.callsign) {
                rows.push(["Flugnummer", F.text(m.flightNumber)]);
            }
            if (m.airline) rows.push(["Airline", F.text(m.airline)]);
            if (m.country) rows.push(["Land", F.text(m.country)]);
            if (m.route) rows.push(["Route", F.text(m.route), true]);

            rows.push(
                ["Höhe", F.meters(o.position.altitude)],
                ["Geschwindigkeit", F.kmh(o.speed)],
                ["Kurs", F.deg(o.heading)],
                ["Steig-/Sinkrate", F.vertical(m.verticalRate)]
            );
            if (m.squawk) rows.push(["Transpondercode", F.text(m.squawk)]);
            rows.push(
                ["Breite", F.coord(o.position.latitude)],
                ["Länge", F.coord(o.position.longitude)]
            );
            return rows;
        }
    },
    ship: {
        badge: "Schiff-Details",
        title: (o) => o.name,
        fields: (o) => [
            ["MMSI", F.text(o.metadata.mmsi)],
            ["Typ", F.text(o.metadata.shipType)],
            ["Flagge", F.text(o.metadata.flag)],
            ["Ziel", F.text(o.metadata.destination), true],
            ["Geschwindigkeit", F.knots(o.speed)],
            ["Kurs", F.deg(o.heading)],
            ["Breite", F.coord(o.position.latitude)],
            ["Länge", F.coord(o.position.longitude)]
        ]
    },
    satellite: {
        badge: "Satelliten-Details",
        title: (o) => o.name,
        fields: (o) => {
            const m = o.metadata;
            const rows = [
                ["Betreiber", F.text(m.operator)],
                ["Typ", F.text(m.satType)],
                ["Bahnhöhe", F.km(o.position.altitude / 1000)],
                ["NORAD-ID", F.text(m.noradId)]
            ];
            if (o.speed) rows.push(["Bahngeschwindigkeit", F.kmh(o.speed)]);
            if (!m.live) {
                if (m.inclination != null) rows.push(["Inklination", F.deg(m.inclination)]);
                if (m.period != null) rows.push(["Umlaufzeit", F.min(m.period)]);
            }
            rows.push(
                ["Bahndaten", m.live ? "CelesTrak (TLE, SGP4)" : "vereinfacht", true],
                ["Breite", F.coord(o.position.latitude)],
                ["Länge", F.coord(o.position.longitude)]
            );
            return rows;
        }
    },
    camera: {
        badge: "Kamera-Details",
        title: (o) => o.name,
        fields: (o) => [
            ["Typ", F.text(o.metadata.cameraType)],
            ["Status", F.text(o.metadata.status)],
            ["Ort", F.text(o.metadata.location), true],
            ["Breite", F.coord(o.position.latitude)],
            ["Länge", F.coord(o.position.longitude)]
        ]
    },
    radio: {
        badge: "Radiosender",
        title: (o) => o.name,
        fields: (o) => {
            const m = o.metadata;
            const rows = [
                ["Genre", F.text(m.genre), true],
                ["Land", F.text(m.country)],
                ["Sprache", F.text(m.language)]
            ];
            if (m.codec) rows.push(["Format", `${m.codec}${m.bitrate ? " · " + m.bitrate + " kbps" : ""}`]);
            rows.push(
                ["Breite", F.coord(o.position.latitude)],
                ["Länge", F.coord(o.position.longitude)]
            );
            return rows;
        },
        extraHtml: (o) => o.metadata.homepage
            ? `<div class="detail-field wide"><label>Webseite</label>
                 <span><a href="${o.metadata.homepage}" target="_blank" rel="noopener"
                    style="color:#38bdf8">Sender-Homepage öffnen ↗</a></span></div>`
            : ""
    },
    infrastructure: {
        badge: "Infrastruktur",
        title: (o) => o.name,
        fields: (o) => [
            ["Kategorie", InfrastructureLayer.categoryLabel(o.metadata.category)],
            ["Code", F.text(o.metadata.code)],
            ["Land", F.text(o.metadata.country)],
            ["Info", F.text(o.metadata.info), true],
            ["Breite", F.coord(o.position.latitude)],
            ["Länge", F.coord(o.position.longitude)]
        ]
    },
    earthquake: {
        badge: "Erdbeben",
        title: (o) => `M ${Number(o.metadata.magnitude).toFixed(1)}`,
        fields: (o) => {
            const m = o.metadata;
            const rows = [
                ["Magnitude", `M ${Number(m.magnitude).toFixed(1)}`],
                ["Tiefe", `${Math.round(m.depthKm)} km`],
                ["Ort", F.text(m.place), true],
                ["Zeitpunkt", m.time
                    ? new Date(m.time).toLocaleString("de-DE") : "–", true]
            ];
            if (m.felt) rows.push(["Spürbar gemeldet", `${m.felt}×`]);
            if (m.tsunami) rows.push(["Tsunami-Hinweis", "ja"]);
            rows.push(
                ["Breite", F.coord(o.position.latitude)],
                ["Länge", F.coord(o.position.longitude)]
            );
            return rows;
        },
        extraHtml: (o) => o.metadata.usgsUrl
            ? `<div class="detail-field wide"><label>Quelle</label>
                 <span><a href="${o.metadata.usgsUrl}" target="_blank" rel="noopener"
                    style="color:#38bdf8">USGS-Bericht öffnen ↗</a></span></div>`
            : ""
    },
    launch: {
        badge: "Raketenstart",
        title: (o) => o.metadata.name ?? o.name,
        fields: (o) => {
            const m = o.metadata;
            const rows = [
                ["Betreiber", F.text(m.provider)],
                ["Rakete", F.text(m.rocket)],
                ["Status", F.text(m.status)]
            ];
            if (m.net) rows.push(["Startzeit",
                new Date(m.net).toLocaleString("de-DE"), true]);
            if (m.missionName) rows.push(["Mission", F.text(m.missionName), true]);
            if (m.orbit) rows.push(["Zielbahn", F.text(m.orbit)]);
            if (m.padName) rows.push(["Startrampe", F.text(m.padName), true]);
            if (m.padLocation) rows.push(["Ort", F.text(m.padLocation), true]);
            rows.push(
                ["Breite", F.coord(o.position.latitude)],
                ["Länge", F.coord(o.position.longitude)]
            );
            return rows;
        }
    },
    fire: {
        badge: "Brandherd",
        title: () => "Aktiver Brand",
        fields: (o) => {
            const m = o.metadata;
            return [
                ["Strahlungsleistung", m.frp ? `${Math.round(m.frp)} MW` : "–"],
                ["Konfidenz", m.confidence != null
                    ? `${Math.round(m.confidence * 100)} %` : "–"],
                ["Helligkeit", m.brightness ? `${Math.round(m.brightness)} K` : "–"],
                ["Satellit", F.text(m.satellite)],
                ["Tag/Nacht", m.dayNight === "N" ? "Nacht" : m.dayNight === "D" ? "Tag" : "–"],
                ["Erfasst", m.acquiredAt
                    ? new Date(m.acquiredAt).toLocaleString("de-DE") : "–", true],
                ["Breite", F.coord(o.position.latitude)],
                ["Länge", F.coord(o.position.longitude)]
            ];
        }
    },
    // Fallback für unbekannte Typen
    default: {
        badge: "Objekt-Details",
        title: (o) => o.name,
        fields: (o) => [
            ["Typ", F.text(o.type)],
            ["Breite", F.coord(o.position.latitude)],
            ["Länge", F.coord(o.position.longitude)],
            ["Höhe", F.meters(o.position.altitude)]
        ]
    }
};

export class UI {

    /**
     * @param {WorldViewer} worldViewer
     * @param {LayerManager} layerManager
     */
    constructor(worldViewer, layerManager) {
        this.worldViewer = worldViewer;
        this.layerManager = layerManager;
        this.selectedObject = null;
        this.labelsVisible = true;
        this.trailsVisible = false;
        this.assistant = null;         // wird von app.js gesetzt

        // Verhindert, dass ein spät eintreffendes Bild ins falsche Panel läuft
        this._mediaToken = 0;

        this._el = {
            panel: document.getElementById("detail-panel"),
            badge: document.getElementById("detail-type-badge"),
            title: document.getElementById("detail-title"),
            content: document.getElementById("detail-content"),
            mediaSlot: document.getElementById("detail-media-slot"),
            mediaCredit: document.getElementById("detail-media-credit"),
            description: document.getElementById("detail-description"),
            layerList: document.getElementById("layer-list"),
            basemapList: document.getElementById("basemap-list"),
            coords: document.getElementById("coords-display"),
            statTotal: document.getElementById("stat-total"),
            statVisible: document.getElementById("stat-visible"),
            flightBadge: document.getElementById("flight-badge"),
            flightSource: document.getElementById("flight-source"),
            flightHint: document.getElementById("flight-hint"),
            flightRefresh: document.getElementById("flight-refresh"),
            cockpitRow: document.getElementById("detail-cockpit-row"),
            cockpitBtn: document.getElementById("detail-cockpit"),
            cockpitHud: document.getElementById("cockpit-hud"),
            cockpitCallsign: document.getElementById("cockpit-callsign"),
            cockpitType: document.getElementById("cockpit-type"),
            cockpitAlt: document.getElementById("cockpit-alt"),
            cockpitSpeed: document.getElementById("cockpit-speed"),
            cockpitHeading: document.getElementById("cockpit-heading"),
            cockpitVs: document.getElementById("cockpit-vs"),
            cockpitExit: document.getElementById("cockpit-exit"),
            links: document.getElementById("detail-links"),
            linksList: document.getElementById("detail-links-list"),
        };

        this.aircraftLayer = null;   // wird von app.js gesetzt
        this.cockpit = null;         // wird von app.js gesetzt

        this._bindStaticButtons();
    }

    /* ─────────── Layer-Schalter ─────────── */

    /** Erzeugt die Layer-Schalter in der Sidebar (nach dem Laden aufrufen). */
    buildLayerToggles() {
        this._el.layerList.innerHTML = "";
        for (const layer of this.layerManager.getAll()) {
            const label = document.createElement("label");
            label.className = "layer-toggle";
            label.innerHTML = `
                <input type="checkbox" ${layer.enabled ? "checked" : ""} data-layer="${layer.id}">
                <span class="layer-switch"></span>
                <span class="layer-icon">${layer.icon}</span>
                <span class="layer-name">${layer.name}</span>
                <span class="layer-count">${layer.count}</span>`;

            label.querySelector("input").addEventListener("change", (e) => {
                e.target.checked ? layer.show() : layer.hide();
                this.updateStats();
            });
            this._el.layerList.appendChild(label);
        }
        this.updateStats();
    }

    /** Zähler der Layer-Schalter aktuell halten (z.B. bei Live-Daten wie AIS). */
    refreshLayerCounts() {
        for (const layer of this.layerManager.getAll()) {
            const counter = this._el.layerList
                ?.querySelector(`.layer-toggle input[data-layer="${layer.id}"]`)
                ?.closest(".layer-toggle")?.querySelector(".layer-count");
            if (counter) counter.textContent = layer.count;
        }
    }

    /* ─────────── Kartenauswahl ─────────── */

    /** Erzeugt die Basemap-Buttons in der Sidebar. */
    buildBasemapSwitcher() {
        const manager = this.worldViewer.basemaps;
        if (!manager) return;

        this._el.basemapList.innerHTML = "";
        for (const basemap of manager.availableBasemaps()) {
            const btn = document.createElement("button");
            btn.className = "basemap-btn";
            btn.title = basemap.description;
            btn.dataset.basemap = basemap.id;
            btn.innerHTML = `<span class="bm-icon">${basemap.icon}</span>
                             <span>${basemap.name}</span>`;
            btn.classList.toggle("active", manager.currentId === basemap.id);

            btn.addEventListener("click", async () => {
                const ok = await manager.setBasemap(basemap.id);
                if (!ok) return;
                this._el.basemapList.querySelectorAll(".basemap-btn")
                    .forEach(b => b.classList.toggle("active", b === btn));
            });
            this._el.basemapList.appendChild(btn);
        }

        // 3D-Gebäude-Button nur anbieten, wenn ein passender Key vorhanden ist
        const buildingsBtn = document.getElementById("btn-buildings");
        if (!manager.hasBuildings) {
            buildingsBtn.disabled = true;
            buildingsBtn.title = "Benötigt einen Cesium-Ion-Token oder Google-Maps-Key "
                + "(siehe config.js)";
            buildingsBtn.style.opacity = "0.45";
            buildingsBtn.style.cursor = "not-allowed";
        }
    }

    updateStats() {
        const { total, visible } = this.layerManager.getStats();
        this._el.statTotal.textContent = total;
        this._el.statVisible.textContent = visible;
    }

    /* ─────────── Status der Live-Flugdaten ─────────── */

    /**
     * Zeigt an, woher die Flugzeugdaten kommen und wie aktuell sie sind.
     * @param {object} status  von AircraftLayer.getStatus()
     */
    updateFlightStatus(status) {
        const badge = this._el.flightBadge;
        const source = this._el.flightSource;
        const hint = this._el.flightHint;
        if (!badge) return;

        this._el.flightRefresh.classList.toggle("spinning", !!status.loading);

        if (status.mode === "live") {
            if (status.outOfRange) {
                badge.className = "flight-badge demo";
                badge.textContent = "PAUSIERT";
                source.textContent = status.source;
                hint.innerHTML = "Zu weit herausgezoomt – näher heranzoomen, "
                    + "dann werden die Flugzeuge im Bildausschnitt geladen.";
            } else {
                badge.className = "flight-badge live";
                badge.textContent = "● LIVE";
                const age = status.lastFetchAt
                    ? Math.round((Date.now() - status.lastFetchAt) / 1000) : null;
                source.textContent = `${status.source} · ${status.count} Flugzeuge`;
                hint.textContent = age != null
                    ? `Zuletzt aktualisiert vor ${age} s. Zwischen den Abrufen werden `
                      + "die Positionen fortgeschrieben."
                    : "";
            }
            if (status.error) {
                badge.className = "flight-badge error";
                hint.textContent = status.error;
            }
        } else if (status.mode === "demo") {
            badge.className = "flight-badge demo";
            badge.textContent = "DEMO";
            source.textContent = `Beispieldaten · ${status.count} Flugzeuge`;
            hint.innerHTML = status.error
                ? `${status.error}`
                : "Für echte Flüge den Server starten: "
                  + "<code>node server/server.mjs</code>";
        } else {
            badge.className = "flight-badge checking";
            badge.textContent = "PRÜFE …";
            source.textContent = "–";
            hint.textContent = "";
        }

        // Zähler im Layer-Schalter mitziehen
        const counter = this._el.layerList
            ?.querySelector('.layer-toggle input[data-layer="aircraft"]')
            ?.closest(".layer-toggle")?.querySelector(".layer-count");
        if (counter) counter.textContent = status.count;

        this.updateStats();
    }

    /* ─────────── Detailpanel ─────────── */

    /**
     * Generische Detailanzeige für JEDES Objekt im einheitlichen Datenformat.
     * @param {object} object  normalisiertes Objekt (siehe dataManager.js)
     * @param {boolean} isRefresh  true = nur Werte aktualisieren (kein Bild neu laden)
     */
    showObjectDetails(object, isRefresh = false) {
        if (!object) return;
        const changed = this.selectedObject?.id !== object.id;
        this.selectedObject = object;

        const schema = DETAIL_SCHEMAS[object.type] ?? DETAIL_SCHEMAS.default;
        this._el.badge.textContent = schema.badge;
        this._el.title.textContent = schema.title(object);

        const rows = schema.fields(object)
            .map(([label, value, wide]) => `
                <div class="detail-field${wide ? " wide" : ""}">
                    <label>${label}</label>
                    <span>${value}</span>
                </div>`)
            .join("");

        const extra = schema.extraHtml ? schema.extraHtml(object) : "";
        this._el.content.innerHTML = `<div class="detail-grid">${rows}${extra}</div>`;
        this._el.panel.classList.remove("hidden");

        // Mitfliegen gibt es nur bei Flugzeugen
        this._el.cockpitRow?.classList.toggle("hidden", object.type !== "aircraft");

        // Bild/Stream und Verknüpfungen nur beim Objektwechsel neu aufbauen,
        // nicht bei jedem Tick (Link-Analyse über alle Objekte ist nicht gratis)
        if (changed || !isRefresh) {
            this._loadMedia(object);
            this._renderLinks(object);
        }
    }

    /**
     * Zeigt verwandte Objekte (gleiche Airline/Betreiber/Flagge, räumliche
     * Nähe) unterhalb der Detailfelder – Gothams "Link Analysis" für die
     * bereits geladenen öffentlichen Daten.
     */
    _renderLinks(object) {
        const links = findLinkedObjects(object, this.layerManager);
        if (links.length === 0) {
            this._el.links.classList.add("hidden");
            return;
        }

        this._el.linksList.innerHTML = links.map(({ object: o, reason }) => `
            <li data-id="${o.id}">
                <span class="link-icon">${LINK_TYPE_ICONS[o.type] ?? "📍"}</span>
                <span class="link-name">${o.metadata?.callsign ?? o.name}</span>
                <span class="link-reason">${reason}</span>
            </li>`).join("");

        this._el.linksList.querySelectorAll("li").forEach(li => {
            li.addEventListener("click", () => {
                const entity = this.layerManager.findEntityById(li.dataset.id);
                if (entity) this.selectEntity(entity, { fly: true });
            });
        });

        this._el.links.classList.remove("hidden");
    }

    /**
     * Lädt das Medium zum Objekt:
     *   Kameras → Livestream einbetten
     *   sonst   → Foto (Wikipedia) bzw. generierte Illustration
     */
    async _loadMedia(object) {
        const token = ++this._mediaToken;
        const slot = this._el.mediaSlot;

        stopActiveStream();
        this._el.mediaCredit.innerHTML = "";
        this._el.description.classList.add("hidden");
        this._el.description.textContent = "";

        // Kameras: echter Livestream
        if (object.type === "camera") {
            slot.classList.remove("loading");
            playCameraStream(slot, object);
            const credit = object.metadata.attribution || object.metadata.streamSource;
            if (credit) this._el.mediaCredit.innerHTML = `<span>${credit}</span>`;
            return;
        }

        // Radiosender: Livestream als Audioplayer
        if (object.type === "radio") {
            slot.classList.remove("loading");
            playRadioStream(slot, object);
            this._el.mediaCredit.innerHTML = `<span>Radio Browser (radio-browser.info)</span>`;
            return;
        }

        // Alle anderen: erst Platzhalter zeigen, dann echtes Foto nachladen
        slot.classList.add("loading");
        slot.innerHTML = `<img class="object-photo" alt="${object.name}"
                               src="${getPlaceholderImage(object)}">`;

        try {
            const image = await getObjectImage(object);
            if (token !== this._mediaToken) return;   // Nutzer hat weitergeklickt

            const img = new Image();
            img.className = "object-photo";
            img.alt = object.name;

            img.onload = () => {
                if (token !== this._mediaToken) return;
                slot.classList.remove("loading");
                slot.innerHTML = "";
                slot.appendChild(img);
            };
            img.onerror = () => {
                if (token !== this._mediaToken) return;
                slot.classList.remove("loading");   // Platzhalter bleibt stehen
            };
            img.src = image.url;

            // Bildnachweis + Wikipedia-Link
            if (image.source === "wikipedia") {
                this._el.mediaCredit.innerHTML =
                    `<span>Foto: ${image.credit}</span>` +
                    (image.pageUrl
                        ? `<a href="${image.pageUrl}" target="_blank" rel="noopener">Artikel ↗</a>`
                        : "");
            } else if (image.credit && image.source !== "illustration") {
                this._el.mediaCredit.innerHTML = `<span>${image.credit}</span>`;
            }

            // Kurzbeschreibung anzeigen und für den KI-Kontext merken
            if (image.extract) {
                object.__wikiExtract = image.extract;
                if (token === this._mediaToken) {
                    this._el.description.textContent = image.extract;
                    this._el.description.classList.remove("hidden");
                }
            }
        } catch (err) {
            console.debug("[ui] Bild konnte nicht geladen werden:", err);
            slot.classList.remove("loading");
        }
    }

    hideObjectDetails() {
        stopActiveStream();
        this._mediaToken++;
        this._el.panel.classList.add("hidden");
        this._el.mediaSlot.innerHTML = "";
        this._el.links.classList.add("hidden");
        this.selectedObject = null;
        this._clearHighlight();
        this.worldViewer.stopFollowing();
        this.assistant?.notifySelectionChanged();
    }

    /**
     * Wird bei laufender Simulation aufgerufen, damit sich bewegende
     * Objekte im offenen Panel live aktualisiert werden.
     */
    refreshDetailsIfOpen() {
        if (this.selectedObject && !this._el.panel.classList.contains("hidden")) {
            this.showObjectDetails(this.selectedObject, true);
        }
    }

    /* ─────────── Auswahl / Hervorhebung ─────────── */

    /** Objekt auswählen: hervorheben + Panel öffnen. */
    selectEntity(entity, { fly = false } = {}) {
        this._clearHighlight();
        if (!entity || !entity.worldViewerObject) return;

        this._highlight(entity);
        this.showObjectDetails(entity.worldViewerObject);
        if (fly) this.worldViewer.flyToEntity(entity);
        this.assistant?.notifySelectionChanged();
    }

    _highlight(entity) {
        this._highlighted = entity;
        if (entity.billboard) {
            this._prevScale = entity.billboard.scale?.getValue?.() ?? 1;
            entity.billboard.scale = 1.5;
            entity.billboard.color = Cesium.Color.CYAN;
        } else if (entity.point) {
            this._prevPixelSize = entity.point.pixelSize?.getValue?.() ?? 8;
            entity.point.pixelSize = 14;
            entity.point.color = Cesium.Color.CYAN;
        }
    }

    _clearHighlight() {
        const e = this._highlighted;
        if (!e) return;
        if (e.billboard) {
            e.billboard.scale = this._prevScale ?? 1;
            e.billboard.color = Cesium.Color.WHITE;
        } else if (e.point) {
            e.point.pixelSize = this._prevPixelSize ?? 8;
            e.point.color = Cesium.Color.fromCssColorString("#38bdf8");
        }
        this._highlighted = null;
    }

    /* ─────────── Cockpit-Ansicht ─────────── */

    /** Blendet die Cockpit-Anzeige ein bzw. aus. */
    setCockpitActive(active) {
        this._el.cockpitHud?.classList.toggle("hidden", !active);
        this._el.panel.classList.toggle("hidden", active || !this.selectedObject);

        if (active) {
            this._hudTimer = setInterval(() => this._updateCockpitHud(), 250);
            this._updateCockpitHud();
        } else if (this._hudTimer) {
            clearInterval(this._hudTimer);
            this._hudTimer = null;
        }
    }

    _updateCockpitHud() {
        const data = this.cockpit?.readout();
        if (!data) return;

        this._el.cockpitCallsign.textContent = data.callsign;
        this._el.cockpitType.textContent = data.aircraftType
            + (data.route ? ` · ${data.route}` : "");
        this._el.cockpitAlt.textContent = F.meters(data.altitude);
        this._el.cockpitSpeed.textContent = F.kmh(data.speed);
        this._el.cockpitHeading.textContent = F.deg(data.heading);
        this._el.cockpitVs.textContent = F.vertical(data.verticalRate);
    }

    /* ─────────── Statuszeile / Koordinaten ─────────── */

    updateCameraCoords() {
        const pos = this.worldViewer.getCameraPosition();
        if (!pos) return;
        const h = pos.height > 10000
            ? `${fmt.format(Math.round(pos.height / 1000))} km`
            : `${fmt.format(Math.round(pos.height))} m`;
        this._el.coords.textContent =
            `${pos.latitude.toFixed(4)}°, ${pos.longitude.toFixed(4)}°  ·  ${h}`;
    }

    /* ─────────── Statische Buttons ─────────── */

    _bindStaticButtons() {
        document.getElementById("detail-close")
            .addEventListener("click", () => this.hideObjectDetails());

        document.getElementById("detail-fly").addEventListener("click", () => {
            if (!this.selectedObject) return;
            const entity = this.layerManager.findEntityById(this.selectedObject.id);
            if (entity) this.worldViewer.flyToEntity(entity);
        });

        document.getElementById("detail-follow").addEventListener("click", (e) => {
            if (!this.selectedObject) return;
            const entity = this.layerManager.findEntityById(this.selectedObject.id);
            if (!entity) return;
            if (this.worldViewer.followedEntity === entity) {
                this.worldViewer.stopFollowing();
                e.target.classList.remove("active");
            } else {
                this.worldViewer.followEntity(entity);
                e.target.classList.add("active");
            }
        });

        // Objekt-Dossier als Textdatei herunterladen
        document.getElementById("detail-dossier").addEventListener("click", () => {
            const object = this.selectedObject;
            if (!object) return;

            const schema = DETAIL_SCHEMAS[object.type] ?? DETAIL_SCHEMAS.default;
            const rows = schema.fields(object).map(([label, value]) => [label, value]);
            const links = findLinkedObjects(object, this.layerManager);

            const text = buildDossierText({
                title: schema.title(object),
                badge: schema.badge,
                rows,
                description: object.__wikiExtract ?? "",
                links
            });
            downloadTextFile(dossierFilename(object.metadata?.callsign ?? object.name), text);
        });

        // "Claude dazu fragen" öffnet den Assistenten mit passender Frage
        document.getElementById("detail-ask").addEventListener("click", () => {
            if (!this.assistant) return;
            this.assistant.open();
            this.assistant.askAbout(this.selectedObject);
        });

        document.getElementById("btn-home")
            .addEventListener("click", () => this.worldViewer.flyHome());

        document.getElementById("btn-mode")
            .addEventListener("click", () => this.worldViewer.toggleSceneMode());

        document.getElementById("btn-atmosphere").addEventListener("click", (e) => {
            const on = this.worldViewer.toggleLighting();
            e.target.classList.toggle("active", on);
        });

        document.getElementById("btn-labels").addEventListener("click", (e) => {
            this.labelsVisible = !this.labelsVisible;
            this.layerManager.setLabelsVisible(this.labelsVisible);
            e.target.classList.toggle("active", !this.labelsVisible);
        });

        document.getElementById("btn-trails").addEventListener("click", (e) => {
            this.trailsVisible = !this.trailsVisible;
            this.layerManager.setTrailsVisible(this.trailsVisible);
            e.target.classList.toggle("active", this.trailsVisible);
        });

        document.getElementById("btn-buildings").addEventListener("click", async (e) => {
            e.target.disabled = true;
            const on = await this.worldViewer.basemaps.toggleBuildings();
            e.target.disabled = false;
            e.target.classList.toggle("active", on);
            if (!on && !this.worldViewer.basemaps.hasBuildings) {
                alert("Für 3D-Gebäude wird ein Cesium-Ion-Token oder ein "
                    + "Google-Maps-Key benötigt. Eintragen in config.js.");
            }
        });

        this._el.cockpitBtn?.addEventListener("click", () => {
            if (!this.selectedObject || !this.cockpit) return;
            const entity = this.layerManager.findEntityById(this.selectedObject.id);
            if (!entity) return;
            if (!this.cockpit.enter(entity)) {
                alert("In dieses Flugzeug kann gerade nicht eingestiegen werden.");
            }
        });

        this._el.cockpitExit?.addEventListener("click", () => this.cockpit?.exit());

        // Flugdaten von Hand neu laden
        this._el.flightRefresh?.addEventListener("click", () => {
            this.aircraftLayer?.refreshLive(true);
        });

        document.getElementById("btn-share").addEventListener("click", async (e) => {
            if (!this.buildShareUrl) return;
            const url = this.buildShareUrl();
            const btn = e.target;
            const original = btn.textContent;
            try {
                await navigator.clipboard.writeText(url);
                btn.textContent = "✅ Kopiert";
            } catch {
                window.prompt("Link kopieren:", url);
            }
            setTimeout(() => { btn.textContent = original; }, 1800);
        });

        document.getElementById("btn-sensor-style").addEventListener("click", () => {
            this.sensorStyles?.cycle();
        });

        document.getElementById("sidebar-collapse").addEventListener("click", (e) => {
            const sidebar = document.getElementById("sidebar");
            sidebar.classList.toggle("collapsed");
            e.target.textContent = sidebar.classList.contains("collapsed") ? "▶" : "◀";
        });
    }
}
