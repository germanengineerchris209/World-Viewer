#!/usr/bin/env node
/**
 * build-infrastructure-mass.mjs – erzeugt die drei Massendatensätze für
 * WEB-100: Rechenzentren, Dämme, Seekabel.
 *
 * Alle drei Kategorien existierten bisher nur als Handvoll handkuratierter
 * Einträge (data/infrastructure.json, data/cables.json). Reales Vorbild
 * (GEV, github.com/bilawalsidhu/gods-eye-view) bündelt 4.351 Rechenzentren,
 * 704 Dämme, 712 Seekabel – als statischer Snapshot, nicht live.
 *
 * Quelle für Rechenzentren + Dämme: OpenStreetMap via Overpass API
 * (ODbL 1.0 – Attribution + Share-Alike).
 * Quelle für Seekabel: ebenfalls OpenStreetMap (man_made=submarine_cable),
 * AUSDRÜCKLICH NICHT TeleGeography – deren Submarine Cable Map steht unter
 * CC BY-NC-SA 3.0 (nicht-kommerziell), siehe Kommentar in CableLayer.js.
 * Die OSM-Abdeckung für Kabel ist dünner als TeleGeography, aber frei
 * nutzbar; Lizenzkonformität geht hier vor Objektzahl.
 *
 * Aufruf (braucht Internet, dauert mehrere Minuten wegen Overpass-Timeouts):
 *   npm run build:infrastructure-mass
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");

const OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter"
];

const UA = "WorldViewer-InfrastructureBuild/1.0 (+https://github.com/germanengineerchris209/World-Viewer)";

/** Kontinentale Bounding-Boxen (S,W,N,O) – Overpass braucht sie, damit
 *  Dämme (zehntausende Treffer weltweit) nicht in einen Timeout laufen. */
const REGIONS = [
    { name: "Nordamerika", bbox: [5, -170, 72, -50] },
    { name: "Südamerika", bbox: [-56, -82, 13, -34] },
    { name: "Europa", bbox: [34, -11, 71, 40] },
    { name: "Afrika", bbox: [-35, -18, 38, 52] },
    { name: "Asien", bbox: [-11, 40, 77, 180] },
    { name: "Ozeanien", bbox: [-50, 110, 0, 180] }
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Overpass-Abfrage mit Retry über die Spiegelserver + Backoff bei Timeout/Last. */
async function overpassQuery(ql, { retries = 4 } = {}) {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt++) {
        const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
        try {
            const res = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "User-Agent": UA
                },
                body: `data=${encodeURIComponent(ql)}`
            });
            const text = await res.text();
            if (!res.ok || text.trimStart().startsWith("<")) {
                throw new Error(`Overpass-Fehler (${endpoint}): ${text.slice(0, 200)}`);
            }
            return JSON.parse(text);
        } catch (err) {
            lastError = err;
            console.warn(`  … Versuch ${attempt + 1}/${retries} fehlgeschlagen: ${err.message}`);
            await sleep(5000 * (attempt + 1));
        }
    }
    throw lastError;
}

function elementCenter(el) {
    if (el.type === "node") return { latitude: el.lat, longitude: el.lon };
    if (el.center) return { latitude: el.center.lat, longitude: el.center.lon };
    return null;
}

/* ───────────────────────── Rechenzentren ───────────────────────── */

async function fetchDatacenters() {
    console.log("Rechenzentren: Overpass-Abfrage (weltweit, telecom/building=data_center) …");
    const ql = `[out:json][timeout:180];
(
  node["telecom"="data_center"];
  way["telecom"="data_center"];
  node["building"="data_center"];
  way["building"="data_center"];
);
out center tags;`;
    const data = await overpassQuery(ql);
    const seen = new Map();
    for (const el of data.elements) {
        const center = elementCenter(el);
        if (!center) continue;
        const key = `${center.latitude.toFixed(4)},${center.longitude.toFixed(4)}`;
        if (seen.has(key)) continue;
        const tags = el.tags ?? {};
        seen.set(key, {
            id: `dc-osm-${el.type[0]}${el.id}`,
            name: tags.name || tags.operator || "Rechenzentrum",
            category: "datacenter",
            operator: tags.operator ?? null,
            country: tags["addr:country"] ?? null,
            latitude: center.latitude,
            longitude: center.longitude,
            altitude: 0
        });
    }
    const list = [...seen.values()];
    console.log(`Rechenzentren: ${list.length} Objekte (${data.elements.length} OSM-Elemente, dedupliziert).`);
    return list;
}

/* ───────────────────────────── Dämme ───────────────────────────── */

