/**
 * shipData.js – Bezugsquelle für Schiffsdaten.
 *
 * Reihenfolge:
 *   1. Live-AIS-Daten über den eigenen Server (/api/ships)
 *      → dieser hält eine dauerhafte WebSocket-Verbindung zu AISStream.io
 *   2. Fällt der Server aus oder ist kein AISSTREAM_API_KEY gesetzt:
 *      Demo-Daten aus data/ships.json mit der bisherigen Simulation
 *
 * Warum nicht direkt aus dem Browser? AISStream sendet keine CORS-Header
 * für einen normalen WebSocket, und der API-Schlüssel gehört ohnehin
 * nicht in den Browser.
 */

import { loadJSON } from "./dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.ships ?? {};

export class ShipDataSource {

    constructor() {
        /** "live" | "demo" | "unknown" */
        this.mode = "unknown";
        this.sourceName = "";
        this.lastError = "";
        this.lastFetchAt = 0;
        this._statusChecked = false;
    }

    get baseUrl() {
        return CFG().apiUrl || "/api/ships";
    }

    /** Prüft einmalig, ob der Server Live-AIS-Daten liefern kann. */
    async checkAvailability() {
        if (CFG().mode === "demo") {
            this.mode = "demo";
            this.sourceName = "Demo-Daten";
            this._statusChecked = true;
            return this.mode;
        }

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2500);
            const res = await fetch(`${this.baseUrl}/status`, { signal: controller.signal });
            clearTimeout(timer);

            if (!res.ok) throw new Error(String(res.status));
            const status = await res.json();

            if (status.configured) {
                this.mode = "live";
                this.sourceName = "AISStream (AIS)";
            } else {
                this.mode = "demo";
                this.sourceName = "Demo-Daten";
                this.lastError = "Server läuft, aber AISSTREAM_API_KEY ist nicht gesetzt.";
            }
        } catch {
            this.mode = "demo";
            this.sourceName = "Demo-Daten";
            this.lastError = "Kein Server für Live-Daten erreichbar "
                + "(node server/server.mjs starten).";
        }

        this._statusChecked = true;
        return this.mode;
    }

    /**
     * Holt die aktuell bekannten Schiffe, optional für einen Kartenausschnitt.
     *
     * @param {{north:number, south:number, west:number, east:number}|null} bounds
     * @returns {Promise<{ships:Array, fetchedAt:number}|null>}
     *          null, wenn keine Live-Daten verfügbar sind
     */
    async fetchLive(bounds) {
        if (!this._statusChecked) await this.checkAvailability();
        if (this.mode !== "live") return null;

        const url = new URL(this.baseUrl, window.location.origin);
        if (bounds) {
            url.searchParams.set("north", bounds.north.toFixed(4));
            url.searchParams.set("south", bounds.south.toFixed(4));
            url.searchParams.set("west", bounds.west.toFixed(4));
            url.searchParams.set("east", bounds.east.toFixed(4));
        }
        const limit = CFG().maxShips;
        if (limit) url.searchParams.set("limit", String(limit));

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12_000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timer);

            const data = await res.json();

            if (!res.ok) {
                this.lastError = data.error ?? `Fehler ${res.status}`;
                return null;
            }

            this.lastError = "";
            this.lastFetchAt = data.fetchedAt ?? Date.now();

            return {
                ships: data.ships ?? [],
                fetchedAt: this.lastFetchAt
            };

        } catch (err) {
            this.lastError = err.name === "AbortError"
                ? "Zeitüberschreitung beim Abruf der Schiffsdaten."
                : `Schiffsdaten nicht erreichbar: ${err.message}`;
            return null;
        }
    }

    /** Lädt die Demo-Daten aus data/ships.json. */
    async fetchDemo() {
        const raw = await loadJSON(CFG().demoUrl || "./data/ships.json");
        return raw.map(s => ({
            id: s.id,
            name: s.name,
            latitude: s.latitude,
            longitude: s.longitude,
            speed: s.speed,
            heading: s.heading,
            mmsi: s.mmsi ?? "",
            shipType: s.shipType ?? "",
            flag: s.flag ?? "",
            destination: s.destination ?? "",
            wikipedia: s.wikipedia ?? "",
            timestamp: Date.now()
        }));
    }
}
