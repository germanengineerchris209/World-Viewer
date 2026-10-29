/**
 * shareLink.js – Kamera, aktive Layer und Basemap als Link teilbar machen.
 *
 * Idee aus "God's Eye View" (Bilawal Sidhu, MIT-Lizenz) übernommen: die
 * URL kodiert den Blickpunkt, nicht nur ein Lesezeichen. Alles läuft
 * rein clientseitig über URL-Suchparameter, kein Server nötig.
 *
 * Format: ?lon=..&lat=..&h=..&heading=..&pitch=..&roll=..
 *         &layers=aircraft,ships,...&basemap=hybrid
 *
 * Der Szenen-Regisseur (sceneDirector.js, WEB-92) nutzt für "Speichern/
 * Laden" einer Kamerafahrt denselben URL-Mechanismus (Parameter `scene`,
 * siehe encodeScene/buildSceneShareUrl unten), statt ein zweites
 * Serialisierungsformat oder einen Server-Endpunkt zu bauen.
 */

/**
 * Kamera + aktive Layer in reiner Objektform lesen/anwenden – von
 * buildShareUrl/applyShareLinkFromUrl unten UND von session.js (WEB-161,
 * automatische Sitzungssicherung) genutzt, damit es nur eine Kodierlogik
 * für "welche Ansicht ist das" gibt.
 */

/** Liest die aktuelle Kamera, oder null, falls (noch) keine Position vorliegt. */
export function getCameraState(worldViewer) {
    const pos = worldViewer.getCameraPosition();
    const rot = worldViewer.getCameraOrientation();
    if (!pos || !rot) return null;
    return {
        longitude: pos.longitude,
        latitude: pos.latitude,
        height: pos.height,
        heading: rot.heading,
        pitch: rot.pitch,
        roll: rot.roll
    };
}

/** Setzt die Kamera aus einem von getCameraState() gelieferten Objekt. */
export function applyCameraState(worldViewer, camera) {
    if (!camera || !Number.isFinite(camera.longitude) || !Number.isFinite(camera.latitude) || !Number.isFinite(camera.height)) return;
    worldViewer.setCameraView({
        longitude: camera.longitude,
        latitude: camera.latitude,
        height: camera.height,
        heading: camera.heading || 0,
        pitch: camera.pitch || -90,
        roll: camera.roll || 0
    });
}

/** IDs der aktuell aktiven Layer. */
export function getActiveLayerIds(layerManager) {
    return layerManager.getAll().filter(layer => layer.enabled).map(layer => layer.id);
}

/** Schaltet genau die übergebenen Layer-IDs ein, alle anderen aus. */
export function applyActiveLayerIds(layerManager, ids) {
    const wanted = new Set(ids);
    for (const layer of layerManager.getAll()) {
        if (wanted.has(layer.id) !== layer.enabled) layer.toggle();
    }
}

/** Baut die aktuelle Ansicht als teilbare URL. */
export function buildShareUrl(worldViewer, layerManager) {
    const camera = getCameraState(worldViewer);
    const params = new URLSearchParams();

    if (camera) {
        params.set("lon", camera.longitude.toFixed(6));
        params.set("lat", camera.latitude.toFixed(6));
        params.set("h", Math.round(camera.height));
        params.set("heading", Math.round(camera.heading));
        params.set("pitch", Math.round(camera.pitch));
        params.set("roll", Math.round(camera.roll));
    }

    const activeLayers = getActiveLayerIds(layerManager);
    if (activeLayers.length) params.set("layers", activeLayers.join(","));

    const basemapId = worldViewer.basemaps?.currentId;
    if (basemapId) params.set("basemap", basemapId);

    const url = new URL(window.location.href);
    url.search = params.toString();
    return url.toString();
}

/** Wendet eine geteilte URL beim Start an (falls Parameter vorhanden). */
export async function applyShareLinkFromUrl(worldViewer, layerManager) {
    const params = new URLSearchParams(window.location.search);
    if (![...params.keys()].length) return false;

    applyCameraState(worldViewer, {
        longitude: parseFloat(params.get("lon")),
        latitude: parseFloat(params.get("lat")),
        height: parseFloat(params.get("h")),
        heading: parseFloat(params.get("heading")),
        pitch: parseFloat(params.get("pitch")),
        roll: parseFloat(params.get("roll"))
    });

    const basemapId = params.get("basemap");
    if (basemapId) await worldViewer.basemaps.setBasemap(basemapId);

    const layersParam = params.get("layers");
    if (layersParam !== null) {
        applyActiveLayerIds(layerManager, layersParam.split(",").filter(Boolean));
    }

    return true;
}

/* ───────────── Szenen-Regisseur: Kamerafahrt speichern/laden (WEB-92) ─────────────
 *
 * Eine Fahrt ist nur eine Liste von Stationen (Position+Blick+Haltedauer).
 * Statt dafür eine Export-Datei/ein eigenes JSON-Format einzuführen, wird
 * sie – genau wie die normale Kameraansicht oben – kompakt in einen
 * URL-Parameter kodiert. "Speichern" erzeugt einen Link, "Laden" liest ihn
 * wieder aus (eingegeben oder weil er beim Start in der Adresszeile steht).
 */

/** Kodiert eine Stationenliste kompakt (Array aus Zahlen-Arrays statt Objekten). */
export function encodeScene(stations) {
    const round = (n, decimals) => Math.round(n * 10 ** decimals) / 10 ** decimals;
    const compact = stations.map(s => [
        round(s.longitude, 6), round(s.latitude, 6), Math.round(s.height),
        Math.round(s.heading ?? 0), Math.round(s.pitch ?? -90), Math.round(s.roll ?? 0),
        s.holdSeconds ?? 0
    ]);
    return btoa(JSON.stringify(compact));
}

/** Kehrt encodeScene() um. Wirft bei kaputten/fremden Eingaben. */
export function decodeScene(encoded) {
    const compact = JSON.parse(atob(encoded));
    if (!Array.isArray(compact)) throw new Error("Szenen-Daten sind kein Array.");
    return compact.map(([longitude, latitude, height, heading, pitch, roll, holdSeconds]) => ({
        longitude, latitude, height, heading, pitch, roll, holdSeconds
    }));
}

/** Baut eine teilbare URL für eine aufgezeichnete Kamerafahrt. */
export function buildSceneShareUrl(stations) {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);
    params.set("scene", encodeScene(stations));
    url.search = params.toString();
    return url.toString();
}

/** Liest eine Fahrt aus einer URL (Standard: die aktuelle Adresse), falls vorhanden. */
export function readSceneFromUrl(url = window.location.href) {
    const params = new URLSearchParams(new URL(url, window.location.href).search);
    const raw = params.get("scene");
    if (!raw) return null;
    try {
        const stations = decodeScene(raw);
        return stations.length ? stations : null;
    } catch {
        return null;
    }
}
