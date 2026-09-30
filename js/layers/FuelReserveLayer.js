/**
 * FuelReserveLayer.js – Öl-/Kraftstoffreserven der 20 größten Wirtschaftsländer.
 *
 * Vorbild: Neuseelands öffentliche Übersicht über Dieselreserven
 * ("Minimum Stockholding Obligation" – Füllstand in % und Tagen Reichweite).
 * Dieser Layer überträgt das Konzept auf Benzin, Diesel und Kerosin (Jet A-1)
 * für die wichtigsten Volkswirtschaften.
 *
 * Statischer Layer analog VolcanoLayer.js: handkuratierte Modelldaten aus
 * data/fuel-reserves.json. Es gibt keine einheitliche, live abfragbare
 * Quelle für produktscharfe Lagerbestände über alle Länder hinweg – die
 * Werte sind daher aus öffentlich bekannten Bevorratungspflichten
 * (IEA-90-Tage-Regel, nationale Mindestbevorratungsgesetze) abgeleitete
 * Modellwerte, kein amtlicher Echtzeit-Datensatz (siehe Feld "info" je Land).
 *
 * Marker-Farbe zeigt den niedrigsten Füllstand der drei Kraftstoffe eines
 * Landes als Ampel – so fallen Länder mit angespannter Versorgungslage
 * sofort auf.
 */

import { BaseLayer } from "./BaseLayer.js";
import { svgDataUri } from "../dataManager.js";

export const FUEL_TYPES = ["gasoline", "diesel", "kerosene"];

const FILL_BANDS = [
    { min: 80, color: "#34d399", label: "Gut gefüllt" },
    { min: 60, color: "#a3e635", label: "Ausreichend" },
    { min: 40, color: "#fbbf24", label: "Angespannt" },
    { min: 20, color: "#fb923c", label: "Knapp" },
    { min: -Infinity, color: "#f87171", label: "Kritisch" }
];

export function fillBandFor(percent) {
    return FILL_BANDS.find(b => percent >= b.min) ?? FILL_BANDS[FILL_BANDS.length - 1];
}

/** Niedrigster Füllstand der drei Kraftstoffe – bestimmt die Ampelfarbe des Landes. */
export function lowestFillPercent(obj) {
    return Math.min(...FUEL_TYPES.map(f => obj[f]?.fillPercent ?? 100));
}

function markerSvg(color) {
    // Kanister-Silhouette – Farbe zeigt den knappsten Kraftstoff-Füllstand
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
  <rect x="5" y="9" width="16" height="14" rx="2" fill="${color}" stroke="#111" stroke-width="1.2"/>
  <rect x="9" y="4" width="8" height="6" rx="1.5" fill="${color}" stroke="#111" stroke-width="1.2"/>
  <rect x="7" y="13" width="12" height="3" fill="#111" fill-opacity="0.35"/>
</svg>`;
}

export class FuelReserveLayer extends BaseLayer {

    constructor(worldViewer) {
        super(worldViewer, {
            id: "fuelReserves",
            name: "Kraftstoffreserven",
            icon: "⛽",
            type: "fuelReserve",
            dataUrl: "./data/fuel-reserves.json"
        });

        this._icons = new Map();
    }

    _iconFor(color) {
        if (!this._icons.has(color)) this._icons.set(color, svgDataUri(markerSvg(color)));
        return this._icons.get(color);
    }

    createEntity(obj) {
        const percent = lowestFillPercent(obj.metadata);
        const band = fillBandFor(percent);

        return this.dataSource.entities.add({
            id: obj.id,
            position: Cesium.Cartesian3.fromDegrees(
                obj.position.longitude, obj.position.latitude, obj.position.altitude
            ),
            billboard: {
                image: this._iconFor(band.color),
                width: 24,
                height: 24,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                scaleByDistance: new Cesium.NearFarScalar(1e4, 1.0, 8e6, 0.4),
                disableDepthTestDistance: Number.POSITIVE_INFINITY
            },
            label: {
                ...this._makeLabel(`${obj.name} · ${Math.round(percent)} %`, Cesium.Color.fromCssColorString(band.color)),
                scaleByDistance: new Cesium.NearFarScalar(5e4, 1.0, 5e6, 0.0)
            }
        });
    }
}
