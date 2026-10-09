/**
 * CometLayer.js – Kometen aus der NASA JPL Small-Body Database.
 *
 * Quelle: /api/comets (SBDB Query API, kein Schlüssel nötig). Der Server
 * liefert nur die Bahnelemente; die Positionen rechnet dieser Layer
 * fortlaufend selbst aus (js/cometOrbits.js). Dadurch laufen die Kometen
 * live weiter, ohne dass dafür Daten nachgeladen werden müssen.
 *
 * Darstellung – anders als beim Asteroiden-Layer ist die RICHTUNG hier
 * echt: angezeigt wird der Subpunkt, also die Stelle der Erde, über der
 * der Komet im Zenit steht. Nur die Entfernung muss gestaucht werden,
 * denn echte Kometenabstände (0,3 bis über 50 AE) liegen weit jenseits
 * jedes brauchbaren Kamerabereichs. Die echten Werte stehen im
 * Detailpanel.
 */

import { BaseLayer } from "./BaseLayer.js";
import { normalizeRecord, svgDataUri } from "../dataManager.js";
import {
    cometPosition, julianDateFromMs, msFromJulianDate, nextPerihelionJd
} from "../cometOrbits.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.comets ?? {};

// Darstellungsschale: außerhalb der Asteroiden-Schale (max. 60.000 km),
// damit sich die beiden Ebenen optisch nicht ins Gehege kommen.
const MIN_ALT_M = 80_000_000;    // ~80.000 km: nächster Komet
const MAX_ALT_M = 400_000_000;   // ~400.000 km, etwa Mondabstand

// Entfernungsbereich, über den die Schale aufgespannt wird (in AE)
const NEAR_AU = 0.3;
const FAR_AU = 50;

/** Positionen nur alle paar Sekunden neu rechnen – Kometen sind langsam. */
const RECOMPUTE_INTERVAL_S = 5;

/** Bahnklassen der SBDB in verständliche Bezeichnungen übersetzen. */
const ORBIT_CLASS_DE = {
    JFc: "Jupiterfamilie", JFC: "Jupiterfamilie",
    HTC: "Halley-Typ", ETc: "Encke-Typ", CTc: "Chiron-Typ",
    COM: "langperiodisch", PAR: "parabolisch", HYP: "hyperbolisch"
};

export function orbitClassLabel(code) {
    return ORBIT_CLASS_DE[code] ?? (code || "unbekannt");
}

/**
 * Farbe nach geschätzter Helligkeit. Kleinere Magnitude = heller.
 * Wenige Stufen, damit der Icon-Cache klein bleibt.
 */
function cometColor(magnitude) {
    if (magnitude == null) return "#94a3b8";   // Helligkeit unbekannt
    if (magnitude <= 10) return "#fff7cc";     // mit dem Fernglas sichtbar
    if (magnitude <= 14) return "#bae6fd";
    if (magnitude <= 18) return "#7dd3fc";
    return "#5b7a99";                          // nur mit großem Teleskop
}

const COMET_SVG = (color) => `
<svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 34 34">
  <defs>
    <linearGradient id="t" x1="1" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="${color}" stop-opacity="0.85"/>
      <stop offset="1" stop-color="${color}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <path d="M23 11 L33 1 L26 14 Z" fill="url(#t)"/>
  <path d="M21 13 L31 3" stroke="url(#t)" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="19" cy="15" r="4.5" fill="${color}" stroke="#0b0e14" stroke-width="1.2"/>
  <circle cx="17.6" cy="13.6" r="1.4" fill="#ffffff" opacity="0.7"/>
</svg>`;

