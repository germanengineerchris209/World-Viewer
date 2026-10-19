/**
 * layerCategories.js – Gruppiert die registrierten Layer für die
 * Layer-Konsole in der Sidebar (WEB-85).
 *
 * Jeder Layer wird über seine `id` (siehe js/layers/*.js) einer Kategorie
 * zugeordnet. Layer ohne Eintrag landen automatisch unter "Werkzeuge",
 * damit ein neuer Layer die Konsole nie unsichtbar macht.
 */

export const LAYER_CATEGORIES = [
    { id: "movement", label: "Bewegung", icon: "🚀" },
    { id: "cameras", label: "Kameras", icon: "📷" },
    { id: "infrastructure", label: "Infrastruktur", icon: "🏗️" },
    { id: "events", label: "Ereignisse", icon: "🚨" },
    { id: "weather", label: "Wetter", icon: "🌦️" },
    { id: "tools", label: "Werkzeuge", icon: "🧰" },
];

const CATEGORY_BY_LAYER_ID = {
    aircraft: "movement",
    militaryAircraft: "movement",
    ships: "movement",
    satellites: "movement",

    cameras: "cameras",
    allsky: "cameras",
    alpr: "cameras",
    streetlevel: "cameras",

    infrastructure: "infrastructure",
    cables: "infrastructure",
    radio: "infrastructure",
    fuelReserves: "infrastructure",

    earthquakes: "events",
    volcanoes: "events",
    fires: "events",
    launches: "events",
    events: "events",
    asteroids: "events",
    comets: "events",

    weather: "weather",
    aqi: "weather",
    cyclones: "weather",
    spaceWeather: "weather",
    goesClouds: "weather",
    worldweather: "weather",

    heatmap: "tools",
};

/** Kategorie-ID für einen Layer, Fallback "tools" für unbekannte Layer. */
export function categoryForLayer(layerId) {
    return CATEGORY_BY_LAYER_ID[layerId] ?? "tools";
}
