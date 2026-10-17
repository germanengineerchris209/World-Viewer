#!/usr/bin/env node
/**
 * Mess-Skript für WEB-84: Wie teuer ist SGP4-Propagation für ~840 Objekte
 * (God's-Eye-View-Maßstab) im Vergleich zu den aktuell 12/~300 Objekten
 * in js/layers/SatelliteLayer.js?
 *
 * Holt echte TLE-Daten von CelesTrak (dieselben Gruppen wie
 * server/dataProxies.mjs TLE_GROUPS), propagiert sie mit satellite.js
 * und misst die reine Rechenzeit – keine Cesium-Darstellung, kein Server.
 *
 * Benötigt: `npm install satellite.js --no-save` (nicht Teil der
 * Projekt-Abhängigkeiten, nur für dieses Mess-Skript).
 *
 * Aufruf: node scripts/satellite-propagation-benchmark.mjs
 */

import * as satellite from "satellite.js";

const TLE_GROUPS = [
    { tag: "stations", path: "stations" },
    { tag: "visual", path: "visual" },
    { tag: "gps", path: "gps-ops" },
    { tag: "glonass", path: "glo-ops" },
    { tag: "galileo", path: "galileo" },
    { tag: "geo", path: "geo" },
    { tag: "starlink", path: "starlink" }
];

function parseTle(text) {
    const lines = String(text).split("\n").map(l => l.trimEnd());
    const out = [];
    for (let i = 0; i < lines.length - 2; i += 3) {
        const name = lines[i]?.trim();
        const line1 = lines[i + 1];
        const line2 = lines[i + 2];
        if (line1?.startsWith("1 ") && line2?.startsWith("2 ")) {
            out.push({ name, line1, line2 });
        }
    }
    return out;
}

async function fetchGroup(path) {
    const url = new URL("https://celestrak.org/NORAD/elements/gp.php");
    url.searchParams.set("GROUP", path);
    url.searchParams.set("FORMAT", "tle");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!/^1 /m.test(text)) throw new Error("keine TLE-Zeilen in der Antwort");
    return parseTle(text);
}

function buildSatrecs(entries) {
    const out = [];
    for (const e of entries) {
        const satrec = satellite.twoline2satrec(e.line1, e.line2);
        if (satrec && satrec.error === 0) out.push({ name: e.name, satrec });
    }
    return out;
}

function propagateOne(satrec, date, gmst) {
    const posVel = satellite.propagate(satrec, date);
    if (!posVel?.position || typeof posVel.position === "boolean") return null;
    const geo = satellite.eciToGeodetic(posVel.position, gmst);
    return {
        lat: satellite.degreesLat(geo.latitude),
        lon: satellite.degreesLong(geo.longitude),
        alt: geo.height
    };
}

function bench(label, fn, iterations) {
    // Aufwärmen, damit die JIT-Kompilierung nicht die Messung verzerrt
    for (let i = 0; i < Math.min(50, iterations); i++) fn();
    const t0 = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    const t1 = performance.now();
    const totalMs = t1 - t0;
    console.log(
        `${label}: ${iterations}x in ${totalMs.toFixed(1)} ms ` +
        `(${(totalMs / iterations).toFixed(4)} ms/Aufruf)`
    );
    return totalMs / iterations;
}

async function main() {
    console.log("=== WEB-84: SGP4-Propagations-Benchmark ===\n");

    console.log("-- 1. TLE-Gruppen von CelesTrak laden (echte Daten, wie server/dataProxies.mjs) --");
    const groupCounts = {};
    const allSatrecs = [];
    const seen = new Set();

    for (const g of TLE_GROUPS) {
        try {
            const entries = await fetchGroup(g.path);
            const satrecs = buildSatrecs(entries);
            groupCounts[g.tag] = satrecs.length;
            for (const s of satrecs) {
                const id = String(s.satrec.satnum);
                if (seen.has(id)) continue;
                seen.add(id);
                allSatrecs.push(s);
            }
            console.log(`  ${g.tag.padEnd(10)} ${String(satrecs.length).padStart(5)} Objekte`);
        } catch (err) {
            groupCounts[g.tag] = `Fehler: ${err.message}`;
            console.log(`  ${g.tag.padEnd(10)} FEHLER: ${err.message}`);
        }
    }

    console.log(`\nGesamt (dedupliziert, alle Gruppen inkl. Starlink-Vollbestand): ${allSatrecs.length}`);
    console.log(`Davon Starlink allein: ${groupCounts.starlink} (das ist der "DENSE"-Kandidat)\n`);

    const withoutStarlink = allSatrecs.length - (typeof groupCounts.starlink === "number" ? groupCounts.starlink : 0);
    console.log(`Ohne Starlink (Default-Ansicht): ${withoutStarlink} Objekte`);
    console.log(`GEV-Zielgröße zum Vergleich: 838 Objekte\n`);

    console.log("-- 2. Reine Propagationskosten (1 Satellit, propagate + eciToGeodetic) --");
    const now = new Date();
    const gmst = satellite.gstime(now);
    const sample = allSatrecs[0]?.satrec;
    if (sample) {
        bench("Einzelpropagation", () => propagateOne(sample, new Date(), satellite.gstime(new Date())), 5000);
        bench("Einzelpropagation (GMST wiederverwendet)", () => propagateOne(sample, now, gmst), 5000);
    }

    console.log("\n-- 3. Ganzer Bestand: einmal durchpropagieren (wie SatelliteLayer.update(), 1x/Sekunde) --");
    const fullSetMsPerCall = bench(
        `Alle ${allSatrecs.length} Objekte (1 Durchlauf)`,
        () => {
            const t = new Date();
            const g = satellite.gstime(t);
            for (const s of allSatrecs) propagateOne(s.satrec, t, g);
        },
        20
    );

    const n838 = allSatrecs.slice(0, 838);
    bench(
        `Nur die ersten 838 Objekte (GEV-Maßstab, 1 Durchlauf)`,
        () => {
            const t = new Date();
            const g = satellite.gstime(t);
            for (const s of n838) propagateOne(s.satrec, t, g);
        },
        20
    );

    console.log("\n-- 4. Kosten eines Bahnrings (showOrbit(): 180 Stützpunkte, 1x pro Klick) --");
    if (sample) {
        bench(
            "Bahnring (180 Punkte, fixes GMST)",
            () => {
                const g2 = satellite.gstime(now);
                for (let i = 0; i <= 180; i++) {
                    const at = new Date(now.getTime() + i * 1000);
                    propagateOne(sample, at, g2);
                }
            },
            50
        );
    }

    console.log("\n=== Einordnung ===");
    console.log(`60 fps-Budget pro Frame: 16.67 ms. Ein Durchlauf über ${allSatrecs.length} Objekte`);
    console.log(`kostet laut Messung oben ca. ${fullSetMsPerCall.toFixed(1)} ms – das passt NICHT in ein`);
    console.log(`einzelnes Frame, aber problemlos in ein 1x/Sekunde-Intervall (bestehendes Muster in`);
    console.log(`SatelliteLayer.update(): Akkumulator, Propagation nur 1x/Sekunde, Darstellung`);
    console.log(`läuft dazwischen per CallbackProperty mit den zuletzt berechneten Werten weiter).`);
}

main().catch(err => {
    console.error("Benchmark fehlgeschlagen:", err);
    process.exit(1);
});
