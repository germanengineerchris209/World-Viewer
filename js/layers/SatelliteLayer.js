/**
 * SatelliteLayer.js – Satelliten auf echten Bahnen.
 *
 * Seit v2.3 werden ECHTE Bahndaten verwendet: Two-Line Elements (TLE)
 * von CelesTrak, propagiert mit dem SGP4-Modell aus satellite.js.
 * Das ersetzt die frühere vereinfachte Kreisbahn – die Positionen
 * stimmen jetzt mit der Wirklichkeit überein.
 *
 * Vorgehensweise übernommen aus "God's Eye View" von Bilawal Sidhu
 * (MIT-Lizenz, https://github.com/bilawalsidhu/gods-eye-view).
 * Bahndaten: CelesTrak (celestrak.org), Dr. T.S. Kelso.
 *
 * Ohne laufenden Server (der CelesTrak spiegelt, weil dort keine
 * CORS-Header gesetzt sind) fällt der Layer auf die Beispieldaten
 * aus data/satellites.json mit vereinfachter Kreisbahn zurück.
 */

import { BaseLayer } from "./BaseLayer.js";
import { loadJSON, normalizeRecord, toRad, toDeg } from "../dataManager.js";

const SATELLITE_JS_CDN = "https://cdn.jsdelivr.net/npm/satellite.js@6.0.2/dist/satellite.min.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.satellites ?? {};

/** Darstellung je Kategorie (Farben wie im Referenzprojekt). */
const CLASS_STYLE = {
    station:  { color: "#fff6e5", size: 8, label: true,  name: "Raumstation" },
    visual:   { color: "#9fb3c4", size: 6, label: true,  name: "Sichtbar" },
    nav:      { color: "#4fd8ff", size: 6, label: true,  name: "Navigation" },
    geo:      { color: "#c89bff", size: 5, label: true,  name: "Geostationär" },
    comms:    { color: "#54697f", size: 3, label: false, name: "Kommunikation" },
    other:    { color: "#8b93a7", size: 4, label: false, name: "Satellit" }
};

/** satellite.js einmalig nachladen. */
let satLibLoader = null;
function loadSatelliteLib() {
    if (window.satellite) return Promise.resolve(window.satellite);
    if (satLibLoader) return satLibLoader;

    satLibLoader = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = SATELLITE_JS_CDN;
        script.onload = () => resolve(window.satellite);
        script.onerror = () => reject(new Error("satellite.js konnte nicht geladen werden"));
        document.head.appendChild(script);
    });
    return satLibLoader;
}

