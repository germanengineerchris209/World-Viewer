/**
 * search.js – Suche über Objekte, Städte und Koordinaten.
 *
 * Unterstützte Eingaben:
 *   - Objektname / Callsign / MMSI   → "DLH123", "Ever Given", "ISS"
 *   - Stadt / Flughafen              → "Munich", "Berlin", "Frankfurt Airport"
 *   - Koordinaten                    → "50.0379, 8.5622"
 *
 * Architektur: Jeder "Provider" liefert Treffer im Format
 *   { label, sublabel, type, action }
 * Neue Suchtypen = einfach einen weiteren Provider ergänzen.
 */

// Kleine eingebaute Städte-Datenbank (jederzeit erweiterbar –
// später ersetzbar durch eine Geocoding-API wie Nominatim)
const CITIES = [
    { name: "Berlin",        country: "DE", lat: 52.5200, lon: 13.4050 },
    { name: "Munich",        country: "DE", lat: 48.1351, lon: 11.5820 },
    { name: "München",       country: "DE", lat: 48.1351, lon: 11.5820 },
    { name: "Hamburg",       country: "DE", lat: 53.5511, lon: 9.9937 },
    { name: "Frankfurt",     country: "DE", lat: 50.1109, lon: 8.6821 },
    { name: "Cologne",       country: "DE", lat: 50.9375, lon: 6.9603 },
    { name: "Köln",          country: "DE", lat: 50.9375, lon: 6.9603 },
    { name: "London",        country: "GB", lat: 51.5074, lon: -0.1278 },
    { name: "Paris",         country: "FR", lat: 48.8566, lon: 2.3522 },
    { name: "New York",      country: "US", lat: 40.7128, lon: -74.0060 },
    { name: "Los Angeles",   country: "US", lat: 34.0522, lon: -118.2437 },
    { name: "San Francisco", country: "US", lat: 37.7749, lon: -122.4194 },
    { name: "Tokyo",         country: "JP", lat: 35.6762, lon: 139.6503 },
    { name: "Singapore",     country: "SG", lat: 1.3521, lon: 103.8198 },
    { name: "Dubai",         country: "AE", lat: 25.2048, lon: 55.2708 },
    { name: "Sydney",        country: "AU", lat: -33.8688, lon: 151.2093 },
    { name: "Moscow",        country: "RU", lat: 55.7558, lon: 37.6173 },
    { name: "Beijing",       country: "CN", lat: 39.9042, lon: 116.4074 },
    { name: "Shanghai",      country: "CN", lat: 31.2304, lon: 121.4737 },
    { name: "Rio de Janeiro",country: "BR", lat: -22.9068, lon: -43.1729 },
    { name: "Cape Town",     country: "ZA", lat: -33.9249, lon: 18.4241 },
    { name: "Istanbul",      country: "TR", lat: 41.0082, lon: 28.9784 },
    { name: "Rome",          country: "IT", lat: 41.9028, lon: 12.4964 },
    { name: "Madrid",        country: "ES", lat: 40.4168, lon: -3.7038 },
    { name: "Vienna",        country: "AT", lat: 48.2082, lon: 16.3738 },
    { name: "Zurich",        country: "CH", lat: 47.3769, lon: 8.5417 },
    { name: "Amsterdam",     country: "NL", lat: 52.3676, lon: 4.9041 }
];

// Icons je Treffertyp
const TYPE_ICONS = {
    aircraft: "✈️", ship: "🚢", satellite: "🛰️",
    camera: "📷", infrastructure: "🏗️",
    city: "🏙️", coords: "📍"
};

export class Search {

    /**
     * @param {WorldViewer} worldViewer
     * @param {LayerManager} layerManager
     * @param {UI} ui
     */
    constructor(worldViewer, layerManager, ui) {
        this.worldViewer = worldViewer;
        this.layerManager = layerManager;
        this.ui = ui;

        this._input = document.getElementById("search-input");
        this._results = document.getElementById("search-results");
        this._box = document.getElementById("search-box");
        this._clearBtn = document.getElementById("search-clear");

        this._bind();
    }

    _bind() {
        this._input.addEventListener("input", () => {
            this._box.classList.toggle("has-text", this._input.value.length > 0);
            this._runSearch(this._input.value.trim());
        });

        this._input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                const first = this._results.querySelector("li");
                if (first) first.click();
            } else if (e.key === "Escape") {
                this._clear();
            }
        });

        this._clearBtn.addEventListener("click", () => this._clear());
    }

    _clear() {
        this._input.value = "";
        this._box.classList.remove("has-text");
        this._results.classList.add("hidden");
        this._results.innerHTML = "";
    }

    /* ─────────── Such-Provider ─────────── */

    /** Provider 1: Koordinaten wie "50.0379, 8.5622" */
    _searchCoordinates(query) {
        const match = query.match(/^(-?\d{1,3}(?:[.,]\d+)?)\s*[,;/ ]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
        if (!match) return [];

        const lat = parseFloat(match[1].replace(",", "."));
        const lon = parseFloat(match[2].replace(",", "."));
        if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return [];

        return [{
            label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
            sublabel: "Koordinaten",
            type: "coords",
            action: () => this.worldViewer.flyTo(lon, lat, 50_000)
        }];
    }

    /** Provider 2: Objekte aller Layer (Callsign, Name, MMSI …) */
    _searchObjects(query) {
        const q = query.toLowerCase();
        const hits = [];
        for (const obj of this.layerManager.getAllObjects()) {
            const haystack = [
                obj.name,
                obj.metadata.callsign,
                obj.metadata.mmsi,
                obj.metadata.code
            ].filter(Boolean).join(" ").toLowerCase();

            if (haystack.includes(q)) {
                hits.push({
                    label: obj.metadata.callsign ?? obj.name,
                    sublabel: obj.type,
                    type: obj.type,
                    action: () => {
                        const entity = this.layerManager.findEntityById(obj.id);
                        if (entity) this.ui.selectEntity(entity, { fly: true });
                    }
                });
            }
            if (hits.length >= 8) break;
        }
        return hits;
    }

    /** Provider 3: Städte */
    _searchCities(query) {
        const q = query.toLowerCase();
        return CITIES
            .filter(c => c.name.toLowerCase().startsWith(q))
            .slice(0, 5)
            .map(c => ({
                label: c.name,
                sublabel: c.country,
                type: "city",
                action: () => this.worldViewer.flyTo(c.lon, c.lat, 30_000)
            }));
    }

    /* ─────────── Ausführung & Rendering ─────────── */

    _runSearch(query) {
        if (query.length < 2) {
            this._results.classList.add("hidden");
            return;
        }

        // Reihenfolge: Koordinaten → Objekte → Städte
        const hits = [
            ...this._searchCoordinates(query),
            ...this._searchObjects(query),
            ...this._searchCities(query)
        ].slice(0, 10);

        this._render(hits);
    }

    _render(hits) {
        this._results.innerHTML = "";
        if (hits.length === 0) {
            this._results.innerHTML =
                `<li style="color:var(--text-dim);cursor:default">Keine Treffer</li>`;
            this._results.classList.remove("hidden");
            return;
        }

        for (const hit of hits) {
            const li = document.createElement("li");
            li.innerHTML = `
                <span>${TYPE_ICONS[hit.type] ?? "📍"}</span>
                <span>${hit.label}</span>
                <span class="result-type">${hit.sublabel}</span>`;
            li.addEventListener("click", () => {
                hit.action();
                this._results.classList.add("hidden");
            });
            this._results.appendChild(li);
        }
        this._results.classList.remove("hidden");
    }
}
