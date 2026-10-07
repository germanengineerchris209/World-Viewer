#!/usr/bin/env node
/**
 * build-volcano-fallback.mjs – erzeugt data/volcanoes.json neu.
 *
 * Die Datei ist der Offline-Schnappschuss des Vulkan-Layers: Sie füllt die
 * Karte, wenn /api/volcanoes nicht erreichbar ist (kein Server, z.B. beim
 * Öffnen per file://). Sie ist AUSDRÜCKLICH nicht handpflegt – vorher stand
 * hier eine von Hand getippte Liste mit fest eingetragenen Warnstufen, die
 * schon nach wenigen Wochen falsch war.
 *
 * Aufruf (braucht Internet, dauert ein paar Sekunden):
 *   npm run build:volcanoes
 *
 * Quellen siehe server/dataProxies.mjs – Smithsonian GVP und USGS
 * Volcano Hazards Program, beide öffentlich und ohne Schlüssel.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildVolcanoPayload } from "../server/dataProxies.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.resolve(__dirname, "..", "data", "volcanoes.json");

const payload = await buildVolcanoPayload();

if (payload.warnings?.length) {
    // Ein Schnappschuss ohne Warnstufen wäre stillschweigend schlechter
    // als der alte – deshalb hier abbrechen statt halbe Daten schreiben.
    console.error("Abbruch: nicht alle Statusquellen waren erreichbar.");
    for (const warning of payload.warnings) console.error(`  • ${warning}`);
    process.exit(1);
}

const snapshot = {
    note: "Automatisch erzeugt von scripts/build-volcano-fallback.mjs – "
        + "nicht von Hand bearbeiten. Dient nur als Rückfallebene, "
        + "wenn /api/volcanoes nicht erreichbar ist.",
    generatedAt: new Date(payload.fetchedAt).toISOString(),
    minEruptionYear: payload.minEruptionYear,
    sources: payload.sources,
    count: payload.count,
    volcanoes: payload.volcanoes
};

// Ein Vulkan pro Zeile: deutlich kleiner als eingerückter JSON und in
// Git-Diffs trotzdem zeilenweise lesbar.
const { volcanoes, ...head } = snapshot;
const headJson = JSON.stringify(head, null, 2).replace(/\n}$/, "");
const rows = volcanoes.map(v => `    ${JSON.stringify(v)}`).join(",\n");

fs.writeFileSync(TARGET, `${headJson},\n  "volcanoes": [\n${rows}\n  ]\n}\n`, "utf8");

const kb = Math.round(fs.statSync(TARGET).size / 1024);
console.log(`${TARGET}: ${payload.count} Vulkane, ${kb} KB`);
for (const source of payload.sources) {
    console.log(`  • ${source.name}: ${source.count}`);
}
