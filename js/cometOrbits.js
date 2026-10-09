/**
 * cometOrbits.js – Position eines Kometen aus seinen Bahnelementen.
 *
 * Die Bahnelemente kommen aus der NASA JPL Small-Body Database (siehe
 * /api/comets) und beziehen sich auf die Ekliptik des Äquinoktiums J2000.
 * Hier wird daraus für einen Zeitpunkt die Position berechnet:
 *
 *   1. Kepler-Gleichung lösen  → wahre Anomalie ν und Radius r
 *   2. Bahnebene → heliozentrische Ekliptik-Koordinaten
 *   3. minus Erdposition       → geozentrischer Vektor
 *   4. Ekliptik → Äquator      → Rektaszension / Deklination
 *   5. RA/Dek + Sternzeit      → Punkt der Erde, über dem der Komet steht
 *
 * Es ist ein reines Zweikörper-Modell: die Störungen durch die Planeten
 * werden ignoriert. Nahe am Element-Epoch liegt der Fehler im Bereich von
 * Bogenminuten, über Jahrzehnte hinweg kann er auf Grad anwachsen. Für die
 * Darstellung auf dem Globus reicht das; `scripts/check-comet-orbits.mjs`
 * vergleicht die Rechnung gegen JPL Horizons.
 */

/** Gaußsche Gravitationskonstante in rad/Tag (AE^{3/2}/Tag). */
const GAUSS_K = 0.01720209895;

/** Julianisches Datum von J2000.0 (2000-01-01 12:00 TT). */
const JD_J2000 = 2451545.0;

/** Eine astronomische Einheit in Metern. */
export const AU_IN_M = 149_597_870_700;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Unix-Millisekunden → julianisches Datum. */
export function julianDateFromMs(ms) {
    return ms / 86_400_000 + 2440587.5;
}

/** Julianisches Datum → Unix-Millisekunden. */
export function msFromJulianDate(jd) {
    return (jd - 2440587.5) * 86_400_000;
}

/** Winkel in rad auf [-π, π) normieren. */
function wrapPi(angle) {
    const twoPi = 2 * Math.PI;
    let a = angle % twoPi;
    if (a >= Math.PI) a -= twoPi;
    if (a < -Math.PI) a += twoPi;
    return a;
}

/** Winkel in Grad auf [-180, 180) normieren. */
export function wrapDeg180(deg) {
    let d = deg % 360;
    if (d >= 180) d -= 360;
    if (d < -180) d += 360;
    return d;
}

/**
 * Elliptische Kepler-Gleichung  M = E - e·sin E  nach E auflösen.
 * Newton-Verfahren; bei stark exzentrischen Bahnen (e → 1) ist der
 * Startwert entscheidend, daher die Fallunterscheidung.
 */
export function solveEccentricAnomaly(M, e) {
    let E = (e < 0.8) ? M : Math.sign(M || 1) * Math.pow(6 * Math.abs(M), 1 / 3);
    if (!Number.isFinite(E)) E = M;

    for (let n = 0; n < 60; n++) {
        const f = E - e * Math.sin(E) - M;
        const df = 1 - e * Math.cos(E);
        const step = f / (Math.abs(df) < 1e-12 ? 1e-12 : df);
        E -= Math.max(-0.5, Math.min(0.5, step));   // Schrittweite begrenzen
        if (Math.abs(step) < 1e-12) break;
    }
    return E;
}

/**
 * Hyperbolische Kepler-Gleichung  M = e·sinh H - H  nach H auflösen.
 */
export function solveHyperbolicAnomaly(M, e) {
    let H = Math.asinh(M / (e || 1));
    if (!Number.isFinite(H)) H = 0;

    for (let n = 0; n < 80; n++) {
        const f = e * Math.sinh(H) - H - M;
        const df = e * Math.cosh(H) - 1;
        const step = f / (Math.abs(df) < 1e-12 ? 1e-12 : df);
        H -= Math.max(-1, Math.min(1, step));
        if (Math.abs(step) < 1e-13) break;
    }
    return H;
}

/**
 * Barkers Gleichung  M = s + s³/3  mit s = tan(ν/2) für die Parabel.
 * Exakte Lösung über die Cardano-Formel – kein Iterieren nötig.
 */
