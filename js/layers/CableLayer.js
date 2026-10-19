/**
 * CableLayer.js – Unterseekabel (statisch).
 *
 * Zwei additive Quellen:
 *  - data/cables.json: Handkuratierte, bekannte Seekabel (Wikipedia je Kabel).
 *  - data/cables-osm.json: Massendatensatz aus OpenStreetMap (ODbL), erzeugt
 *    von scripts/build-infrastructure-mass.mjs (WEB-100).
 * Bewusst KEINE Übernahme der (CC BY-NC-SA-lizenzierten) TeleGeography-
 * Kartengeometrie – weder hier noch im Massendatensatz, siehe DATENQUELLEN.md.
 * Bei hunderten Kabeln bündelt BaseLayer.enableClustering gleich dicht
 * beieinanderliegende Landepunkte zu einem Symbol mit Anzahl.
 */

import { BaseLayer } from "./BaseLayer.js";
import { loadJSON, loadJSONOptional, normalizeRecord, svgDataUri } from "../dataManager.js";

const CABLE_COLOR = "#a78bfa";
const MASS_SOURCE_URL = "./data/cables-osm.json";

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

        // Hunderte Kabel+Landepunkte würden ohne Bündelung die Framerate
        // einbrechen lassen – siehe WEB-100 Abnahme (fps-Messung).
        this.enableClustering({ pixelRange: 55, minimumClusterSize: 10, color: CABLE_COLOR });
    }

    async load() {
        this.objects = [];
        const curated = await loadJSON(this.dataUrl);
        const mass = await loadJSONOptional(MASS_SOURCE_URL);
        const records = [...curated, ...(mass.items ?? [])];
        for (const raw of records) {
            const obj = this._normalize(raw);
            const entity = this.createEntity(obj);
            if (entity) {
                entity.worldViewerObject = obj;
                this.entityById.set(obj.id, entity);
            }
            this._addLandingMarkers(obj);
            this.objects.push(obj);
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

    /**
     * Kleine Marker an den beiden Kabelenden, anklickbar wie das Kabel
     * selbst. Nur Anfang+Ende, nicht jeder Stützpunkt – die OSM-Trassen im
     * Massendatensatz haben teils dutzende Zwischenknoten, die sonst als
     * eigene Billboards gerendert würden (siehe WEB-100 Performance-Abnahme).
     */
    _addLandingMarkers(obj) {
        const allPoints = obj.metadata.landingPoints ?? [];
        const points = allPoints.length <= 2 ? allPoints : [allPoints[0], allPoints[allPoints.length - 1]];
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
