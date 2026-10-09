/**
 * check-comet-orbits.mjs – prüft die Kepler-Rechnung aus js/cometOrbits.js
 * gegen die Ephemeriden von JPL Horizons.
 *
 * Horizons rechnet mit dem vollen Störungsmodell, unsere Rechnung nur mit
 * zwei Körpern. Eine Abweichung von einigen Bogenminuten bis zu wenigen
 * Grad ist deshalb normal und kein Fehler – der Test soll grobe
 * Vorzeichen-, Einheiten- und Formelfehler finden.
 *
 * Aufruf:  node scripts/check-comet-orbits.mjs
 * Braucht Netz, aber keinen Schlüssel.
 */

import { cometPosition, julianDateFromMs } from "../js/cometOrbits.js";

/** Testzeitpunkt: fest, damit der Lauf reproduzierbar bleibt. */
const WHEN = new Date("2026-10-08T00:00:00Z");
const JD = julianDateFromMs(WHEN.getTime());

/** Toleranz für die Winkelabweichung in Grad. */
const TOLERANCE_DEG = 3.0;

/**
 * Prüffälle. Die Bahnelemente stammen aus der SBDB (sbdb_query.api),
 * die Soll-Werte holt der Test live von Horizons.
 *   e, a [AE], i, om, w [Grad], q [AE], tp [JD]
 */
const CASES = [
    {
        label: "1P/Halley (HTC, e=0.97)",
        designation: "1P",
        el: { e: 0.9679, a: 17.93, i: 162.19, om: 59.10, w: 112.24, q: 0.575, tp: 2446469.97 }
    },
    {
        label: "67P/Churyumov-Gerasimenko (JFc, e=0.64)",
        designation: "67P",
        el: { e: 0.6409, a: 3.462, i: 7.04, om: 50.14, w: 12.80, q: 1.243, tp: 2457247.59 }
    },
    {
        label: "153P/Ikeya-Zhang (lange Periode, e=0.99)",
        designation: "153P",
        el: { e: 0.9901, a: 51.12, i: 28.12, om: 93.37, w: 34.67, q: 0.507, tp: 2452352.48 }
    }
];

/**
 * Holt RA/Dek und Entfernung für einen Körper von Horizons.
 *
 * Das Suffix `;CAP` ist wichtig: Kometen haben in Horizons pro
 * Erscheinung einen eigenen Datensatz, `CAP` wählt den zur Abfragezeit
 * passenden. Ohne das Suffix antwortet Horizons mit einer Trefferliste
 * statt mit einer Ephemeride.
 */
async function horizonsEphemeris(designation, when) {
    const start = when.toISOString().slice(0, 16).replace("T", " ");
    const stopDate = new Date(when.getTime() + 3_600_000);
    const stop = stopDate.toISOString().slice(0, 16).replace("T", " ");

    const url = new URL("https://ssd.jpl.nasa.gov/api/horizons.api");
    url.searchParams.set("format", "json");
    url.searchParams.set("COMMAND", `'DES=${designation};CAP'`);
    url.searchParams.set("EPHEM_TYPE", "OBSERVER");
    url.searchParams.set("CENTER", "'500@399'");       // Erdmittelpunkt
    url.searchParams.set("START_TIME", `'${start}'`);
    url.searchParams.set("STOP_TIME", `'${stop}'`);
    url.searchParams.set("STEP_SIZE", "'1 h'");
    url.searchParams.set("QUANTITIES", "'1,20'");      // RA/Dek, Entfernung
    url.searchParams.set("ANG_FORMAT", "'DEG'");

    const res = await fetch(url);
    if (!res.ok) throw new Error(`Horizons HTTP ${res.status}`);
    const json = await res.json();
    const text = String(json.result ?? "");

    const body = text.split("$$SOE")[1]?.split("$$EOE")[0];
    if (!body) throw new Error(`keine Ephemeride in der Antwort (${text.slice(0, 200)})`);

    const first = body.trim().split("\n")[0];
    // Spalten: Datum, (Sonne/Mond-Flags), RA, Dek, delta, deldot
    const numbers = first.match(/-?\d+\.\d+/g)?.map(Number) ?? [];
    if (numbers.length < 3) throw new Error(`Zeile nicht lesbar: ${first}`);

    // RA und Dek sind die ersten beiden Dezimalzahlen nach dem Datum,
    // delta die darauffolgende (in AE).
    const [ra, dec, delta] = numbers;
    return { ra, dec, delta };
}

/** Winkelabstand zweier RA/Dek-Paare in Grad. */
function angularSeparationDeg(ra1, dec1, ra2, dec2) {
    const r = Math.PI / 180;
    const a = dec1 * r, b = dec2 * r, d = (ra1 - ra2) * r;
    const cos = Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(d);
    return Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
}

console.log(`Vergleich gegen JPL Horizons für ${WHEN.toISOString()} (JD ${JD.toFixed(3)})`);
console.log(`Toleranz: ${TOLERANCE_DEG}° Winkelabstand\n`);

let failed = 0;
let compared = 0;

for (const testCase of CASES) {
    const mine = cometPosition(testCase.el, JD);
    if (!mine) {
        console.error(`✗ ${testCase.label}: keine Position berechnet`);
        failed++;
        continue;
    }

    let truth;
    try {
        truth = await horizonsEphemeris(testCase.designation, WHEN);
    } catch (err) {
        console.warn(`? ${testCase.label}: Horizons nicht abrufbar (${err.message})`);
        console.warn(`    eigene Rechnung: RA ${mine.rightAscensionDeg.toFixed(2)}° `
            + `Dek ${mine.declinationDeg.toFixed(2)}° Δ ${mine.distanceAU.toFixed(3)} AE`);
        continue;
    }

    const sep = angularSeparationDeg(
        mine.rightAscensionDeg, mine.declinationDeg, truth.ra, truth.dec);
    const distErr = Math.abs(mine.distanceAU - truth.delta);
    const ok = sep <= TOLERANCE_DEG;
    if (!ok) failed++;
    compared++;

    console.log(`${ok ? "✓" : "✗"} ${testCase.label}`);
    console.log(`    eigene:   RA ${mine.rightAscensionDeg.toFixed(3)}°  `
        + `Dek ${mine.declinationDeg.toFixed(3)}°  Δ ${mine.distanceAU.toFixed(4)} AE`);
    console.log(`    Horizons: RA ${truth.ra.toFixed(3)}°  `
        + `Dek ${truth.dec.toFixed(3)}°  Δ ${truth.delta.toFixed(4)} AE`);
    console.log(`    Abstand ${sep.toFixed(3)}°, Entfernungsfehler ${distErr.toFixed(4)} AE`);
    console.log(`    Subpunkt ${mine.latitude.toFixed(2)}°, ${mine.longitude.toFixed(2)}°  `
        + `heliozentrisch ${mine.heliocentricAU.toFixed(3)} AE  `
        + `Elongation ${mine.elongationDeg.toFixed(1)}°\n`);
}

if (failed) {
    console.error(`${failed} von ${CASES.length} Fällen über der Toleranz.`);
    process.exit(1);
}
if (!compared) {
    // Sonst würde ein kompletter Netzausfall als Erfolg durchgehen
    console.error("Kein einziger Fall konnte gegen Horizons geprüft werden.");
    process.exit(2);
}
console.log(`${compared} von ${CASES.length} Fällen geprüft, alle innerhalb der Toleranz.`);