export function solveBarker(M) {
    const z = Math.cbrt(Math.sqrt(M * M + 1) + Math.abs(M));
    const s = z - 1 / z;
    return M < 0 ? -s : s;
}

/**
 * Wahre Anomalie und Radius für einen Zeitpunkt.
 *
 * @param {{e:number, a:number|null, q:number|null, tp:number}} el Bahnelemente
 * @param {number} jd Julianisches Datum
 * @returns {{trueAnomaly:number, radiusAU:number}|null}
 */
export function solveOrbit(el, jd) {
    const e = Number(el.e);
    const tp = Number(el.tp);
    if (!Number.isFinite(e) || !Number.isFinite(tp)) return null;

    const dt = jd - tp;                       // Tage seit Periheldurchgang
    const PARABOLIC_TOL = 1e-4;

    // Perihelabstand: direkt gegeben oder aus a und e abgeleitet
    const a = Number(el.a);
    let q = Number(el.q);
    if (!Number.isFinite(q) && Number.isFinite(a) && e < 1) q = a * (1 - e);

    if (Math.abs(e - 1) < PARABOLIC_TOL) {
        // Parabel – nur q ist definiert, a wäre unendlich
        if (!Number.isFinite(q) || q <= 0) return null;
        const M = GAUSS_K * dt / Math.sqrt(2 * q * q * q);
        const s = solveBarker(M);
        return {
            trueAnomaly: 2 * Math.atan(s),
            radiusAU: q * (1 + s * s)
        };
    }

    if (e < 1) {
        // Ellipse
        if (!Number.isFinite(a) || a <= 0) return null;
        const n = GAUSS_K / Math.pow(a, 1.5);
        const M = wrapPi(n * dt);
        const E = solveEccentricAnomaly(M, e);
        return {
            trueAnomaly: Math.atan2(Math.sqrt(1 - e * e) * Math.sin(E), Math.cos(E) - e),
            radiusAU: a * (1 - e * Math.cos(E))
        };
    }

    // Hyperbel – a ist in der SBDB negativ, der Betrag ist die Halbachse
    const aHyp = Number.isFinite(a) && a !== 0
        ? Math.abs(a)
        : (Number.isFinite(q) ? q / (e - 1) : NaN);
    if (!Number.isFinite(aHyp) || aHyp <= 0) return null;

    const n = GAUSS_K / Math.pow(aHyp, 1.5);
    const M = n * dt;
    const H = solveHyperbolicAnomaly(M, e);
    return {
        trueAnomaly: Math.atan2(Math.sqrt(e * e - 1) * Math.sinh(H), e - Math.cosh(H)),
        radiusAU: aHyp * (e * Math.cosh(H) - 1)
    };
}

/**
 * Heliozentrische Ekliptik-Koordinaten (J2000) des Kometen in AE.
 */
export function heliocentricEcliptic(el, jd) {
    const solved = solveOrbit(el, jd);
    if (!solved) return null;

    const { trueAnomaly: nu, radiusAU: r } = solved;
    if (!Number.isFinite(nu) || !Number.isFinite(r)) return null;

    const i = Number(el.i) * RAD;
    const om = Number(el.om) * RAD;     // Länge des aufsteigenden Knotens
    const w = Number(el.w) * RAD;       // Argument des Perihels
    if (!Number.isFinite(i) || !Number.isFinite(om) || !Number.isFinite(w)) return null;

    const u = nu + w;                   // Argument der Breite
    const cosU = Math.cos(u), sinU = Math.sin(u);
    const cosOm = Math.cos(om), sinOm = Math.sin(om);
    const cosI = Math.cos(i), sinI = Math.sin(i);

    return {
        x: r * (cosOm * cosU - sinOm * sinU * cosI),
        y: r * (sinOm * cosU + cosOm * sinU * cosI),
        z: r * (sinU * sinI),
        radiusAU: r,
        trueAnomaly: nu
    };
}

/**
 * Heliozentrische Ekliptik-Koordinaten der Erde in AE.
 *
 * Kurzformel aus dem Astronomical Almanac ("low precision formulae for
 * the Sun"): die geozentrische Sonnenposition, umgedreht. Genauigkeit
 * etwa 0,01° – klein gegenüber dem Fehler des Zweikörper-Modells.
 */
