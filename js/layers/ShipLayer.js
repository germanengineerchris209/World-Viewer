/**
 * ShipLayer.js – Schiffe (AIS-ähnliche Daten).
 *
 * Phase 1: Daten aus data/ships.json + langsame Bewegungssimulation.
 * Später: echte AIS-Daten (z.B. aisstream.io per WebSocket) in load()
 * bzw. über einen Live-Feed anbinden.
 */

import { BaseLayer } from "./BaseLayer.js";
import { movePosition, svgDataUri } from "../dataManager.js";

// Schiffssymbol (Pfeilform, Spitze = Fahrtrichtung/Norden)
const SHIP_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
  <path d="M18 4 L26 26 L18 22 L10 26 Z"
        fill="#4ade80" stroke="#0b2b16" stroke-width="1.2"/>
</svg>`;

export class ShipLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "ships",
            name: "Ships",
            icon: "🚢",
            type: "ship",
            dataUrl: "./data/ships.json"
        });
        this._iconUrl = svgDataUri(SHIP_SVG);
    }

    createEntity(obj) {
        return this.dataSource.entities.add({
            id: obj.id,
            position: new Cesium.CallbackProperty(() =>
                Cesium.Cartesian3.fromDegrees(
                    obj.position.longitude,
                    obj.position.latitude,
                    0
                ), false),
            billboard: {
                image: this._iconUrl,
                width: 24,
                height: 24,
                rotation: new Cesium.CallbackProperty(
                    () => Cesium.Math.toRadians(-(obj.heading ?? 0)), false),
                alignedAxis: Cesium.Cartesian3.UNIT_Z,
                verticalOrigin: Cesium.VerticalOrigin.CENTER,
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 1.2e7, 0.4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: this._makeLabel(obj.name, Cesium.Color.fromCssColorString("#4ade80"))
        });
    }

    /** Schiffe bewegen sich mit ihrer Geschwindigkeit (Knoten → km/h). */
    update(simDeltaSeconds) {
        if (!this.enabled || simDeltaSeconds <= 0) return;

        for (const obj of this.objects) {
            const speedKnots = obj.speed || 0;   // Schiffe: Speed in Knoten
            if (speedKnots <= 0) continue;

            const speedKmh = speedKnots * 1.852;
            const distanceKm = (speedKmh / 3600) * simDeltaSeconds;
            const next = movePosition(
                obj.position.latitude,
                obj.position.longitude,
                obj.heading,
                distanceKm
            );
            obj.position.latitude = next.latitude;
            obj.position.longitude = next.longitude;
        }
    }
}