export class SatelliteLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "satellites",
            name: "Satellites",
            icon: "🛰️",
            type: "satellite",
            dataUrl: null
        });

        this.mode = "unknown";        // "live" | "demo"
        this.sourceName = "";
        this.lastError = "";
        this._sat = null;             // satellite.js
        this._simTime = 0;            // nur für den Demo-Betrieb
        this._orbitEntity = null;     // Bahnring des ausgewählten Satelliten
    }

    /* ═══════════ Laden ═══════════ */

    async load() {
        const cfg = CFG();

        if (cfg.mode !== "demo") {
            try {
                this._sat = await loadSatelliteLib();
                const loaded = await this._loadFromCelestrak();
                if (loaded > 0) {
                    this.mode = "live";
                    this.sourceName = "CelesTrak (TLE, SGP4)";
                    console.info(`[Satellites] ${loaded} Satelliten mit echten Bahndaten.`);
                    return;
                }
            } catch (err) {
                this.lastError = err.message;
                console.warn("[Satellites] Echte Bahndaten nicht verfügbar:", err.message);
            }
        }

        this.mode = "demo";
        this.sourceName = "Beispieldaten (vereinfachte Kreisbahn)";
        await this._loadDemo();
    }

    /**
     * Holt die TLE-Gruppen über den eigenen Server – PARALLEL, nicht
     * nacheinander: fünf sequentielle Requests würden sich bei
     * langsamer Verbindung zum Server oder zu CelesTrak aufsummieren
     * und die Ladeanzeige minutenlang blockieren (siehe WEB-31).
     */
    async _loadFromCelestrak() {
        const cfg = CFG();
        const groups = cfg.groups ?? ["stations", "visual", "gps-ops", "galileo", "geo"];
        const maxPerGroup = cfg.maxPerGroup ?? 60;
        const seen = new Set();
        let count = 0;

        const responses = await Promise.allSettled(
            groups.map(async (group) => {
                const res = await fetch(`/api/celestrak/${group}`);
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.text();
            })
        );

        // In der ursprünglichen Gruppen-Reihenfolge auswerten, damit das
        // "erste Gruppe gewinnt"-Dedupe weiterhin deterministisch ist.
        for (let i = 0; i < groups.length; i++) {
            const group = groups[i];
            const result = responses[i];
            try {
                if (result.status === "rejected") throw result.reason;
                const text = result.value;

                let added = 0;
                for (const entry of parseTle(text)) {
                    if (added >= maxPerGroup) break;

                    const satrec = this._sat.twoline2satrec(entry.line1, entry.line2);
                    if (!satrec || satrec.error !== 0) continue;

                    const noradId = String(satrec.satnum);
                    if (seen.has(noradId)) continue;   // erste Gruppe gewinnt
                    seen.add(noradId);

                    const position = this._propagate(satrec, new Date());
                    if (!position) continue;

                    const obj = normalizeRecord({
                        id: `sat-${noradId}`,
                        name: entry.name,
                        latitude: position.latitude,
                        longitude: position.longitude,
                        altitude: position.altitude,
                        noradId,
                        satType: classifyName(entry.name, group),
                        group,
                        operator: operatorFor(entry.name, group),
                        wikipedia: wikipediaFor(entry.name),
                        live: true
                    }, "satellite");

                    obj.__satrec = satrec;
                    obj.speed = position.speedKmh;

                    const entity = this.createEntity(obj);
                    if (entity) {
                        entity.worldViewerObject = obj;
                        this.entityById.set(obj.id, entity);
                        this.objects.push(obj);
                        added++; count++;
                    }
                }
            } catch (err) {
                console.warn(`[Satellites] Gruppe '${group}':`, err.message);
            }
        }
        return count;
    }

    /** Rückfall: Beispieldaten mit vereinfachter Kreisbahn. */
    async _loadDemo() {
        const raw = await loadJSON("./data/satellites.json");
        this.objects = raw.map(r => normalizeRecord(r, "satellite"));

        for (const obj of this.objects) {
            obj.position = this._demoPosition(obj.metadata, 0);
            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
            }
        }
        console.info(`[Satellites] ${this.objects.length} Satelliten (Beispieldaten).`);
    }

    /* ═══════════ Bahnberechnung ═══════════ */

    /**
     * SGP4: TLE → geografische Position.
     * @returns {{latitude,longitude,altitude,speedKmh}|null}
     */
    _propagate(satrec, date) {
        const S = this._sat;
        try {
            const posVel = S.propagate(satrec, date);
            if (!posVel?.position || typeof posVel.position === "boolean") return null;

            const gmst = S.gstime(date);
            const geo = S.eciToGeodetic(posVel.position, gmst);

            const v = posVel.velocity;
            const speedKmh = v ? Math.hypot(v.x, v.y, v.z) * 3600 : 0;

            return {
                latitude: S.degreesLat(geo.latitude),
                longitude: S.degreesLong(geo.longitude),
                altitude: geo.height * 1000,     // km → m
                speedKmh
            };
        } catch {
            return null;
        }
    }

    /** Vereinfachte Kreisbahn für den Demo-Betrieb. */
    _demoPosition(meta, t) {
        const EARTH_ROT = 360 / 86164;
        const periodSec = (meta.period ?? 90) * 60;
        const incl = toRad(meta.inclination ?? 51.6);
        const theta = toRad(meta.phase ?? 0) + (2 * Math.PI * t) / periodSec;

        const lat = Math.asin(Math.sin(incl) * Math.sin(theta));
        const lonOrbit = Math.atan2(Math.cos(incl) * Math.sin(theta), Math.cos(theta));
        let lon = (meta.raan ?? 0) + toDeg(lonOrbit) - EARTH_ROT * t;
        lon = ((lon + 540) % 360) - 180;

        return { latitude: toDeg(lat), longitude: lon, altitude: (meta.altitude ?? 550) * 1000 };
    }

    /* ═══════════ Darstellung ═══════════ */

    createEntity(obj) {
        const style = CLASS_STYLE[obj.metadata.satClass ?? classKey(obj.metadata.satType)]
            ?? CLASS_STYLE.other;
        // Die ISS bekommt eine Sonderbehandlung – sie ist das Objekt,
        // das die meisten Leute zuerst suchen
        const isISS = obj.metadata.noradId === "25544";

        return this.dataSource.entities.add({
            id: obj.id,
            position: new Cesium.CallbackProperty(() =>
                Cesium.Cartesian3.fromDegrees(
                    obj.position.longitude, obj.position.latitude, obj.position.altitude
                ), false),
            point: {
                pixelSize: isISS ? 12 : style.size,
                color: Cesium.Color.fromCssColorString(isISS ? "#ff4444" : style.color),
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: isISS ? 2 : 1,
                scaleByDistance: new Cesium.NearFarScalar(1e6, 1.5, 2e7, 0.6),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: (style.label || isISS) ? {
                ...this._makeLabel(obj.name,
                    Cesium.Color.fromCssColorString(isISS ? "#ff8080" : style.color)),
                scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 5e7, 0.4)
            } : undefined
        });
    }

    /**
     * Zeichnet die Umlaufbahn des ausgewählten Satelliten als Ring.
     *
     * Wichtiges Detail: Die Sternzeit (GMST) wird auf den Bezugszeitpunkt
     * EINGEFROREN. Sonst klafft der Ring auf, weil sich die Erde während
     * eines Umlaufs weiterdreht – bei niedrigen Bahnen um rund 24°.
     */
    showOrbit(obj) {
        this.hideOrbit();
        if (this.mode !== "live" || !obj?.__satrec) return;

        const S = this._sat;
        const satrec = obj.__satrec;
        const reference = new Date();

        try {
            const fixedGmst = S.gstime(reference);
            // Umlaufzeit aus der mittleren Bewegung (Umläufe/Tag)
            const revsPerDay = satrec.no * (1440 / (2 * Math.PI));
            const periodSec = 86400 / revsPerDay;
            const points = [];

            for (let i = 0; i <= 180; i++) {
                const at = new Date(reference.getTime() + (periodSec * 1000 * i) / 180);
                const posVel = S.propagate(satrec, at);
                if (!posVel?.position || typeof posVel.position === "boolean") continue;

                const geo = S.eciToGeodetic(posVel.position, fixedGmst);
                points.push(Cesium.Cartesian3.fromDegrees(
                    S.degreesLong(geo.longitude),
                    S.degreesLat(geo.latitude),
                    geo.height * 1000
                ));
            }
            if (points.length < 10) return;

            this._orbitEntity = this.dataSource.entities.add({
                polyline: {
                    positions: points,
                    width: 1.6,
                    material: Cesium.Color.fromCssColorString("#38bdf8").withAlpha(0.55),
                    arcType: Cesium.ArcType.NONE
                }
            });
        } catch (err) {
            console.debug("[Satellites] Bahnring:", err.message);
        }
    }

    hideOrbit() {
        if (this._orbitEntity) {
            this.dataSource.entities.remove(this._orbitEntity);
            this._orbitEntity = null;
        }
    }

    /* ═══════════ Fortschreibung ═══════════ */

    /**
     * Live-Satelliten laufen in ECHTER Zeit (ihre Bahn ist an die
     * Systemuhr gebunden), Demo-Satelliten im Zeitraffer.
     */
    update(simDeltaSeconds, realDeltaSeconds = simDeltaSeconds) {
        if (!this.enabled) return;

        if (this.mode === "live") {
            if (realDeltaSeconds <= 0) return;
            // Einmal pro Sekunde reicht – SGP4 für hunderte Objekte
            // bei jedem Frame wäre Verschwendung
            this._accum = (this._accum ?? 0) + realDeltaSeconds;
            if (this._accum < 1) return;
            this._accum = 0;

            const now = new Date();
            for (const obj of this.objects) {
                const p = this._propagate(obj.__satrec, now);
                if (p) {
                    obj.position.latitude = p.latitude;
                    obj.position.longitude = p.longitude;
                    obj.position.altitude = p.altitude;
                    obj.speed = p.speedKmh;
                }
            }
        } else {
            this._simTime += simDeltaSeconds;
            for (const obj of this.objects) {
                obj.position = this._demoPosition(obj.metadata, this._simTime);
            }
        }
    }

    clear() {
        this.hideOrbit();
        super.clear();
    }
}

