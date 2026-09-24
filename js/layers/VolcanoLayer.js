/**
 * VolcanoLayer.js – Aktive & überwachte Vulkane weltweit.
 *
 * Statischer Layer analog InfrastructureLayer.js: handkuratierte Auswahl
 * bekannter Vulkane aus data/volcanoes.json.
 *
 * Quelle der Fakten: Smithsonian Global Volcanism Program
 * (https://volcano.si.edu) und ergänzend USGS Volcano Hazards Program
 * (https://www.usgs.gov/programs/VHP) – beides öffentlich, kein Key.
 * Reine Naturphänomene, kein Personenbezug.
 *
 * Aktivitätsstatus als Ampel, wie beim bestehenden Erdbeben-Layer:
 *   grün = ruhig · gelb = beobachtet · orange = erhöhte Aktivität ·
 *   rot = Ausbruch im Gange
 */

import { BaseLayer } from "./BaseLayer.js";
import { svgDataUri } from "../dataManager.js";

const STATUS_STYLE = {
    green:  { color: "#34d399", label: "Normal / ruhig" },
    yellow: { color: "#fbbf24", label: "Beobachtet" },
    orange: { color: "#fb923c", label: "Erhöhte Aktivität" },
    red:    { color: "#f87171", label: "Ausbruch im Gange" },
    default:{ color: "#a3a3a3", label: "Unbekannt" }
};

function markerSvg(color) {
    // Vulkankegel mit Krater – Farbe zeigt den Aktivitätsstatus
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
  <path d="M15 4 L26 25 L4 25 Z" fill="${color}" stroke="#111" stroke-width="1.2"/>
  <path d="M12 12 L18 12 L21 18 L9 18 Z" fill="#111"/>
</svg>`;
}

export class VolcanoLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "volcanoes",
            name: "Vulkane",
            icon: "🗻",
            type: "volcano",
            dataUrl: "./data/volcanoes.json"
        });

        this._icons = {};
        for (const [key, style] of Object.entries(STATUS_STYLE)) {
            this._icons[key] = svgDataUri(markerSvg(style.color));
        }
    }

    static statusLabel(status) {
        return (STATUS_STYLE[status] ?? STATUS_STYLE.default).label;
    }

    createEntity(obj) {
        const status = obj.metadata.status ?? "default";
        const style = STATUS_STYLE[status] ?? STATUS_STYLE.default;
        const icon = this._icons[status] ?? this._icons.default;
        const critical = status === "red" || status === "orange";

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: icon,
                width: 28,
                height: 28,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 8e6, 0.35),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(obj.name, Cesium.Color.fromCssColorString(style.color)),
                scaleByDistance: new Cesium.NearFarScalar(5e4, 1.0, 4e6, critical ? 0.35 : 0.0)
            }
        });
    }
}
