/**
 * flightData.js – Bezugsquelle für Flugzeugdaten.
 *
 * Reihenfolge:
 *   1. Live-Daten über den eigenen Server (/api/flights)
 *      → dieser holt sie von Flightradar24 oder OpenSky
 *   2. Fällt der Server aus oder läuft keiner: Demo-Daten aus
 *      data/aircraft.json mit der bisherigen Simulation
 *
 * Warum nicht direkt aus dem Browser? Weder Flightradar24 noch OpenSky
 * senden CORS-Header – ein direkter fetch() aus der Seite wird vom
 * Browser blockiert. Und der API-Schlüssel hätte im Browser ohnehin
 * nichts zu suchen.
 */

import { loadJSON } from "./dataManager.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.flights ?? {};

export class FlightDataSource {

    constructor() {
        /** "live" | "demo" | "unknown" */
        this.mode = "unknown";
        this.sourceName = "";
        this.provider = "";
        this.lastError = "";
        this.lastFetchAt = 0;
        this.serverMinIntervalMs = 0;
        this._statusChecked = false;
    }

    get baseUrl() {
        return CFG().apiUrl || "/api/flights";
    }

    /**
     * Prüft einmalig, ob der Server Live-Daten liefern kann.
     * Kostet kein Guthaben (eigener Status-Endpunkt).
     */
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

            this.provider = status.provider ?? "";
            this.serverMinIntervalMs = status.minIntervalMs ?? 0;

            if (status.configured) {
                this.mode = "live";
                this.sourceName = status.provider === "fr24"
                    ? "Flightradar24"
                    : (status.authenticated ? "OpenSky (angemeldet)" : "OpenSky Network");
            } else {
                this.mode = "demo";
                this.sourceName = "Demo-Daten";
                this.lastError = "Server läuft, aber der Flugdaten-Anbieter ist "
                    + "nicht konfiguriert (Token fehlt).";
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
     * Holt Live-Flugzeuge für einen Kartenausschnitt.
     *
     * @param {{north:number, south:number, west:number, east:number}} bounds
     * @returns {Promise<{aircraft:Array, source:string, fetchedAt:number}|null>}
     *          null, wenn keine Live-Daten verfügbar sind
     */
    async fetchLive(bounds) {
        if (!this._statusChecked) await this.checkAvailability();
        if (this.mode !== "live") return null;

        const url = new URL(this.baseUrl, window.location.origin);
        url.searchParams.set("north", bounds.north.toFixed(4));
        url.searchParams.set("south", bounds.south.toFixed(4));
        url.searchParams.set("west", bounds.west.toFixed(4));
        url.searchParams.set("east", bounds.east.toFixed(4));
        const limit = CFG().maxAircraft;
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

            this.lastError = data.warning ?? "";
            this.lastFetchAt = data.fetchedAt ?? Date.now();
            if (data.source) this.sourceName = data.source;

            return {
                aircraft: data.aircraft ?? [],
                source: data.source ?? this.sourceName,
                fetchedAt: this.lastFetchAt,
                cached: !!data.cached
            };

        } catch (err) {
            this.lastError = err.name === "AbortError"
                ? "Zeitüberschreitung beim Abruf der Flugdaten."
                : `Flugdaten nicht erreichbar: ${err.message}`;
            return null;
        }
    }

    /** Lädt die Demo-Daten aus data/aircraft.json. */
    async fetchDemo() {
        const raw = await loadJSON(CFG().demoUrl || "./data/aircraft.json");
        return raw.map(a => ({
            id: a.id,
            callsign: a.callsign ?? a.name,
            latitude: a.latitude,
            longitude: a.longitude,
            altitude: a.altitude,
            speed: a.speed,
            heading: a.heading,
            verticalRate: 0,
            onGround: false,
            registration: a.registration ?? "",
            aircraftType: a.aircraftType ?? "",
            airline: a.airline ?? "",
            flightNumber: a.callsign ?? "",
            origin: "",
            destination: "",
            route: a.route ?? "",
            squawk: a.squawk ?? "",
            wikipedia: a.wikipedia ?? "",
            timestamp: Date.now()
        }));
    }
}
