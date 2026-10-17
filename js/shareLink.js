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
