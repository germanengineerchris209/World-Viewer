/**
 * routeTool.js – Routenplanung Fuß/Rad/Auto über den öffentlichen
 * OSRM-Demo-Server (https://router.project-osrm.org, FOSSGIS/Project-OSRM-
 * Community). Keine Anmeldung/kein Schlüssel nötig, aber laut Betreiber nur
 * für Tests/geringes Volumen gedacht – keine Verfügbarkeits-/SLA-Garantie
 * (Hinweis dazu im Panel, siehe drawToolsPanel.js).
 *
 * Ergänzt die lokalen, serverlosen Zeichen-/Mess-Werkzeuge (drawTools.js)
 * um eine Route von einem externen Dienst – deshalb als eigenständiges
 * Modul statt dort integriert. Bedienung: Start- und Zielpunkt je per Klick
 * auf den Globus setzen, danach wird die Route automatisch abgefragt.
 * Keine Turn-by-Turn-Navigation – nur Linie + Distanz/Dauer.
 */

const OSRM_BASE = "https://router.project-osrm.org/route/v1";

// UI-Profile → OSRM-Profilnamen.
export const OSRM_PROFILES = { foot: "walking", bike: "cycling", car: "driving" };
export const PROFILE_LABELS = { foot: "Fuß", bike: "Rad", car: "Auto" };

const ROUTE_COLOR = "#22c55e";
const START_COLOR = "#38bdf8";
const END_COLOR = "#fb923c";
const REQUEST_TIMEOUT_MS = 15_000;

export function formatDuration(seconds) {
    if (!isFinite(seconds)) return "–";
    const totalMin = Math.round(seconds / 60);
    if (totalMin < 60) return `${totalMin} min`;
    const h = Math.floor(totalMin / 60);
    const min = totalMin % 60;
    return min === 0 ? `${h} h` : `${h} h ${min} min`;
}

export class RouteTool {

    /** @param {WorldViewer} worldViewer */
    constructor(worldViewer) {
        this.worldViewer = worldViewer;
        this.viewer = worldViewer.viewer;

        this.profile = "car";
        this.picking = null;        // null | "start" | "end"
        this.start = null;          // {lat, lon} | null
        this.end = null;
        this.status = "idle";       // "idle" | "picking" | "loading" | "ok" | "error"
        this.distanceKm = null;
        this.durationSec = null;
        this.errorMessage = null;

        this.onChange = null;       // (state) => void, von der UI gesetzt

        this._lineEntity = null;
        this._requestToken = 0;

        this.dataSource = new Cesium.CustomDataSource("route-tool");
        this.viewer.dataSources.add(this.dataSource);

        this._handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
        this._handler.setInputAction((m) => this._onLeftClick(m), Cesium.ScreenSpaceEventType.LEFT_CLICK);
    }

    getState() {
        return {
            profile: this.profile,
            picking: this.picking,
            hasStart: !!this.start,
            hasEnd: !!this.end,
            status: this.status,
            distanceKm: this.distanceKm,
            durationSec: this.durationSec,
            errorMessage: this.errorMessage
        };
    }

    setProfile(profile) {
        if (!OSRM_PROFILES[profile] || profile === this.profile) return;
        this.profile = profile;
        if (this.start && this.end) {
            this._fetchRoute();
        } else {
            this._emit();
        }
    }

    /** Startet die Punktauswahl: nächster Klick auf den Globus setzt den Startpunkt. */
    startPicking() {
        this.clear();
        this.picking = "start";
        this.status = "picking";
        this.worldViewer.inputSuppressed = true;
        this._emit();
    }

    /** Bricht eine laufende Punktauswahl ab, behält bereits vorhandene Route. */
    cancelPicking() {
        if (!this.picking) return;
        this.picking = null;
        this.worldViewer.inputSuppressed = false;
        this.status = this.distanceKm != null ? "ok" : "idle";
        this._emit();
    }