async function fetchDams() {
    console.log("Dämme: Overpass-Abfrage pro Kontinent (waterway/man_made=dam, mit Wikipedia-Artikel) …");
    const seen = new Map();
    for (const region of REGIONS) {
        const [s, w, n, e] = region.bbox;
        // ["wikidata"] allein filtert NICHT auf bedeutsame Bauwerke: ein
        // Massenimport hat jedem Eintrag des US National Inventory of Dams
        // (NID) automatisch eine eigene Wikidata-ID verpasst, auch für
        // kleinste Teich-/Hatchery-Dämme (z.B. "Feather River Hatchery
        // 1-047 Dam", Q35701576 – das Rauschbeispiel aus WEB-150 bleibt
        // mit ["wikidata"] erhalten). Allein Nordamerika liefert damit
        // >13.000 Treffer, mehr als die weltweite Zielgröße.
        // ["wikipedia"] verlangt stattdessen einen tatsächlich verlinkten
        // Wikipedia-Artikel (von Hand verfasste Prosa, kein Bulk-Import) –
        // Nordamerika kommt damit auf ~280 Treffer, in der mit dem
        // GEV-Referenzprojekt vergleichbaren Größenordnung (~700 Dämme
        // weltweit). Siehe WEB-151.
        const ql = `[out:json][timeout:120];
(
  node["waterway"="dam"]["wikipedia"](${s},${w},${n},${e});
  way["waterway"="dam"]["wikipedia"](${s},${w},${n},${e});
  node["man_made"="dam"]["wikipedia"](${s},${w},${n},${e});
  way["man_made"="dam"]["wikipedia"](${s},${w},${n},${e});
);
out center tags;`;
        const data = await overpassQuery(ql);
        let added = 0;
        for (const el of data.elements) {
            const center = elementCenter(el);
            if (!center) continue;
            const key = `${center.latitude.toFixed(4)},${center.longitude.toFixed(4)}`;
            if (seen.has(key)) continue;
            const tags = el.tags ?? {};
            seen.set(key, {
                id: `dam-osm-${el.type[0]}${el.id}`,
                name: tags.name || "Staudamm",
                category: "dam",
                country: tags["addr:country"] ?? null,
                latitude: center.latitude,
                longitude: center.longitude,
                altitude: 0
            });
            added++;
        }
        console.log(`  ${region.name}: +${added} (gesamt ${seen.size})`);
        await sleep(2000);
    }
    return [...seen.values()];
}

/* ──────────────────────────── Seekabel ─────────────────────────── */

async function fetchCables() {
    console.log("Seekabel: Overpass-Abfrage (weltweit, man_made=submarine_cable) …");
    const ql = `[out:json][timeout:180];
(
  way["man_made"="submarine_cable"];
);
out geom tags;`;
    const data = await overpassQuery(ql);
    const list = [];
    for (const el of data.elements) {
        const coords = el.geometry ?? [];
        if (coords.length < 2) continue;
        const tags = el.tags ?? {};
        list.push({
            id: `cable-osm-${el.id}`,
            name: tags.name || `Seekabel ${el.id}`,
            category: "cable",
            // Volle Trassengeometrie aus OSM statt vereinfachter Geodäte –
            // CableLayer rendert landingPoints als Polyline-Stützpunkte.
            landingPoints: coords.map(c => ({ latitude: c.lat, longitude: c.lon })),
            operators: tags.operator ?? null,
            info: null,
            wikipedia: null
        });
    }
    console.log(`Seekabel: ${list.length} Objekte.`);
    return list;
}

/* ───────────────────────────── main ────────────────────────────── */

function writeSnapshot(filename, note, items) {
    const target = path.join(DATA_DIR, filename);
    const snapshot = {
        note,
        generatedAt: new Date().toISOString(),
        source: "OpenStreetMap contributors, via Overpass API",
        license: "Open Database License (ODbL) 1.0 – https://www.openstreetmap.org/copyright",
        count: items.length,
        items
    };
    const { items: rows, ...head } = snapshot;
    const headJson = JSON.stringify(head, null, 2).replace(/\n}$/, "");
    const body = rows.map(r => `    ${JSON.stringify(r)}`).join(",\n");
    fs.writeFileSync(target, `${headJson},\n  "items": [\n${body}\n  ]\n}\n`, "utf8");
    const kb = Math.round(fs.statSync(target).size / 1024);
    console.log(`${target}: ${items.length} Objekte, ${kb} KB`);
}

const mode = process.argv[2];

if (!mode || mode === "datacenters") {
    writeSnapshot(
        "datacenters.json",
        "Automatisch erzeugt von scripts/build-infrastructure-mass.mjs – nicht von Hand bearbeiten. "
            + "Rechenzentren weltweit aus OpenStreetMap (telecom=data_center, building=data_center).",
        await fetchDatacenters()
    );
}
if (!mode || mode === "dams") {
    writeSnapshot(
        "dams.json",
        "Automatisch erzeugt von scripts/build-infrastructure-mass.mjs – nicht von Hand bearbeiten. "
            + "Dämme weltweit aus OpenStreetMap (waterway=dam, man_made=dam).",
        await fetchDams()
    );
}
if (!mode || mode === "cables") {
    writeSnapshot(
        "cables-osm.json",
        "Automatisch erzeugt von scripts/build-infrastructure-mass.mjs – nicht von Hand bearbeiten. "
            + "Seekabel aus OpenStreetMap (man_made=submarine_cable). Bewusst NICHT TeleGeography "
            + "(CC BY-NC-SA, nicht-kommerziell) – siehe DATENQUELLEN.md.",
        await fetchCables()
    );
}
