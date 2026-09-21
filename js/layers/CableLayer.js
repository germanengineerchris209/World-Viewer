/**
 * CableLayer.js – Unterseekabel (statisch).
 *
 * Handkuratierte Auswahl bekannter Seekabel aus data/cables.json,
 * belegt über öffentlich zugängliche Quellen (Wikipedia je Kabel).
 * Bewusst KEINE Übernahme der (CC BY-NC-SA-lizenzierten) TeleGeography-
 * Kartengeometrie: die Trassen hier sind vereinfachte Geodäten zwischen
 * den dokumentierten Landepunkten, keine echten Kabelrouten.
 */

import { BaseLayer } from "./BaseLayer.js";
import { loadJSON, normalizeRecord, svgDataUri } from "../dataManager.js";

const CABLE_COLOR = "#a78bfa";

const LANDING_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14">
  <circle cx="7" cy="7" r="5" fill="${CABLE_COLOR}" stroke="#1e1b4b" stroke-width="1.5"/>
</svg>`;

export class CableLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "cables",
            name: "Seekabel",
            icon: "🔌",
            type: "cable",
            dataUrl: "./data/cables.json"
        });
        this._landingIcon = svgDataUri(LANDING_SVG);
    }

    async load() {
        const raw = await loadJSON(this.dataUrl);
        this.objects = raw.map(r => this._normalize(r));
        for (const obj of this.objects) {
            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
            }
            this._addLandingMarkers(obj);
        }
        console.info(`[${this.name}] ${this.objects.length} Kabel geladen.`);
    }

    /** Position des Objekts = mittlerer Landepunkt (für Suche & Nähe-Analyse). */
    _normalize(raw) {
        const points = raw.landingPoints ?? [];
        const mid = points[Math.floor(points.length / 2)] ?? { latitude: 0, longitude: 0 };
        return normalizeRecord({ ...raw, latitude: mid.latitude, longitude: mid.longitude, altitude: 0 }, "cable");
    }

    createEntity(obj) {
        const points = obj.metadata.landingPoints ?? [];
        if (points.length < 2) return null;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(obj.position.longitude, obj.position.latitude, 0),
            polyline: {
                positions: points.map(p => Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, 0)),
                width: 2,
                material: new Cesium.PolylineDashMaterialProperty({
                    color: Cesium.Color.fromCssColorString(CABLE_COLOR).withAlpha(0.85),
                    dashLength: 12
                }),
                arcType: Cesium.ArcType.GEODESIC,
                clampToGround: true
            },
            label: {
                ...this._makeLabel(obj.name, Cesium.Color.fromCssColorString(CABLE_COLOR)),
                scaleByDistance: new Cesium.NearFarScalar(1e5, 1.0, 6e6, 0.0)
            }
        });
    }

    /** Kleine Marker an jedem Landepunkt, anklickbar wie das Kabel selbst. */
    _addLandingMarkers(obj) {
        const points = obj.metadata.landingPoints ?? [];
        points.forEach((p, idx) => {
            const marker = this.dataSource.entities.add({
                id: `${obj.id}-landing-${idx}`,
                position: Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude, 0),
                billboard: {
                    image: this._landingIcon,
                    width: 10,
                    height: 10,
                    verticalOrigin: Cesium.VerticalOrigin.CENTER,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY,
                    scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 5e6, 0.4)
                }
            });
            marker.worldViewerObject = obj;
        });
    }
}
