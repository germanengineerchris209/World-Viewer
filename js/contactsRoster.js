/**
 * contactsRoster.js – Kontakte-Liste: alle Objekte aktiver Layer im Radius
 * um das Kamerazentrum, nach Entfernung sortiert (WEB-91).
 *
 * Reine Auswertung der bereits geladenen, öffentlichen Positionen aller
 * Layer – keine neue Datenquelle, kein Personen-Tracking.
 */

import { haversineKm } from "./dataManager.js";

/** Peilung (initial bearing) in Grad, 0–360, von Punkt A nach Punkt B. */
export function bearingDeg(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x) * 180 / Math.PI;
    return (θ + 360) % 360;
}

export const DEFAULT_RADIUS_KM = 250;

export class ContactsRoster {

    /**
     * @param {WorldViewer} worldViewer
     * @param {LayerManager} layerManager
     */
    constructor(worldViewer, layerManager) {
        this.worldViewer = worldViewer;
        this.layerManager = layerManager;
        this.radiusKm = DEFAULT_RADIUS_KM;
        this.contacts = [];   // [{ object, distanceKm, bearingDeg }], nach Entfernung sortiert
    }

    /**
     * Liste neu berechnen: alle Objekte eingeschalteter Layer im Radius um
     * das Kamerazentrum (Blickpunkt).
     * @returns {Array<{object, distanceKm, bearingDeg}>}
     */
    recompute() {
        const center = this.worldViewer.getCameraPosition();
        if (!center) {
            this.contacts = [];
            return this.contacts;
        }

        const results = [];
        for (const layer of this.layerManager.getAll()) {
            if (!layer.enabled) continue;

            for (const obj of layer.objects) {
                const distanceKm = haversineKm(
                    center.latitude, center.longitude,
                    obj.position.latitude, obj.position.longitude
                );
                if (distanceKm > this.radiusKm) continue;

                results.push({
                    object: obj,
                    distanceKm,
                    bearingDeg: bearingDeg(
                        center.latitude, center.longitude,
                        obj.position.latitude, obj.position.longitude
                    )
                });
            }
        }

        results.sort((a, b) => a.distanceKm - b.distanceKm);
        this.contacts = results;
        return results;
    }

    setRadiusKm(radiusKm) {
        this.radiusKm = Math.max(1, Number(radiusKm) || DEFAULT_RADIUS_KM);
    }
}
