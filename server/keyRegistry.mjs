/**
 * keyRegistry.mjs – zentrale Liste der optionalen Schlüssel/Dienste.
 *
 * Einzige Quelle für zwei Verbraucher:
 *   - server/doctor.mjs      (Terminal-Ausgabe, "npm run doctor")
 *   - /api/keys in server.mjs (POWER-UP-Panel im Browser, WEB-87)
 *
 * WICHTIG: Dieses Modul liest zwar process.env, gibt aber nie einen
 * Wert zurück – nur ob eine Variable gesetzt ist, und ob sie aus der
 * .env-Datei stammt oder "extern" (z.B. Hosting-Secret) kam. Das reicht
 * dem Browser, um Status anzuzeigen, ohne dass das Geheimnis selbst
 * je das Netzwerk sieht.
 */

import { loadedFromEnvFile } from "./loadEnv.mjs";

/**
 * @typedef {object} KeyService
 * @property {string} id         eindeutiger Schlüssel für die API-Antwort
 * @property {string} envVar     Name der Umgebungsvariable
 * @property {string} name       Anzeigename des Dienstes
 * @property {string} unlocks    was der Schlüssel freischaltet (Anzeige)
 * @property {"gratis"|"gratis-kontingent"|"kostenpflichtig"} cost
 * @property {string} signupUrl  Link zur Registrierung
 * @property {string[]} [layers] Layer-IDs (js/layers/*), die ohne diesen
 *                                Schlüssel eingeschränkt sind
 * @property {string} [layerImpact] Erklärtext fürs Layer-Badge in der
 *                                   Konsole, falls layers gesetzt ist
 */

/** @type {KeyService[]} */
export const KEY_SERVICES = [
    {
        id: "firms",
        envVar: "FIRMS_MAP_KEY",
        name: "NASA FIRMS",
        unlocks: "🔥 Aktive Brände (weltweit)",
        cost: "gratis",
        signupUrl: "https://firms.modaps.eosdis.nasa.gov/api/map_key/",
        layers: ["fires"],
        layerImpact: "Ohne diesen Key bleibt die Ebene „Brände“ leer – "
            + "NASA FIRMS liefert ohne ihn keine Daten aus."
    },
    {
        id: "anthropic",
        envVar: "ANTHROPIC_API_KEY",
        name: "Anthropic Claude",
        unlocks: "✨ KI-Assistent",
        cost: "kostenpflichtig",
        signupUrl: "https://console.anthropic.com"
    },
    {
        id: "aisstream",
        envVar: "AISSTREAM_API_KEY",
        name: "AISStream",
        unlocks: "🚢 Schiffe mit echten AIS-Live-Daten",
        cost: "gratis",
        signupUrl: "https://aisstream.io",
        layers: ["ships"],
        layerImpact: "Ohne diesen Key zeigt die Ebene „Schiffe“ nur "
            + "Demo-Daten statt echter Live-Positionen."
    },
    {
        id: "cesiumIon",
        envVar: "CESIUM_ION_TOKEN",
        name: "Cesium Ion",
        unlocks: "🗻 3D-Gelände / weltweite OSM-3D-Gebäude",
        cost: "gratis-kontingent",
        signupUrl: "https://ion.cesium.com"
    },
    {
        id: "googleMaps",
        envVar: "GOOGLE_MAPS_API_KEY",
        name: "Google Maps Platform",
        unlocks: "🏙️ Fotorealistische 3D-Gebäude",
        cost: "gratis-kontingent",
        signupUrl: "https://console.cloud.google.com/"
    },
    {
        id: "fr24",
        envVar: "FR24_API_TOKEN",
        name: "Flightradar24",
        unlocks: "✈️ Beste Flugdaten (Flightradar24)",
        cost: "kostenpflichtig",
        signupUrl: "https://fr24api.flightradar24.com"
    },
    {
        id: "opensky",
        envVar: "OPENSKY_CLIENT_ID",
        name: "OpenSky Network",
        unlocks: "✈️ Mehr OpenSky-Kontingent",
        cost: "gratis-kontingent",
        signupUrl: "https://opensky-network.org"
    },
    {
        id: "launchLibrary2",
        envVar: "LL2_API_TOKEN",
        name: "Launch Library 2",
        unlocks: "🚀 Mehr Raketenstart-Kontingent",
        cost: "gratis-kontingent",
        signupUrl: "https://ll.thespacedevs.com/docs/"
    },
    {
        id: "tfl",
        envVar: "TFL_APP_KEY",
        name: "Transport for London",
        unlocks: "📷 Mehr TfL-Kamera-Kontingent",
        cost: "gratis-kontingent",
        signupUrl: "https://api-portal.tfl.gov.uk"
    }
];

/**
 * Status je Dienst – NUR Boolean-artige Zustände, niemals der Wert selbst.
 * "set"      → Variable gesetzt, kam aus der .env-Datei
 * "external" → Variable gesetzt, kam aus einer bereits vorhandenen
 *              Umgebungsvariable (z.B. Hosting-Secret), nicht aus .env
 * "missing"  → nicht gesetzt
 */
export function getKeyStatuses() {
    return KEY_SERVICES.map((service) => {
        const raw = process.env[service.envVar];
        const isSet = !!(raw && raw.trim());
        const status = !isSet
            ? "missing"
            : loadedFromEnvFile.includes(service.envVar) ? "set" : "external";

        return {
            id: service.id,
            envVar: service.envVar,
            name: service.name,
            unlocks: service.unlocks,
            cost: service.cost,
            signupUrl: service.signupUrl,
            layers: service.layers ?? [],
            layerImpact: service.layerImpact ?? null,
            status
        };
    });
}