    /** Entfernt Route, Marker und setzt das Werkzeug komplett zurück. */
    clear() {
        this.picking = null;
        this.start = null;
        this.end = null;
        this.status = "idle";
        this.distanceKm = null;
        this.durationSec = null;
        this.errorMessage = null;
        this.worldViewer.inputSuppressed = false;
        this._requestToken++; // laufende Anfrage als veraltet markieren
        this._lineEntity = null;
        this.dataSource.entities.removeAll();
        this._emit();
    }

    _emit() {
        this.onChange?.(this.getState());
    }

    _pick(position) {
        if (!position) return null;
        return this.viewer.camera.pickEllipsoid(position, this.viewer.scene.globe.ellipsoid) ?? null;
    }

    _onLeftClick(movement) {
        if (!this.picking) return;
        const cartesian = this._pick(movement.position);
        if (!cartesian) return;
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        const point = { lat: Cesium.Math.toDegrees(carto.latitude), lon: Cesium.Math.toDegrees(carto.longitude) };

        if (this.picking === "start") {
            this.start = point;
            this._renderMarker(point, "Start", START_COLOR);
            this.picking = "end";
            this._emit();
            return;
        }

        this.end = point;
        this._renderMarker(point, "Ziel", END_COLOR);
        this.picking = null;
        this.worldViewer.inputSuppressed = false;
        this._fetchRoute();
    }

    _renderMarker(point, label, colorCss) {
        const color = Cesium.Color.fromCssColorString(colorCss);
        this.dataSource.entities.add({
            position: Cesium.Cartesian3.fromDegrees(point.lon, point.lat),
            point: {
                pixelSize: 10, color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                text: label,
                font: "12px 'SF Mono', Consolas, monospace",
                fillColor: color,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -14),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
    }

    _clearRouteLine() {
        if (this._lineEntity) {
            this.dataSource.entities.remove(this._lineEntity);
            this._lineEntity = null;
        }
    }

    async _fetchRoute() {
        if (!this.start || !this.end) return;
        this._clearRouteLine();
        this.status = "loading";
        this.errorMessage = null;
        this._emit();

        const token = ++this._requestToken;
        const osrmProfile = OSRM_PROFILES[this.profile];
        const coords = `${this.start.lon},${this.start.lat};${this.end.lon},${this.end.lat}`;
        const url = `${OSRM_BASE}/${osrmProfile}/${coords}?overview=full&geometries=geojson`;

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);
            if (token !== this._requestToken) return; // inzwischen neue Anfrage/Reset

            if (res.status === 429) {
                throw new Error(
                    "Rate-Limit des OSRM-Demo-Servers erreicht – bitte kurz warten und erneut versuchen."
                );
            }
            if (!res.ok) {
                throw new Error(`OSRM-Demo-Server antwortet mit Fehler (HTTP ${res.status}).`);
            }

            const json = await res.json();
            if (token !== this._requestToken) return;

            if (json.code !== "Ok" || !json.routes?.length) {
                throw new Error("Keine Route zwischen den gewählten Punkten gefunden.");
            }

            const route = json.routes[0];
            this.distanceKm = route.distance / 1000;
            this.durationSec = route.duration;
            this.status = "ok";
            this._renderRouteLine(route.geometry.coordinates);
            this._emit();

        } catch (err) {
            clearTimeout(timer);
            if (token !== this._requestToken) return;
            this.status = "error";
            this.errorMessage = err.name === "AbortError"
                ? "Der OSRM-Demo-Server antwortet nicht (Zeitüberschreitung)."
                : (err.message || "Der öffentliche OSRM-Demo-Server ist aktuell nicht erreichbar.");
            console.warn("[Route] OSRM-Abfrage fehlgeschlagen:", this.errorMessage);
            this._emit();
        }
    }

    _renderRouteLine(coordinates) {
        const flat = [];
        for (const [lon, lat] of coordinates) flat.push(lon, lat);
        this._lineEntity = this.dataSource.entities.add({
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArray(flat),
                width: 4,
                material: Cesium.Color.fromCssColorString(ROUTE_COLOR),
                clampToGround: true
            }
        });
    }
}