export class CometLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "comets",
            name: "Kometen",
            icon: "🌠",
            type: "comet",
            dataUrl: null
        });

        this.available = false;
        this.lastError = "";
        this.totalMatched = 0;
        this._timer = null;
        this._accum = 0;
        this._iconCache = new Map();
    }

    async load() {
        await this.refresh();
        // Bahnelemente ändern sich kaum – ein Abruf pro Tag genügt
        const seconds = CFG().refreshSeconds ?? 86_400;
        this._timer = setInterval(() => this.refresh(), seconds * 1000);
    }

    async refresh() {
        if (!this.enabled) return;

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20_000);
            const res = await fetch(CFG().apiUrl || "/api/comets", { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);

            this.totalMatched = data.totalMatched ?? 0;
            this._rebuild(data.comets ?? []);
            this.available = true;
            this.lastError = "";

        } catch (err) {
            this.available = false;
            this.lastError = err.message;
            // Ohne Server gibt es diese Ebene schlicht nicht – kein Drama
            console.info("[Kometen] nicht verfügbar:", err.message);
        }
    }

    _rebuild(comets) {
        this.dataSource.entities.removeAll();
        this.entityById.clear();
        this.objects = [];

        const jd = julianDateFromMs(Date.now());

        for (const comet of comets) {
            const position = cometPosition(comet, jd);
            if (!position) continue;

            const obj = normalizeRecord({
                ...comet,
                id: `comet-${comet.id}`,
                name: comet.name,
                latitude: position.latitude,
                longitude: position.longitude,
                altitude: this._scaledAltitude(position.distanceAU)
            }, "comet");

            this._applyDerived(obj, comet, position, jd);

            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
                this.objects.push(obj);
            }
        }
        console.info(`[Kometen] ${this.objects.length} von ${this.totalMatched} Kometen dargestellt.`);
    }

    /**
     * Schreibt die aus der Bahn abgeleiteten, zeitabhängigen Werte in die
     * Metadaten, damit das Detailpanel aktuelle Zahlen zeigt.
     */
    _applyDerived(obj, elements, position, jd) {
        const m = obj.metadata;
        m.distanceAU = position.distanceAU;
        m.heliocentricAU = position.heliocentricAU;
        m.rightAscensionDeg = position.rightAscensionDeg;
        m.declinationDeg = position.declinationDeg;
        m.elongationDeg = position.elongationDeg;

        // Helligkeit mit der aktuellen Entfernung neu schätzen:
        //   m = M1 + 5·log10(Δ) + K1·log10(r)
        m.currentMagnitude = (elements.absoluteMagnitude != null
            && position.distanceAU > 0 && position.heliocentricAU > 0)
            ? elements.absoluteMagnitude
                + 5 * Math.log10(position.distanceAU)
                + (elements.magnitudeSlope ?? 10) * Math.log10(position.heliocentricAU)
            : null;

        const nextJd = nextPerihelionJd(elements, jd);
        m.nextPerihelionMs = nextJd != null ? msFromJulianDate(nextJd) : null;
        m.perihelionMs = elements.tp != null ? msFromJulianDate(elements.tp) : null;
        m.epochMs = elements.epoch != null ? msFromJulianDate(elements.epoch) : null;
        m.orbitClassLabel = orbitClassLabel(elements.orbitClass);
        m.jplUrl = elements.designation
            ? `https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr=${encodeURIComponent(elements.designation)}`
            : "https://ssd.jpl.nasa.gov/tools/sbdb_query.html";
    }

    /**
     * Echte Entfernung → Höhe in der Darstellungsschale.
     * Logarithmisch, weil zwischen 0,3 und 50 AE mehr als zwei
     * Größenordnungen liegen.
     */
    _scaledAltitude(distanceAU) {
        if (!Number.isFinite(distanceAU)) return MIN_ALT_M;
        const clamped = Math.min(FAR_AU, Math.max(NEAR_AU, distanceAU));
        const t = (Math.log10(clamped) - Math.log10(NEAR_AU))
            / (Math.log10(FAR_AU) - Math.log10(NEAR_AU));
        return MIN_ALT_M + t * (MAX_ALT_M - MIN_ALT_M);
    }

    createEntity(obj) {
        const m = obj.metadata;
        const color = cometColor(m.currentMagnitude);

        // Helle Kometen größer zeichnen (Magnitude ist umgekehrt skaliert)
        const mag = m.currentMagnitude ?? 20;
        const size = Math.min(32, Math.max(15, 32 - (mag - 8) * 1.3));

        if (!this._iconCache.has(color)) {
            this._iconCache.set(color, svgDataUri(COMET_SVG(color)));
        }

        return this.dataSource.entities.add({
            id: obj.id,
            position: new Cesium.CallbackProperty(() =>
                Cesium.Cartesian3.fromDegrees(
                    obj.position.longitude, obj.position.latitude, obj.position.altitude
                ), false),
            billboard: {
                image: this._iconCache.get(color),
                width: size,
                height: size,
                scaleByDistance: new Cesium.NearFarScalar(1e6, 1.0, 5e8, 0.35),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(obj.name, Cesium.Color.fromCssColorString(color)),
                scaleByDistance: new Cesium.NearFarScalar(1e7, 1.0, 3e8, 0.0)
            }
        });
    }

    /**
     * Kometen laufen in ECHTER Zeit – ihre Bahn hängt an der Systemuhr,
     * genau wie bei den Live-Satelliten.
     */
    update(simDeltaSeconds, realDeltaSeconds = simDeltaSeconds) {
        if (!this.enabled || !this.objects.length) return;
        if (realDeltaSeconds <= 0) return;

        this._accum += realDeltaSeconds;
        if (this._accum < RECOMPUTE_INTERVAL_S) return;
        this._accum = 0;

        const jd = julianDateFromMs(Date.now());
        for (const obj of this.objects) {
            const position = cometPosition(obj.metadata, jd);
            if (!position) continue;

            obj.position.latitude = position.latitude;
            obj.position.longitude = position.longitude;
            obj.position.altitude = this._scaledAltitude(position.distanceAU);
            this._applyDerived(obj, obj.metadata, position, jd);
        }
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

    statusText() {
        if (!this.available && this.lastError) return `nicht verfügbar: ${this.lastError}`;
        return "Richtung echt (Zenitpunkt), Entfernung gestaucht – echte Werte im Detailpanel";
    }

    _stopTimer() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
        this._accum = 0;
    }
}
