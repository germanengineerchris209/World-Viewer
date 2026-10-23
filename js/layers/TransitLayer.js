/**
 * TransitLayer.js – Busse, Bahnen, Fähren (ÖPNV, GTFS-Realtime).
 *
 * Quelle: eigener Server-Proxy /api/transit/<stadt> (server/dataProxies.mjs
 * + server/gtfsRealtime.mjs), der GTFS-Realtime-Protobuf-Feeds dekodiert –
 * im Browser gibt es dafür keine CDN-Bibliothek ohne Build-Schritt, und
 * beide Feeds senden ohnehin kein CORS (Browser dürfte sie also gar nicht
 * direkt lesen).
 *
 * Zwei schlüsselfreie Städte, siehe
 * docs/WEB-83-datenquellen-verkehr-oepnv-streetlevel-militaer.md:
 *   - Boston (MBTA): Bus, U-Bahn/Straßenbahn, Pendlerzug, Fähre
 *   - Niederlande (OVapi): landesweiter Aggregator, deutlich mehr Fahrzeuge
 *
 * Abgedeckt sind NUR diese Regionen – das ist eine Dateneigenschaft (zwei
 * ausgewählte offene Feeds von vielen tausend GTFS-Betreibern weltweit),
 * keine Lücke der Implementierung. statusText() erklärt das in der
 * Sidebar, damit eine leere Karte anderswo nicht wie ein Fehler wirkt.
 *
 * Abruf nur, solange die Ebene aktiv ist (siehe show()/hide()), mit
 * serverseitigem Cache (20s) – genau wie bei Aircraft/Ships.
 */

import { BaseLayer } from "./BaseLayer.js";
import { movePosition, svgDataUri, normalizeRecord } from "../dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.transit ?? {};

// Farbe/Symbol je Verkehrsmittel (vom Server grob klassifiziert, siehe
// classifyMbtaVehicleType in dataProxies.mjs; OVapi liefert "unbekannt").
const VEHICLE_STYLES = {
    bus: { color: "#fb923c", shape: "circle" },
    bahn: { color: "#f87171", shape: "square" },
    pendlerzug: { color: "#a78bfa", shape: "square" },
    faehre: { color: "#38bdf8", shape: "triangle" },
    unbekannt: { color: "#94a3b8", shape: "circle" }
};

const STATUS_DE = {
    IN_TRANSIT_TO: "in Fahrt",
    STOPPED_AT: "an Haltestelle",
    INCOMING_AT: "nähert sich Haltestelle"
};