export function earthHeliocentricEcliptic(jd) {
    const n = jd - JD_J2000;
    const L = (280.460 + 0.9856474 * n) * RAD;     // mittlere Länge
    const g = (357.528 + 0.9856003 * n) * RAD;     // mittlere Anomalie

    const lambda = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    const R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);

    // Sonne von der Erde aus gesehen → Erde von der Sonne aus ist der Gegenvektor
    return {
        x: -R * Math.cos(lambda),
        y: -R * Math.sin(lambda),
        z: 0,
        radiusAU: R,
        sunLongitude: lambda * DEG
    };
}

/** Mittlere Greenwich-Sternzeit in Grad. */
export function greenwichMeanSiderealTimeDeg(jd) {
    return 280.46061837 + 360.98564736629 * (jd - JD_J2000);
}

/** Schiefe der Ekliptik in Grad. */
function obliquityDeg(jd) {
    return 23.439291 - 3.563e-7 * (jd - JD_J2000);
}

/**
 * Vollständige Position eines Kometen für einen Zeitpunkt.
 *
 * `latitude`/`longitude` beschreiben den Punkt der Erdoberfläche, über
 * dem der Komet im Zenit steht (Subpunkt) – die Richtung ist also echt,
 * nur die Entfernung muss für die Darstellung gestaucht werden.
 *
 * @returns {null|{latitude:number, longitude:number, distanceAU:number,
 *   rightAscensionDeg:number, declinationDeg:number, heliocentricAU:number,
 *   elongationDeg:number}}
 */
export function cometPosition(el, jd) {
    const comet = heliocentricEcliptic(el, jd);
    if (!comet) return null;

    const earth = earthHeliocentricEcliptic(jd);

    // Geozentrischer Vektor in Ekliptik-Koordinaten
    const dx = comet.x - earth.x;
    const dy = comet.y - earth.y;
    const dz = comet.z - earth.z;

    // Ekliptik → Äquator
    const eps = obliquityDeg(jd) * RAD;
    const cosE = Math.cos(eps), sinE = Math.sin(eps);
    const xEq = dx;
    const yEq = dy * cosE - dz * sinE;
    const zEq = dy * sinE + dz * cosE;

    const distance = Math.sqrt(xEq * xEq + yEq * yEq + zEq * zEq);
    if (!Number.isFinite(distance) || distance <= 0) return null;

    const ra = Math.atan2(yEq, xEq) * DEG;
    const dec = Math.asin(Math.max(-1, Math.min(1, zEq / distance))) * DEG;

    // Subpunkt: Rektaszension gegen die Sternzeit verrechnen
    const longitude = wrapDeg180(ra - greenwichMeanSiderealTimeDeg(jd));

    // Elongation: Winkelabstand Komet ↔ Sonne, von der Erde aus gesehen
    const sunDx = -earth.x, sunDy = -earth.y, sunDz = -earth.z;
    const sunDist = Math.sqrt(sunDx * sunDx + sunDy * sunDy + sunDz * sunDz) || 1;
    const dot = (dx * sunDx + dy * sunDy + dz * sunDz) / (distance * sunDist);
    const elongation = Math.acos(Math.max(-1, Math.min(1, dot))) * DEG;

    const raNormalized = wrapDeg180(ra);

    return {
        latitude: dec,
        longitude,
        distanceAU: distance,
        rightAscensionDeg: raNormalized < 0 ? raNormalized + 360 : raNormalized,
        declinationDeg: dec,
        heliocentricAU: comet.radiusAU,
        elongationDeg: elongation
    };
}

/**
 * Nächster Periheldurchgang nach `jd` für eine periodische Bahn.
 * Für nicht-periodische Bahnen bleibt nur das eine `tp`.
 */
export function nextPerihelionJd(el, jd) {
    const tp = Number(el.tp);
    if (!Number.isFinite(tp)) return null;

    const periodDays = Number(el.periodYears) * 365.25;
    if (!Number.isFinite(periodDays) || periodDays <= 0) return tp;

    const turns = Math.ceil((jd - tp) / periodDays);
    return tp + Math.max(0, turns) * periodDays;
}
