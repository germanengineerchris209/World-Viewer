/**
 * flightData.js – Bezugsquelle für Flugzeugdaten.
 *
 * Reihenfolge:
 *   1. Live-Daten über den eigenen Server (/api/flights)
 *      → dieser holt sie von Flightradar24 oder OpenSky
 *   2. Fällt der Server aus oder läuft keiner: Demo-Daten aus
 *      data/aircraft.json mit der bisherigen Simulation
 *
 * Dieselbe Klasse bedient über den konfigurierbaren `configKey` auch den
 * Militärflüge-Layer (WEB-90, /api/flights/military → adsb.lol): weltweit,
 * ohne Bounding-Box, ohne Demo-Rückfall (siehe AircraftLayer `allowDemo`).
 *
 * Warum nicht direkt aus dem Browser? Weder Flightradar24 noch OpenSky
 * noch adsb.lol senden CORS-Header – ein direkter fetch() aus der Seite
 * würde vom Browser blockiert. Und der API-Schlüssel hätte im Browser
 * ohnehin nichts zu suchen.
 */

import { loadJSON } from "./dataManager.js";

export class FlightDataSource {

    /**
     * @param {string} configKey  Schlüssel in window.WORLD_VIEWER_CONFIG,
     *        z.B. "flights" (Zivilverkehr) oder "militaryFlights" (WEB-90).
     */
    constructor(configKey = "flights") {
        this._configKey = configKey;

        /** "live" | "demo" | "unknown" */
        this.mode = "unknown";
        this.sourceName = "";
        this.provider = "";
        this.lastError = "";
        this.lastFetchAt = 0;
        this.serverMinIntervalMs = 0;
        this._statusChecked = false;
    }

    get _cfg() {
        return window.WORLD_VIEWER_CONFIG?.[this._configKey] ?? {};
    }

    get baseUrl() {
        return this._cfg.apiUrl || "/api/flights";
    }

    /**
     * Prüft einmalig, ob der Server Live-Daten liefern kann.
     * Kostet kein Guthaben (eigener Status-Endpunkt).
     */
    async checkAvailability() {
        if (this._cfg.mode === "demo") {
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
                this.sourceName = status.provider === "fr24" ? "Flightradar24"
                    : status.provider === "adsblol" ? "adsb.lol"
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
     * Holt Live-Flugzeuge, optional für einen Kartenausschnitt.
     *
     * @param {{north:number, south:number, west:number, east:number}} [bounds]
     *        weggelassen = weltweiter Abruf (z.B. Militär-Endpunkt, der
     *        ohnehin keine Bounding-Box kennt; die Begrenzung auf den
     *        sichtbaren Ausschnitt übernimmt dann der Layer selbst)
     * @returns {Promise<{aircraft:Array, source:string, fetchedAt:number}|null>}
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
        const limit = this._cfg.maxAircraft;
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
        const raw = await loadJSON(this._cfg.demoUrl || "./data/aircraft.json");
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
