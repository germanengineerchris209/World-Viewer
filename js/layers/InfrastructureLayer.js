/**
 * InfrastructureLayer.js – Öffentliche Infrastruktur & Sehenswürdigkeiten.
 *
 * Statischer Layer: Flughäfen, Häfen, Bahnhöfe, Kraftwerke,
 * Sehenswürdigkeiten … aus data/infrastructure.json.
 * Jede Kategorie bekommt ein eigenes Symbol/Farbe.
 */

import { BaseLayer } from "./BaseLayer.js";
import { svgDataUri } from "../dataManager.js";

// Symbole je Kategorie (einfache SVG-Kreise mit Emoji wären unscharf,
// deshalb klare geometrische Marker mit Kategorie-Farbe)
const CATEGORY_STYLE = {
    airport:    { color: "#fbbf24", label: "Flughafen" },
    port:       { color: "#60a5fa", label: "Hafen" },
    station:    { color: "#f472b6", label: "Bahnhof" },
    powerplant: { color: "#f87171", label: "Kraftwerk" },
    landmark:   { color: "#34d399", label: "Sehenswürdigkeit" },
    industry:   { color: "#a3a3a3", label: "Industrieanlage" },
    datacenter: { color: "#818cf8", label: "Rechenzentrum" },
    dam:        { color: "#22d3ee", label: "Staudamm" },
    default:    { color: "#e5e9f0", label: "Infrastruktur" }
};

function markerSvg(color) {
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <path d="M16 2 C10 2 5 7 5 13 C5 21 16 30 16 30 C16 30 27 21 27 13 C27 7 22 2 16 2 Z"
        fill="${color}" stroke="#111" stroke-width="1.2"/>
  <circle cx="16" cy="13" r="4.5" fill="#111"/>
</svg>`;
}

export class InfrastructureLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "infrastructure",
            name: "Infrastructure",
            icon: "🏗️",
            type: "infrastructure",
            dataUrl: "./data/infrastructure.json"
        });

        // Icon-URLs pro Kategorie vorbereiten (Caching)
        this._icons = {};
        for (const [key, style] of Object.entries(CATEGORY_STYLE)) {
            this._icons[key] = svgDataUri(markerSvg(style.color));
        }
    }

    static categoryLabel(category) {
        return (CATEGORY_STYLE[category] ?? CATEGORY_STYLE.default).label;
    }

    createEntity(obj) {
        const category = obj.metadata.category ?? "default";
        const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.default;
        const icon = this._icons[category] ?? this._icons.default;

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: icon,
                width: 26,
                height: 26,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 8e6, 0.35),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(obj.name, Cesium.Color.fromCssColorString(style.color)),
                scaleByDistance: new Cesium.NearFarScalar(5e4, 1.0, 4e6, 0.0)
            }
        });
    }
}
