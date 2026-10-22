/**
 * BikeShareLayer.js – Leihrad-/E-Scooter-Stationen (GBFS) an handkuratierten
 * Städten, analog zum bisherigen Muster bei Kameras/AQI.
 *
 * Quelle: General Bikeshare Feed Specification (GBFS), offener Standard
 * für Shared-Mobility-Betreiber (https://github.com/MobilityData/gbfs).
 * data/bikeshare-systems.json listet handverlesene Systeme mit
 * station_information/station_status-URLs – aufgenommen wurden nur
 * Systeme, die ohne Anmeldung und mit offenem CORS erreichbar sind
 * (je Stadt per curl gegen die Feeds verifiziert).
 *
 * station_information (Namen/Koordinaten) ändert sich praktisch nie und
 * wird daher nur einmal geladen; station_status (Verfügbarkeit) wird gemäß
 * GBFS-Spezifikationsempfehlung alle 60-120s neu abgefragt.
 *
 * Die Systeme liegen auf zwei GBFS-Versionen (2.3 und 3.0) mit leicht
 * unterschiedlichen Feldnamen (z.B. num_bikes_available vs.
 * num_vehicles_available, Stationsname als String vs. mehrsprachiges
 * Array) – localizedText()/normalizeStatus() gleichen das an.
 *
 * Nur aggregierte Stationsdaten (Anzahl Räder/Docks), keine Fahrzeug-
 * oder Nutzerverfolgung.
 */

import { BaseLayer } from "./BaseLayer.js";
import { loadJSON, normalizeRecord, svgDataUri } from "../dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.bikeshare ?? {};

/** GBFS v3 erlaubt mehrsprachige Namen als Array von {text, language}. */
function localizedText(value, lang = "en") {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) {
        return value.find(v => v.language === lang)?.text ?? value[0]?.text ?? "";
    }
    return "";
}

/** Gleicht die Feldnamen zwischen GBFS 2.3 (Lyft/nextbike) und 3.0 (publicbikesystem) an. */
function normalizeStatus(raw) {
    const reportedAt = typeof raw.last_reported === "number"
        ? raw.last_reported * 1000
        : raw.last_reported ? Date.parse(raw.last_reported) : null;

    return {
        bikesAvailable: raw.num_bikes_available ?? raw.num_vehicles_available ?? 0,
        docksAvailable: raw.num_docks_available ?? null,
        ebikesAvailable: raw.num_ebikes_available ?? null,
        isRenting: Boolean(raw.is_renting),
        isReturning: Boolean(raw.is_returning),
        isInstalled: raw.is_installed == null ? true : Boolean(raw.is_installed),
        reportedAt
    };
}

/** Farbskala nach Verfügbarkeit (analog zu den AQI-/Wetter-Bändern). */
function colorFor(m) {
    if (!m.isInstalled || (!m.isRenting && !m.isReturning)) return "#64748b"; // außer Betrieb
    if (m.bikesAvailable === 0) return "#f87171";                            // leer
    if (m.bikesAvailable <= 3) return "#facc15";                             // knapp
    return "#34d399";                                                        // gut verfügbar
}

export class BikeShareLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "bikeshare",
            name: "Leihräder",
            icon: "🚲",
            type: "bikeshare",
            dataUrl: null
        });

        this._systems = null;          // Städteliste, einmalig geladen
        this._stationMeta = new Map(); // "{systemId}-{stationId}" → Name/Koordinaten/Kapazität
        this._iconByColor = new Map();
        this.lastFetchAt = 0;
        this.lastError = "";
        this._timer = null;
    }

    async load() {
        this._systems ??= await loadJSON("./data/bikeshare-systems.json");
        if (this._stationMeta.size === 0) await this._loadStationInformation();
        await this.refresh();

        const seconds = CFG().refreshSeconds ?? 90;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    /** Stationsnamen/-koordinaten je System einmalig laden – ändern sich praktisch nie. */
    async _loadStationInformation() {
        await Promise.all((this._systems ?? []).map(async (system) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20_000);
            try {
                const res = await fetch(system.stationInformationUrl, { signal: controller.signal });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                for (const raw of json?.data?.stations ?? []) {
                    const key = `${system.id}-${raw.station_id}`;
                    this._stationMeta.set(key, {
                        name: localizedText(raw.name) || "Station",
                        latitude: raw.lat,
                        longitude: raw.lon,
                        capacity: raw.capacity ?? null
                    });
                }
            } catch (err) {
                console.warn(`[Leihräder] ${system.name} (${system.city}): Stationsliste nicht ladbar:`, err.message);
            } finally {
                clearTimeout(timer);
            }
        }));
    }

    async refresh() {
        if (!this.enabled) return;
        if (!this._systems?.length) return;

        const results = await Promise.allSettled((this._systems ?? []).map(async (system) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20_000);
            try {
                const res = await fetch(system.stationStatusUrl, { signal: controller.signal });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const json = await res.json();
                return { system, stations: json?.data?.stations ?? [] };
            } finally {
                clearTimeout(timer);
            }
        }));

        this._rebuild(results);
        this.lastFetchAt = Date.now();

        const failed = results.filter(r => r.status === "rejected");
        this.lastError = failed.length
            ? `${failed.length}/${this._systems.length} Systeme nicht erreichbar`
            : "";
        if (failed.length) {
            console.warn("[Leihräder] Abruf teilweise fehlgeschlagen:", failed.map(r => r.reason?.message));
        }
    }

    _rebuild(results) {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        for (const result of results) {
            if (result.status !== "fulfilled") continue;
            const { system, stations } = result.value;

            for (const raw of stations) {
                const key = `${system.id}-${raw.station_id}`;
                const meta = this._stationMeta.get(key);
                if (!meta || meta.latitude == null || meta.longitude == null) continue;

                const status = normalizeStatus(raw);

                const obj = normalizeRecord({
                    id: key,
                    name: meta.name,
                    latitude: meta.latitude,
                    longitude: meta.longitude,
                    altitude: 0,
                    city: system.city,
                    country: system.country,
                    systemName: system.name,
                    homepage: system.homepage,
                    capacity: meta.capacity,
                    ...status
                }, "bikeshare");

                const entity = this.createEntity(obj);
                if (entity) {
                    entity.worldViewerObject = obj;
                    this.entityById.set(obj.id, entity);
                    this.objects.push(obj);
                }
            }
        }
        console.info(`[Leihräder] ${this.objects.length} Stationen aktualisiert.`);
    }

    _iconFor(color) {
        if (!this._iconByColor.has(color)) {
            const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
  <circle cx="9" cy="9" r="6.5" fill="${color}" fill-opacity="0.88" stroke="#0b1220" stroke-width="1.3"/>
</svg>`;
            this._iconByColor.set(color, svgDataUri(svg));
        }
        return this._iconByColor.get(color);
    }

    createEntity(obj) {
        const m = obj.metadata;
        const color = colorFor(m);
        const labelText = `${obj.name} · ${m.bikesAvailable}🚲`;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: this._iconFor(color),
                width: 13,
                height: 13,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 2e6, 0.3),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(labelText, Cesium.Color.fromCssColorString(color)),
                scaleByDistance: new Cesium.NearFarScalar(5e3, 1.0, 5e5, 0.0)
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
