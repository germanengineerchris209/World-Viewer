/**
 * linkAnalysis.js – Verknüpfungen zwischen Objekten ("Link Analysis").
 *
 * Öffentliches Gotham-Feature nachgebaut: Zu einem ausgewählten Objekt
 * werden verwandte Objekte gefunden – über gemeinsame Attribute (z.B.
 * gleiche Airline, gleicher Betreiber, gleiche Flagge) und über räumliche
 * Nähe. Reine Auswertung der bereits geladenen, öffentlichen Daten aller
 * Layer – keine neue Datenquelle.
 */

import { haversineKm } from "./dataManager.js";

const MAX_LINKS = 8;
const MAX_ATTRIBUTE_LINKS = 5;
const NEARBY_RADIUS_KM = 30;

/** Welche Metadaten-Felder pro Typ als "gemeinsames Merkmal" zählen. */
const ATTRIBUTE_FIELDS = {
    aircraft: [{ field: "airline", label: "Airline" }],
    ship: [
        { field: "shipType", label: "Schiffstyp" },
        { field: "flag", label: "Flagge" }
    ],
    satellite: [{ field: "operator", label: "Betreiber" }],
    infrastructure: [{ field: "category", label: "Kategorie" }],
    launch: [{ field: "provider", label: "Betreiber" }],
    cable: [{ field: "operators", label: "Betreiber" }]
};

/**
 * Findet verwandte Objekte für ein ausgewähltes Objekt.
 * @param {object} object          normalisiertes Objekt (siehe dataManager.js)
 * @param {LayerManager} layerManager
 * @returns {Array<{object, reason}>}
 */
export function findLinkedObjects(object, layerManager) {
    const candidates = layerManager.getAllObjects().filter(o => o.id !== object.id);
    const results = [];
    const seen = new Set();

    const add = (candidate, reason) => {
        if (seen.has(candidate.id)) return;
        seen.add(candidate.id);
        results.push({ object: candidate, reason });
    };

    // 1. Gemeinsame Attribute (gleiche Airline, gleicher Betreiber, ...)
    const fields = ATTRIBUTE_FIELDS[object.type] ?? [];
    for (const { field, label } of fields) {
        const value = object.metadata?.[field];
        if (!value) continue;

        const matches = candidates.filter(o =>
            o.type === object.type && o.metadata?.[field] === value
        );
        for (const match of matches.slice(0, MAX_ATTRIBUTE_LINKS)) {
            add(match, `${label}: ${value}`);
            if (results.length >= MAX_LINKS) return results;
        }
    }

    // 2. Räumliche Nähe (unabhängig vom Typ)
    const nearby = candidates
        .map(o => ({
            object: o,
            distanceKm: haversineKm(
                object.position.latitude, object.position.longitude,
                o.position.latitude, o.position.longitude
            )
        }))
        .filter(({ distanceKm }) => distanceKm <= NEARBY_RADIUS_KM)
        .sort((a, b) => a.distanceKm - b.distanceKm);

    for (const { object: candidate, distanceKm } of nearby) {
        add(candidate, `${distanceKm < 1
            ? Math.round(distanceKm * 1000) + " m"
            : distanceKm.toFixed(1) + " km"} entfernt`);
        if (results.length >= MAX_LINKS) break;
    }

    return results;
}