/* ═══════════ Hilfsfunktionen ═══════════ */

/** Drei-Zeilen-TLE-Text zerlegen. */
function parseTle(text) {
    const lines = String(text).split("\n").map(l => l.trimEnd());
    const out = [];
    for (let i = 0; i < lines.length - 2; i += 3) {
        const name = lines[i].trim();
        const line1 = lines[i + 1];
        const line2 = lines[i + 2];
        if (line1?.startsWith("1 ") && line2?.startsWith("2 ")) {
            out.push({ name, line1, line2 });
        }
    }
    return out;
}

/** Kategorie aus Name und Gruppe ableiten. */
function classifyName(name, group) {
    const n = name.toUpperCase();
    if (group === "stations" || /ISS|TIANGONG|CSS /.test(n)) return "Raumstation";
    if (group === "geo") return "Geostationär";
    if (/NAVSTAR|GPS|GALILEO|GLONASS|BEIDOU/.test(n)) return "Navigation";
    if (/STARLINK|ONEWEB|IRIDIUM/.test(n)) return "Kommunikation";
    if (group === "visual") return "Sichtbar";
    return "Satellit";
}

function classKey(satType) {
    switch (satType) {
        case "Raumstation": return "station";
        case "Geostationär": return "geo";
        case "Navigation": return "nav";
        case "Kommunikation": return "comms";
        case "Sichtbar": return "visual";
        default: return "other";
    }
}

