/**
 * statusToast.js – kurzlebige, schließbare Hinweise unten links (WEB-159).
 *
 * Bisher landete jeder Ladefehler nur in der Konsole (siehe dataManager.js)
 * – für Nutzer:innen war "Quelle kaputt" nicht von "gerade nichts los"
 * unterscheidbar, beides zeigte einfach "0 Objekte". Dieses Modul macht
 * fehlgeschlagene und bewusst ausgelassene Datenquellen sichtbar, ohne
 * den Workflow zu unterbrechen (kein Modal, kein Blockieren der Karte).
 */

const AUTO_DISMISS_MS = { error: 9000, info: 5000 };
const MAX_VISIBLE = 4;
const DEDUPE_WINDOW_MS = 30000;

let container = null;
const recentMessages = new Map(); // message -> Zeitpunkt des letzten Anzeigens

function ensureContainer() {
    if (container && container.isConnected) return container;
    container = document.getElementById("status-toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "status-toast-container";
        (document.getElementById("main") ?? document.body).appendChild(container);
    }
    return container;
}

function show(message, type) {
    const now = Date.now();
    const last = recentMessages.get(message) ?? 0;
    if (now - last < DEDUPE_WINDOW_MS) return; // gleicher Hinweis kurz hintereinander (Polling) unterdrücken
    recentMessages.set(message, now);

    const root = ensureContainer();

    const toast = document.createElement("div");
    toast.className = `status-toast status-toast--${type}`;
    toast.innerHTML = `
        <span class="status-toast-icon" aria-hidden="true">${type === "error" ? "⚠️" : "ℹ️"}</span>
        <span class="status-toast-text"></span>
        <button type="button" class="status-toast-close" aria-label="Hinweis schließen">✕</button>`;
    toast.querySelector(".status-toast-text").textContent = message;

    const dismiss = () => {
        clearTimeout(timer);
        toast.classList.add("status-toast--leaving");
        setTimeout(() => toast.remove(), 200);
    };
    toast.querySelector(".status-toast-close").addEventListener("click", dismiss);

    root.appendChild(toast);
    while (root.children.length > MAX_VISIBLE) root.firstElementChild.remove();

    const timer = setTimeout(dismiss, AUTO_DISMISS_MS[type] ?? 6000);
    return toast;
}

/** Datenquelle fehlgeschlagen (HTTP-Fehler, Netzwerkfehler, kaputtes JSON). */
export function showLoadError(message) {
    show(message, "error");
}

/** Bewusst fehlende, optionale Quelle – dezenter Hinweis, kein Fehler. */
export function showLoadInfo(message) {
    show(message, "info");
}
