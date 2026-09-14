/**
 * aircraftTypes.js – Übersetzt ICAO-Typcodes in lesbare Namen.
 *
 * Live-Daten liefern den Flugzeugtyp als kurzen ICAO-Code ("A320", "B77W").
 * Für die Anzeige und für die Wikipedia-Bildsuche brauchen wir daraus
 * einen sprechenden Namen bzw. einen Artikeltitel.
 *
 * Die Liste deckt die im Linienverkehr häufigsten Muster ab; unbekannte
 * Codes werden unverändert durchgereicht (dann greift die generierte
 * Illustration als Bild).
 */

const TYPES = {
    // ── Airbus Schmalrumpf ──
    A318: ["Airbus A318", "Airbus A320"],
    A319: ["Airbus A319", "Airbus A320"],
    A320: ["Airbus A320", "Airbus A320"],
    A321: ["Airbus A321", "Airbus A320"],
    A19N: ["Airbus A319neo", "Airbus A320neo"],
    A20N: ["Airbus A320neo", "Airbus A320neo"],
    A21N: ["Airbus A321neo", "Airbus A320neo"],

    // ── Airbus Großraum ──
    A306: ["Airbus A300-600", "Airbus A300"],
    A310: ["Airbus A310", "Airbus A310"],
    A332: ["Airbus A330-200", "Airbus A330"],
    A333: ["Airbus A330-300", "Airbus A330"],
    A337: ["Airbus A330-700 Beluga XL", "Airbus Beluga XL"],
    A338: ["Airbus A330-800neo", "Airbus A330neo"],
    A339: ["Airbus A330-900neo", "Airbus A330neo"],
    A342: ["Airbus A340-200", "Airbus A340"],
    A343: ["Airbus A340-300", "Airbus A340"],
    A345: ["Airbus A340-500", "Airbus A340"],
    A346: ["Airbus A340-600", "Airbus A340"],
    A359: ["Airbus A350-900", "Airbus A350"],
    A35K: ["Airbus A350-1000", "Airbus A350"],
    A388: ["Airbus A380-800", "Airbus A380"],

    // ── Boeing Schmalrumpf ──
    B712: ["Boeing 717-200", "Boeing 717"],
    B733: ["Boeing 737-300", "Boeing 737"],
    B734: ["Boeing 737-400", "Boeing 737"],
    B735: ["Boeing 737-500", "Boeing 737"],
    B736: ["Boeing 737-600", "Boeing 737"],
    B737: ["Boeing 737-700", "Boeing 737"],
    B738: ["Boeing 737-800", "Boeing 737"],
    B739: ["Boeing 737-900", "Boeing 737"],
    B37M: ["Boeing 737 MAX 7", "Boeing 737 MAX"],
    B38M: ["Boeing 737 MAX 8", "Boeing 737 MAX"],
    B39M: ["Boeing 737 MAX 9", "Boeing 737 MAX"],
    B3XM: ["Boeing 737 MAX 10", "Boeing 737 MAX"],
    B752: ["Boeing 757-200", "Boeing 757"],
    B753: ["Boeing 757-300", "Boeing 757"],

    // ── Boeing Großraum ──
    B762: ["Boeing 767-200", "Boeing 767"],
    B763: ["Boeing 767-300", "Boeing 767"],
    B764: ["Boeing 767-400", "Boeing 767"],
    B772: ["Boeing 777-200", "Boeing 777"],
    B77L: ["Boeing 777-200LR", "Boeing 777"],
    B773: ["Boeing 777-300", "Boeing 777"],
    B77W: ["Boeing 777-300ER", "Boeing 777"],
    B778: ["Boeing 777-8", "Boeing 777X"],
    B779: ["Boeing 777-9", "Boeing 777X"],
    B788: ["Boeing 787-8 Dreamliner", "Boeing 787"],
    B789: ["Boeing 787-9 Dreamliner", "Boeing 787"],
    B78X: ["Boeing 787-10 Dreamliner", "Boeing 787"],
    B741: ["Boeing 747-100", "Boeing 747"],
    B742: ["Boeing 747-200", "Boeing 747"],
    B743: ["Boeing 747-300", "Boeing 747"],
    B744: ["Boeing 747-400", "Boeing 747-400"],
    B748: ["Boeing 747-8", "Boeing 747-8"],
    B74F: ["Boeing 747 Frachter", "Boeing 747"],

    // ── Embraer / Bombardier / Regional ──
    E170: ["Embraer E170", "Embraer E-Jets"],
    E175: ["Embraer E175", "Embraer E-Jets"],
    E190: ["Embraer E190", "Embraer E-Jets"],
    E195: ["Embraer E195", "Embraer E-Jets"],
    E290: ["Embraer E190-E2", "Embraer E-Jets E2"],
    E295: ["Embraer E195-E2", "Embraer E-Jets E2"],
    BCS1: ["Airbus A220-100", "Airbus A220"],
    BCS3: ["Airbus A220-300", "Airbus A220"],
    CRJ2: ["Bombardier CRJ200", "Bombardier CRJ"],
    CRJ7: ["Bombardier CRJ700", "Bombardier CRJ700"],
    CRJ9: ["Bombardier CRJ900", "Bombardier CRJ700"],
    CRJX: ["Bombardier CRJ1000", "Bombardier CRJ700"],
    DH8D: ["De Havilland Dash 8-400", "De Havilland Canada Dash 8"],
    AT72: ["ATR 72", "ATR 72"],
    AT76: ["ATR 72-600", "ATR 72"],
    AT45: ["ATR 42", "ATR 42"],

    // ── Sonstige ──
    MD11: ["McDonnell Douglas MD-11", "McDonnell Douglas MD-11"],
    MD82: ["McDonnell Douglas MD-82", "McDonnell Douglas MD-80"],
    MD88: ["McDonnell Douglas MD-88", "McDonnell Douglas MD-80"],
    SU95: ["Suchoi Superjet 100", "Suchoi Superjet 100"],
    C172: ["Cessna 172", "Cessna 172"],
    C25A: ["Cessna Citation CJ2", "Cessna Citation"],
    GLF6: ["Gulfstream G650", "Gulfstream G650"],
    PC12: ["Pilatus PC-12", "Pilatus PC-12"],
    E55P: ["Embraer Phenom 300", "Embraer Phenom 300"]
};

/**
 * Lesbarer Name zu einem Typcode.
 * @returns {string} z.B. "Boeing 777-300ER"; unbekannte Codes unverändert
 */
export function typeName(code) {
    if (!code) return "";
    return TYPES[code.toUpperCase()]?.[0] ?? code;
}

/**
 * Wikipedia-Artikeltitel zu einem Typcode (für die Bildsuche).
 * @returns {string} leer, wenn kein passender Artikel bekannt ist
 */
export function typeWikipedia(code) {
    if (!code) return "";
    return TYPES[code.toUpperCase()]?.[1] ?? "";
}

/**
 * Grobe Größenklasse – steuert die Symbolgröße auf der Karte.
 * @returns {"heavy"|"medium"|"light"}
 */
export function sizeClass(code) {
    if (!code) return "medium";
    const c = code.toUpperCase();
    if (/^(A38|B74|A34|B77|B78|A35|A33|B76|MD11|A30|A31)/.test(c)) return "heavy";
    if (/^(C1|C2|PC|GLF|E55|BE|DA|SR2|P28|TBM)/.test(c)) return "light";
    return "medium";
}
