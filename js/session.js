/**
 * session.js – Sitzung automatisch sichern und wiederherstellen (WEB-161).
 *
 * Speichert aktive Layer, Kameraposition und offene Panels unter
 * `wv-session-v1` in localStorage, damit ein Reload (F5) die Ansicht
 * zurückbringt, ohne dass man sich 32 Layer von Hand neu zusammenklickt.
 *
 * Kamera + Layer nutzen dieselbe Kodierlogik wie shareLink.js (nur ohne
 * URL/Base64-Umweg, da localStorage normales JSON kann) – ein Share-Link
 * in der Adresszeile hat beim Start immer Vorrang vor der gespeicherten
 * Sitzung, siehe app.js.
 */

import { getCameraState, applyCameraState, getActiveLayerIds, applyActiveLayerIds } from "./shareLink.js";

const STORAGE_KEY = "wv-session-v1";
const SAVE_DEBOUNCE_MS = 1500;

/** Liest die gespeicherte Sitzung, oder null, falls keine vorhanden/kaputt ist. */
export function loadSession() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const state = JSON.parse(raw);
        return state && typeof state === "object" ? state : null;
    } catch {
        return null;
    }
}

/** Löscht die gespeicherte Sitzung (Bedienelement "Sitzung zurücksetzen"). */
export function clearSession() {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch { /* localStorage blockiert – nichts zu löschen */ }
}

/** Wendet eine gespeicherte Sitzung auf Kamera, Layer und Panels an. */
export function applySessionState(state, worldViewer, layerManager, panelDock) {
    if (!state) return;
    applyCameraState(worldViewer, state.camera);
    if (Array.isArray(state.layers)) applyActiveLayerIds(layerManager, state.layers);
    if (Array.isArray(state.panels)) panelDock?.openPanels(state.panels);
}

/**
 * Baut einen entprellten Speicher-Aufruf: schedule() merkt sich den
 * aktuellen Zustand erst `SAVE_DEBOUNCE_MS` nach dem letzten Aufruf,
 * statt bei jeder Kamerabewegung zu schreiben.
 */
export function createSessionSaver(worldViewer, layerManager, panelDock) {
    let timer = null;

    function flush() {
        timer = null;
        const state = {
            v: 1,
            camera: getCameraState(worldViewer),
            layers: getActiveLayerIds(layerManager),
            panels: panelDock?.getOpenPanelIds() ?? []
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch { /* localStorage voll/blockiert – Sitzung bleibt diesmal ungesichert */ }
    }

    function schedule() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
    }

    return { schedule };
}
