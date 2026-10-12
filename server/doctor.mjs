/**
 * doctor.mjs – Setup-Diagnose: "npm run doctor".
 *
 * Prüft Node-Version und meldet, welche Schlüssel aus .env gefunden
 * wurden – NIE die Werte selbst, nur ob gesetzt oder nicht. Ersetzt
 * kein manuelles Nachlesen in DATENQUELLEN.md, gibt aber einen
 * schnellen Überblick vor dem Start.
 *
 * Die Dienstliste + Status-Logik steht in keyRegistry.mjs – dieselbe
 * Quelle, die auch /api/keys fürs POWER-UP-Panel im Browser beliefert
 * (WEB-87), damit Terminal und UI nie auseinanderlaufen.
 */

import "./loadEnv.mjs";
import { getKeyStatuses } from "./keyRegistry.mjs";

const MIN_NODE_MAJOR = 18;

const STATUS_ICON = { set: "✅", external: "🌐", missing: "⬜" };

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
    for (const { envVar, unlocks, status } of getKeyStatuses()) {
        console.log(`  ${STATUS_ICON[status]} ${envVar.padEnd(24)} → ${unlocks}`);
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
