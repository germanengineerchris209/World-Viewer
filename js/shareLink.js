/**
 * shareLink.js – Kamera, aktive Layer und Basemap als Link teilbar machen.
 *
 * Idee aus "God's Eye View" (Bilawal Sidhu, MIT-Lizenz) übernommen: die
 * URL kodiert den Blickpunkt, nicht nur ein Lesezeichen. Alles läuft
 * rein clientseitig über URL-Suchparameter, kein Server nötig.
 *
 * Format: ?lon=..&lat=..&h=..&heading=..&pitch=..&roll=..
 *         &layers=aircraft,ships,...&basemap=hybrid
 */

/** Baut die aktuelle Ansicht als teilbare URL. */
export function buildShareUrl(worldViewer, layerManager) {
    const pos = worldViewer.getCameraPosition();
    const rot = worldViewer.getCameraOrientation();
    const params = new URLSearchParams();

    if (pos) {
        params.set("lon", pos.longitude.toFixed(6));
        params.set("lat", pos.latitude.toFixed(6));
        params.set("h", Math.round(pos.height));
    }
    if (rot) {
        params.set("heading", Math.round(rot.heading));
        params.set("pitch", Math.round(rot.pitch));
        params.set("roll", Math.round(rot.roll));
    }

    const activeLayers = layerManager.getAll()
        .filter(layer => layer.enabled)
        .map(layer => layer.id);
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

    const lon = parseFloat(params.get("lon"));
    const lat = parseFloat(params.get("lat"));
    const height = parseFloat(params.get("h"));
    if (Number.isFinite(lon) && Number.isFinite(lat) && Number.isFinite(height)) {
        worldViewer.setCameraView({
            longitude: lon,
            latitude: lat,
            height,
            heading: parseFloat(params.get("heading")) || 0,
            pitch: parseFloat(params.get("pitch")) || -90,
            roll: parseFloat(params.get("roll")) || 0
        });
    }

    const basemapId = params.get("basemap");
    if (basemapId) await worldViewer.basemaps.setBasemap(basemapId);

    const layersParam = params.get("layers");
    if (layersParam !== null) {
        const wanted = new Set(layersParam.split(",").filter(Boolean));
        for (const layer of layerManager.getAll()) {
            if (wanted.has(layer.id) !== layer.enabled) layer.toggle();
        }
    }

    return true;
}
