/**
 * doctor.mjs – Setup-Diagnose: "npm run doctor".
 *
 * Prüft Node-Version und meldet, welche Schlüssel aus .env gefunden
 * wurden – NIE die Werte selbst, nur ob gesetzt oder nicht. Ersetzt
 * kein manuelles Nachlesen in DATENQUELLEN.md, gibt aber einen
 * schnellen Überblick vor dem Start.
 */

import "./loadEnv.mjs";

const MIN_NODE_MAJOR = 18;

const KEYS = [
    { name: "FIRMS_MAP_KEY", unlocks: "🔥 Aktive Brände (NASA FIRMS)", required: false },
    { name: "ANTHROPIC_API_KEY", unlocks: "✨ KI-Assistent (Claude)", required: false },
    { name: "AISSTREAM_API_KEY", unlocks: "🚢 Schiffe mit echten AIS-Daten", required: false },
    { name: "CESIUM_ION_TOKEN", unlocks: "3D-Gelände / graue 3D-Gebäude (Browser, config.js)", required: false },
    { name: "GOOGLE_MAPS_API_KEY", unlocks: "Fotorealistische 3D-Gebäude (Browser, config.js)", required: false },
    { name: "FR24_API_TOKEN", unlocks: "✈️ Beste Flugdaten (Flightradar24, kostenpflichtig)", required: false },
    { name: "OPENSKY_CLIENT_ID", unlocks: "✈️ Mehr OpenSky-Kontingent", required: false },
    { name: "LL2_API_TOKEN", unlocks: "🚀 Mehr Raketenstart-Kontingent", required: false },
    { name: "TFL_APP_KEY", unlocks: "📷 Mehr TfL-Kamera-Kontingent", required: false }
];

function checkNodeVersion() {
    const major = Number(process.versions.node.split(".")[0]);
    const ok = major >= MIN_NODE_MAJOR;
    console.log(
        `${ok ? "✅" : "❌"} Node.js ${process.versions.node}`
        + (ok ? "" : ` – bitte mindestens Node ${MIN_NODE_MAJOR} verwenden`)
    );
    return ok;
}

function checkKeys() {
    console.log("\n🔑 Gefundene Schlüssel (.env / Umgebungsvariablen):");
    for (const { name, unlocks } of KEYS) {
        const set = !!(process.env[name] && process.env[name].trim());
        console.log(`  ${set ? "✅" : "⬜"} ${name.padEnd(20)} → ${unlocks}`);
    }
}

function main() {
    console.log("🩺 World Viewer – Setup-Diagnose\n");
    const nodeOk = checkNodeVersion();
    checkKeys();
    console.log(
        "\nHinweis: Fehlende Schlüssel sind kein Fehler – ohne sie laufen "
        + "Satellitenbild, Flugzeuge, Schiffe (Demo), Erdbeben, Raketenstarts "
        + "und Kameras trotzdem. Details in DATENQUELLEN.md."
    );
    process.exit(nodeOk ? 0 : 1);
}

main();
