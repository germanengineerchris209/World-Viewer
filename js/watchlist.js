/**
 * watchlist.js – Beobachtungszonen (Geofences) und Ereignis-Alarme.
 *
 * Öffentliches Gotham-Feature nachgebaut, ohne neue Datenquellen: Es werden
 * ausschließlich die bereits geladenen, öffentlichen Live-Positionen aller
 * Layer (Flugzeuge, Schiffe, Satelliten, ...) genutzt. Der Nutzer zieht eine
 * Kreiszone auf die Karte; jedes Objekt wird bei jeder Prüfung gegen alle
 * Zonen gerechnet, um Ein-/Austritte als Alarm zu melden.
 */

import { haversineKm } from "./dataManager.js";

const STORAGE_KEY = "world-viewer-watchlist-zones";
const MAX_ALERTS = 200;

let zoneCounter = 0;

export class Watchlist {

    /**
     * @param {WorldViewer} worldViewer
     * @param {LayerManager} layerManager
     */
    constructor(worldViewer, layerManager) {
        this.worldViewer = worldViewer;
        this.layerManager = layerManager;

        this.zones = [];              // { id, name, lat, lon, radiusKm }
        this.alerts = [];             // { id, timestamp, zoneId, zoneName, objectId, objectName, objectType, event }
        this._presence = new Map();   // "zoneId:objectId" → true, wenn gerade innerhalb

        this.onAlert = null;          // (alert) => void, von der UI gesetzt
        this.onZonesChanged = null;   // () => void, von der UI gesetzt

        this.dataSource = new Cesium.CustomDataSource("watchlist-zones");
        this.worldViewer.viewer.dataSources.add(this.dataSource);

        this._loadZones();
    }

    /* ─────────── Zonen verwalten ─────────── */

    addZone({ name, lat, lon, radiusKm }) {
        const zone = {
            id: `zone-${Date.now()}-${zoneCounter++}`,
            name: (name ?? "").trim() || `Zone ${this.zones.length + 1}`,
            lat, lon,
            radiusKm: Math.max(1, Number(radiusKm) || 25)
        };
        this.zones.push(zone);
        this._renderZone(zone);
        this._saveZones();
        this.onZonesChanged?.();
        return zone;
    }

    removeZone(id) {
        const index = this.zones.findIndex(z => z.id === id);
        if (index < 0) return;
        this.zones.splice(index, 1);

        const entity = this.dataSource.entities.getById(id);
        if (entity) this.dataSource.entities.remove(entity);

        const prefix = `${id}:`;
        for (const key of this._presence.keys()) {
            if (key.startsWith(prefix)) this._presence.delete(key);
        }

        this._saveZones();
        this.onZonesChanged?.();
    }

    _renderZone(zone) {
        this.dataSource.entities.add({
            id: zone.id,
            position: Cesium.Cartesian3.fromDegrees(zone.lon, zone.lat),
            ellipse: {
                semiMinorAxis: zone.radiusKm * 1000,
                semiMajorAxis: zone.radiusKm * 1000,
                material: Cesium.Color.fromCssColorString("#fbbf24").withAlpha(0.12),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString("#fbbf24"),
                outlineWidth: 2,
                height: 0
            },
            label: {
                text: `🔔 ${zone.name}`,
                font: "12px 'SF Mono', Consolas, monospace",
                fillColor: Cesium.Color.fromCssColorString("#fbbf24"),
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: new Cesium.Cartesian2(0, -14),
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            }
        });
    }

    /* ─────────── Persistenz (localStorage) ─────────── */

    _saveZones() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.zones));
        } catch {
            // z.B. privater Modus ohne Storage-Zugriff – Zonen bleiben nur
            // für die laufende Sitzung erhalten.
        }
    }

    _loadZones() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            const zones = JSON.parse(raw);
            if (!Array.isArray(zones)) return;
            for (const zone of zones) {
                if (!zone?.id || !isFinite(zone.lat) || !isFinite(zone.lon)) continue;
                this.zones.push(zone);
                this._renderZone(zone);
            }
        } catch {
            // korrupte/alte Daten ignorieren, App bleibt funktionsfähig
        }
    }

    /* ─────────── Prüfung: Ein-/Austritte erkennen ─────────── */

    /** Gegen alle sichtbaren (eingeblendeten) Layer prüfen. */
    check() {
        if (this.zones.length === 0) return;

        const seenKeys = new Set();

        for (const layer of this.layerManager.getAll()) {
            if (!layer.enabled) continue;

            for (const obj of layer.objects) {
                for (const zone of this.zones) {
                    const key = `${zone.id}:${obj.id}`;
                    seenKeys.add(key);

                    const distanceKm = haversineKm(
                        zone.lat, zone.lon, obj.position.latitude, obj.position.longitude
                    );
                    const inside = distanceKm <= zone.radiusKm;
                    const wasInside = this._presence.get(key) ?? false;

                    if (inside && !wasInside) {
                        this._presence.set(key, true);
                        this._raise(zone, obj, "entered");
                    } else if (!inside && wasInside) {
                        this._presence.set(key, false);
                        this._raise(zone, obj, "exited");
                    }
                }
            }
        }

        // Objekte, die aus der Anzeige verschwunden sind (Layer ausgeblendet,
        // AIS-/ADS-B-Timeout …), aus dem Zustand entfernen, ohne einen
        // künstlichen "Austritt" zu melden.
        for (const key of this._presence.keys()) {
            if (!seenKeys.has(key)) this._presence.delete(key);
        }
    }

    _raise(zone, obj, event) {
        const alert = {
            id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
            zoneId: zone.id,
            zoneName: zone.name,
            objectId: obj.id,
            objectName: obj.metadata?.callsign || obj.name,
            objectType: obj.type,
            event
        };
        this.alerts.unshift(alert);
        this.alerts.length = Math.min(this.alerts.length, MAX_ALERTS);
        this.onAlert?.(alert);
    }

    clearAlerts() {
        this.alerts = [];
    }
}