function operatorFor(name, group) {
    const n = name.toUpperCase();
    if (/ISS/.test(n)) return "NASA / Roskosmos / ESA / JAXA / CSA";
    if (/TIANGONG|CSS/.test(n)) return "CNSA";
    if (/STARLINK/.test(n)) return "SpaceX";
    if (/ONEWEB/.test(n)) return "Eutelsat OneWeb";
    if (/NAVSTAR|GPS/.test(n)) return "US Space Force";
    if (/GALILEO|GSAT/.test(n)) return "EU / ESA";
    if (/COSMOS|GLONASS/.test(n)) return "Roskosmos";
    if (/IRIDIUM/.test(n)) return "Iridium Communications";
    if (group === "geo") return "Kommerzieller Betreiber";
    return "";
}

function wikipediaFor(name) {
    const n = name.toUpperCase();
    if (/ISS \(ZARYA\)|^ISS/.test(n)) return "Internationale Raumstation";
    if (/TIANGONG|CSS \(TIANHE\)/.test(n)) return "Chinesische Raumstation";
    if (/HST|HUBBLE/.test(n)) return "Hubble-Weltraumteleskop";
    if (/STARLINK/.test(n)) return "Starlink";
    if (/ONEWEB/.test(n)) return "OneWeb";
    if (/NAVSTAR|GPS/.test(n)) return "Global Positioning System";
    if (/GALILEO|GSAT/.test(n)) return "Galileo (Satellitennavigation)";
    if (/GLONASS|COSMOS/.test(n)) return "GLONASS";
    if (/IRIDIUM/.test(n)) return "Iridium (Satellitensystem)";
    if (/METEOSAT/.test(n)) return "Meteosat";
    if (/NOAA/.test(n)) return "NOAA (Satellit)";
    return "";
}
