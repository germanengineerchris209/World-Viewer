/**
 * cameraViewshed.js – Sichtfeld-Kegel für Kameras (WEB-72).
 *
 * Rein visuelle Ergänzung zum Kamera-Layer: Beim Öffnen des Detailpanels
 * einer Kamera mit hinterlegtem `heading` wird ein Sektor (Blickrichtung +
 * Öffnungswinkel + Reichweite) auf den Globus gezeichnet – analog zu den
 * Geofence-Kreisen in watchlist.js, nur als Kreissektor statt Vollkreis.
 *
 * Keine neue Datenquelle: `heading`, `fovDegrees`, `rangeMeters` sind
 * optionale Felder in data/cameras.json. Fehlt `heading`, bleibt die
 * Kamera wie bisher ohne Kegel.
 */

import { movePosition } from "./dataManager.js";

const ENTITY_ID = "camera-viewshed-cone";
const DEFAULT_FOV_DEGREES = 60;
const DEFAULT_RANGE_METERS = 300;

export class CameraViewshed {

    /** @param {WorldViewer} worldViewer */
    constructor(worldViewer) {
        this.worldViewer = worldViewer;
        this.dataSource = new Cesium.CustomDataSource("camera-viewshed");
        this.worldViewer.viewer.dataSources.add(this.dataSource);
    }

    /**
     * Zeigt den Sichtkegel für `object`, falls es eine Kamera mit
     * hinterlegtem `heading`-Feld ist – sonst wird ein evtl. vorhandener
     * Kegel entfernt (z.B. beim Wechsel auf eine Kamera ohne heading).
     */
    show(object) {
        this.hide();
        if (!object || object.type !== "camera") return;

        // Bewusst metadata.heading prüfen, nicht object.heading: Letzteres
        // normalisiert fehlende Werte auf 0, was von "Norden, 0°" nicht
        // unterscheidbar wäre.
        const heading = object.metadata?.heading;
        if (heading == null || Number.isNaN(Number(heading))) return;

        const fovDegrees = Math.min(359, Math.max(1, Number(object.metadata.fovDegrees) || DEFAULT_FOV_DEGREES));
        const rangeMeters = Math.max(1, Number(object.metadata.rangeMeters) || DEFAULT_RANGE_METERS);

        this.dataSource.entities.add(this._buildSector(object, heading, fovDegrees, rangeMeters));
    }

    /** Entfernt den Sichtkegel, falls einer angezeigt wird. */
    hide() {
        this.dataSource.entities.removeById(ENTITY_ID);
    }

    _buildSector(object, heading, fovDegrees, rangeMeters) {
        const { latitude, longitude } = object.position;
        const rangeKm = rangeMeters / 1000;

        const segments = Math.min(48, Math.max(8, Math.round(fovDegrees / 5)));
        const startAngle = heading - fovDegrees / 2;
        const stepAngle = fovDegrees / segments;

        const coords = [longitude, latitude];
        for (let i = 0; i <= segments; i++) {
            const angle = (startAngle + i * stepAngle + 360) % 360;
            const p = movePosition(latitude, longitude, angle, rangeKm);
            coords.push(p.longitude, p.latitude);
        }

        return {
            id: ENTITY_ID,
            polygon: {
                hierarchy: Cesium.Cartesian3.fromDegreesArray(coords),
                material: Cesium.Color.fromCssColorString("#c084fc").withAlpha(0.22),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString("#c084fc"),
                outlineWidth: 2,
                height: 0,
                arcType: Cesium.ArcType.GEODESIC
            }
        };
    }
}