function vehicleSvg(shape, color) {
    if (shape === "square") {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
  <rect x="4" y="4" width="18" height="18" rx="3" fill="${color}" stroke="#111" stroke-width="1.2"/>
</svg>`;
    }
    if (shape === "triangle") {
        return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
  <path d="M13 3 L23 22 L3 22 Z" fill="${color}" stroke="#111" stroke-width="1.2"/>
</svg>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
  <circle cx="13" cy="13" r="10" fill="${color}" stroke="#111" stroke-width="1.2"/>
</svg>`;
}

export class TransitLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "transit",
            name: "ÖPNV",
            icon: "🚌",
            type: "transit",
            dataUrl: null
        });

        this._iconUrlByType = new Map(
            Object.entries(VEHICLE_STYLES).map(([type, s]) =>
                [type, svgDataUri(vehicleSvg(s.shape, s.color))])
        );
        this.enableTrails(Cesium.Color.fromCssColorString("#fb923c"));

        this.cities = [];          // vom Server gemeldete Städte ({id,label,attribution})
        this.available = false;
        this.lastError = "";
        this.lastFetchAt = 0;
        this.fetchPending = false;

        this._onStatusChange = null;
    }

    get apiUrl() { return CFG().apiUrl || "/api/transit"; }

    onStatusChange(callback) { this._onStatusChange = callback; }
    _notify() { this._onStatusChange?.(this.getStatus()); }

    getStatus() {
        return {
            available: this.available,
            cities: this.cities,
            count: this.objects.length,
            lastFetchAt: this.lastFetchAt,
            error: this.lastError,
            loading: this.fetchPending
        };
    }

    /* ═══════════ Laden ═══════════ */

    async load() {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`${this.apiUrl}/status`, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) throw new Error(String(res.status));

            const status = await res.json();
            this.cities = status.cities ?? [];
            this.available = this.cities.length > 0;
        } catch (err) {
            this.available = false;
            this.lastError = "Kein Server für ÖPNV-Daten erreichbar "
                + "(node server/server.mjs starten).";
            console.warn("[Transit]", this.lastError, err.message);
        }

        if (this.available) {
            await this.refreshLive();
            this.startPolling();
        }
        this._notify();
    }

    /* ═══════════ Live-Abruf ═══════════ */

    startPolling() {
        const interval = Math.max(CFG().refreshSeconds ?? 20, 10) * 1000;
        this.startTimer("poll", interval, () => this.refreshLive());
        console.info(`[Transit] Live-Abruf alle ${Math.round(interval / 1000)} s `
            + `für ${this.cities.map(c => c.label).join(", ")}.`);
    }

    stopPolling() {
        this.stopTimer("poll");
    }

    /** Holt alle konfigurierten Städte parallel und führt sie zusammen. */
    async refreshLive() {
        if (!this.available || this.fetchPending || !this.enabled) return;

        this.fetchPending = true;
        this._notify();

        try {
            const results = await Promise.all(this.cities.map(c => this._fetchCity(c.id)));
            const vehicles = results.flat();

            this.lastFetchAt = Date.now();
            this.lastError = results.length && vehicles.length === 0
                ? ""   // leere, aber erfolgreiche Antwort ist kein Fehler
                : this.lastError;
            this._reconcile(vehicles);
        } finally {
            this.fetchPending = false;
            this._notify();
        }
    }

    async _fetchCity(cityId) {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12_000);
            const res = await fetch(`${this.apiUrl}/${cityId}`, { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();
            if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
            return data.vehicles ?? [];
        } catch (err) {
            this.lastError = `${cityId}: ${err.message}`;
            console.warn(`[Transit] ${cityId} nicht abrufbar:`, err.message);
            return [];
        }
    }

    /** Gleicht die neue Fahrzeugliste mit der Anzeige ab. */
    _reconcile(list) {
        const now = Date.now();
        const seen = new Set();

        for (const record of list) {
            seen.add(record.id);
            this._upsert(record);
        }

        // Fahrzeuge, die eine Weile nicht mehr gemeldet wurden, entfernen
        // (z.B. Fahrtende oder kurzer Aussetzer im Feed).
        const graceMs = (CFG().removeAfterSeconds ?? 90) * 1000;

        for (const obj of [...this.objects]) {
            if (seen.has(obj.id)) {
                obj.__lastSeen = now;
            } else if (now - (obj.__lastSeen ?? 0) > graceMs) {
                this._remove(obj.id);
            }
        }
    }

    /** Legt ein Fahrzeug an oder aktualisiert es. */
    _upsert(record) {
        const existing = this.entityById.get(record.id);
        const heading = record.bearing ?? existing?.worldViewerObject?.heading ?? 0;
        const speedKmh = record.speedKmh ?? 0;

        if (existing) {
            const obj = existing.worldViewerObject;
            obj.position.latitude = record.latitude;
            obj.position.longitude = record.longitude;
            obj.heading = heading;
            obj.speed = speedKmh;
            obj.timestamp = record.timestamp;
            obj.__lastSeen = Date.now();
            Object.assign(obj.metadata, this._buildMetadata(record));
            return;
        }

        const obj = normalizeRecord({
            id: record.id,
            name: record.vehicleLabel || record.routeId || record.id,
            latitude: record.latitude,
            longitude: record.longitude,
            altitude: 0,
            speed: speedKmh,
            heading,
            timestamp: record.timestamp,
            ...this._buildMetadata(record)
        }, "transit");

        obj.__lastSeen = Date.now();

        const entity = this.createEntity(obj);
        if (entity) {
            entity.worldViewerObject = obj;
            this.entityById.set(obj.id, entity);
            this.objects.push(obj);
        }
    }

    /** Baut die Zusatzfelder für Detailpanel (Linie, Richtung, Status). */
    _buildMetadata(record) {
        const cityLabel = this.cities.find(c => c.id === record.city)?.label ?? record.city;
        return {
            city: record.city,
            cityLabel,
            routeId: record.routeId ?? "",
            tripId: record.tripId ?? "",
            directionId: record.directionId,
            currentStatus: record.currentStatus,
            currentStatusDe: STATUS_DE[record.currentStatus] ?? "unbekannt",
            stopId: record.stopId ?? "",
            vehicleType: record.vehicleType ?? "unbekannt",
            vehicleLabel: record.vehicleLabel ?? ""
        };
    }

    /** Entfernt ein Fahrzeug vollständig. */
    _remove(id) {
        const entity = this.entityById.get(id);
        if (entity) this.dataSource.entities.remove(entity);
        this.entityById.delete(id);
        this._removeTrailEntity(id);
        const i = this.objects.findIndex(o => o.id === id);
        if (i >= 0) this.objects.splice(i, 1);
    }

    /* ═══════════ Darstellung ═══════════ */

    createEntity(obj) {
        const type = obj.metadata.vehicleType;
        const style = VEHICLE_STYLES[type] ?? VEHICLE_STYLES.unbekannt;
        const iconUrl = this._iconUrlByType.get(type) ?? this._iconUrlByType.get("unbekannt");

        return this.dataSource.entities.add({
            id: obj.id,
            position: new Cesium.CallbackProperty(() =>
                Cesium.Cartesian3.fromDegrees(
                    obj.position.longitude, obj.position.latitude, 0
                ), false),
            billboard: {
                image: iconUrl,
                width: 20,
                height: 20,
                rotation: new Cesium.CallbackProperty(
                    () => Cesium.Math.toRadians(-(obj.heading ?? 0)), false),
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 2e6, 0.5),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: this._makeLabel(
                obj.metadata.routeId || obj.name,
                Cesium.Color.fromCssColorString(style.color)
            )
        });
    }

    /**
     * Fahrzeuge fahren zwischen zwei Live-Abrufen per Koppelnavigation
     * weiter (Kurs + Geschwindigkeit), damit die Bewegung flüssig statt
     * sprunghaft aussieht – wie bei Flugzeugen/Schiffen. Ohne Bearing
     * (manche Feeds liefern keins) bleibt das Fahrzeug bis zum nächsten
     * Abruf stehen, statt in eine geratene Richtung zu driften.
     */
    update(simDeltaSeconds, realDeltaSeconds = simDeltaSeconds) {
        if (!this.enabled) return;
        if (realDeltaSeconds <= 0) return;

        for (const obj of this.objects) {
            if (!(obj.speed > 0) || !Number.isFinite(obj.heading)) continue;

            const distanceKm = (obj.speed / 3600) * realDeltaSeconds;
            const next = movePosition(
                obj.position.latitude, obj.position.longitude, obj.heading, distanceKm
            );
            obj.position.latitude = next.latitude;
            obj.position.longitude = next.longitude;

            this._recordTrailPoint(obj);
        }
    }

    /** Erklärt leere/eingeschränkte Abdeckung statt stillschweigend leer zu bleiben. */
    statusText() {
        if (!this.available) {
            return this.lastError || "ÖPNV-Server nicht erreichbar.";
        }
        const coverage = this.cities.map(c => c.label).join(" · ");
        if (this.objects.length === 0) {
            return `Keine Fahrzeuge gemeldet (Abdeckung: ${coverage}).`;
        }
        return `Abdeckung: ${coverage} – anderswo bleibt die Ebene leer.`;
    }

    /* ═══════════ Aufräumen ═══════════ */

    clear() {
        this.stopPolling();
        super.clear();
    }
}
