/**
 * illustrations.js – Generierte SVG-Illustrationen als Bild-Fallback.
 *
 * Damit hat JEDES Objekt garantiert ein Bild – auch dann, wenn es
 * zu ihm kein Foto im Netz gibt oder der Nutzer offline arbeitet.
 * Die Illustrationen sind reine Vektorgrafiken (data:-URI), also
 * scharf auf jedem Display und ohne externe Datei.
 */

/* ─── Silhouetten je Untertyp ─────────────────────────────────── */

const SILHOUETTES = {
    /* Flugzeuge – Draufsicht */
    "aircraft.narrowbody": `
        <path d="M200 40 C210 40 216 58 218 82 L300 122 L300 140 L218 122 L216 172
                 L246 196 L246 210 L200 198 L154 210 L154 196 L184 172 L182 122
                 L100 140 L100 122 L182 82 C184 58 190 40 200 40 Z"/>`,
    "aircraft.widebody": `
        <path d="M200 30 C212 30 219 52 221 80 L330 128 L330 148 L221 126 L219 178
                 L254 204 L254 220 L200 206 L146 220 L146 204 L181 178 L179 126
                 L70 148 L70 128 L179 80 C181 52 188 30 200 30 Z"/>
        <ellipse cx="152" cy="132" rx="13" ry="20"/><ellipse cx="248" cy="132" rx="13" ry="20"/>`,
    "aircraft.jumbo": `
        <path d="M200 26 C214 26 222 50 224 80 L344 132 L344 154 L224 130 L222 182
                 L258 208 L258 226 L200 212 L142 226 L142 208 L178 182 L176 130
                 L56 154 L56 132 L176 80 C178 50 186 26 200 26 Z"/>
        <ellipse cx="128" cy="140" rx="12" ry="19"/><ellipse cx="164" cy="128" rx="12" ry="19"/>
        <ellipse cx="236" cy="128" rx="12" ry="19"/><ellipse cx="272" cy="140" rx="12" ry="19"/>`,

    /* Schiffe – Seitenansicht */
    "ship.container": `
        <path d="M40 178 L360 178 L336 220 L64 220 Z"/>
        <rect x="70" y="140" width="200" height="38" rx="3"/>
        <rect x="70" y="112" width="150" height="26" rx="3"/>
        <rect x="286" y="118" width="52" height="60" rx="4"/>
        <rect x="296" y="96" width="14" height="22"/>`,
    "ship.cruise": `
        <path d="M40 180 L360 180 L332 222 L66 222 Z"/>
        <rect x="66" y="146" width="266" height="34" rx="6"/>
        <rect x="92" y="116" width="212" height="30" rx="6"/>
        <rect x="126" y="92" width="146" height="24" rx="6"/>
        <ellipse cx="200" cy="84" rx="20" ry="10"/>`,
    "ship.tanker": `
        <path d="M34 182 L366 182 L340 224 L60 224 Z"/>
        <rect x="60" y="152" width="228" height="30" rx="4"/>
        <ellipse cx="112" cy="152" rx="26" ry="12"/><ellipse cx="176" cy="152" rx="26" ry="12"/>
        <ellipse cx="240" cy="152" rx="26" ry="12"/>
        <rect x="300" y="120" width="46" height="62" rx="4"/>`,
    "ship.bulk": `
        <path d="M40 180 L360 180 L334 222 L66 222 Z"/>
        <rect x="66" y="150" width="222" height="30" rx="3"/>
        <path d="M84 150 L120 118 L156 150 Z"/><path d="M164 150 L200 118 L236 150 Z"/>
        <rect x="298" y="122" width="48" height="58" rx="4"/>`,
    "ship.research": `
        <path d="M60 178 L340 178 L318 218 L82 218 Z"/>
        <rect x="96" y="146" width="180" height="32" rx="4"/>
        <rect x="140" y="118" width="92" height="28" rx="4"/>
        <path d="M186 118 L186 78 M166 88 L206 88" stroke-width="7" stroke-linecap="round" fill="none"/>
        <circle cx="264" cy="128" r="17"/>`,
    "ship.car": `
        <path d="M40 182 L360 182 L336 222 L64 222 Z"/>
        <rect x="64" y="106" width="272" height="76" rx="6"/>
        <rect x="88" y="122" width="224" height="8"/><rect x="88" y="142" width="224" height="8"/>
        <rect x="88" y="162" width="224" height="8"/>`,

    /* Satelliten */
    "satellite.station": `
        <rect x="176" y="118" width="48" height="72" rx="10"/>
        <rect x="60" y="126" width="106" height="56" rx="4"/>
        <rect x="234" y="126" width="106" height="56" rx="4"/>
        <path d="M60 154 H340" stroke-width="4" fill="none"/>
        <rect x="192" y="86" width="16" height="32" rx="4"/>
        <circle cx="200" cy="204" r="14"/>`,
    "satellite.telescope": `
        <rect x="140" y="86" width="120" height="140" rx="18"/>
        <ellipse cx="200" cy="86" rx="60" ry="16"/>
        <rect x="52" y="128" width="86" height="56" rx="4"/>
        <rect x="262" y="128" width="86" height="56" rx="4"/>`,
    "satellite.comsat": `
        <rect x="168" y="122" width="64" height="66" rx="8"/>
        <rect x="46" y="132" width="116" height="46" rx="4"/>
        <rect x="238" y="132" width="116" height="46" rx="4"/>
        <path d="M200 122 L200 96" stroke-width="6" fill="none"/>
        <ellipse cx="200" cy="86" rx="34" ry="14"/>`,
    "satellite.navsat": `
        <rect x="170" y="116" width="60" height="78" rx="8"/>
        <rect x="52" y="130" width="112" height="50" rx="4"/>
        <rect x="236" y="130" width="112" height="50" rx="4"/>
        <path d="M200 194 L184 226 H216 Z"/>
        <circle cx="200" cy="100" r="12"/>`,
    "satellite.weather": `
        <rect x="166" y="110" width="68" height="90" rx="10"/>
        <ellipse cx="200" cy="102" rx="42" ry="16"/>
        <rect x="58" y="134" width="102" height="46" rx="4"/>
        <rect x="240" y="134" width="102" height="46" rx="4"/>
        <circle cx="200" cy="152" r="16"/>`,

    /* Kamera */
    "camera.default": `
        <rect x="72" y="118" width="150" height="94" rx="14"/>
        <path d="M222 142 L318 108 L318 222 L222 188 Z"/>
        <circle cx="147" cy="165" r="34"/><circle cx="147" cy="165" r="17"/>
        <rect x="96" y="212" width="26" height="34" rx="4"/>`,

    /* Infrastruktur */
    "infra.airport": `
        <rect x="40" y="196" width="320" height="30" rx="4"/>
        <path d="M64 196 L64 150 L150 150 L150 196 Z"/>
        <path d="M150 150 Q200 108 250 150 L250 196 L150 196 Z"/>
        <rect x="276" y="112" width="16" height="84" rx="4"/>
        <path d="M258 112 L310 112 L300 138 L268 138 Z"/>`,
    "infra.port": `
        <rect x="40" y="204" width="320" height="22" rx="3"/>
        <path d="M92 204 L92 88 L108 88 L108 204 Z"/>
        <path d="M92 100 L250 100 L250 116 L92 116 Z"/>
        <path d="M230 116 L230 152" stroke-width="7" fill="none"/>
        <rect x="212" y="152" width="38" height="26" rx="3"/>
        <rect x="272" y="168" width="34" height="20" rx="2"/><rect x="272" y="146" width="34" height="20" rx="2"/>`,
    "infra.station": `
        <rect x="40" y="206" width="320" height="20" rx="3"/>
        <rect x="88" y="112" width="224" height="94" rx="10"/>
        <path d="M74 112 L326 112 L300 78 L100 78 Z"/>
        <rect x="118" y="140" width="40" height="66" rx="4"/>
        <rect x="180" y="140" width="40" height="66" rx="4"/>
        <rect x="242" y="140" width="40" height="66" rx="4"/>`,
    "infra.powerplant": `
        <rect x="40" y="206" width="320" height="20" rx="3"/>
        <path d="M96 206 L112 108 L168 108 L184 206 Z"/>
        <path d="M206 206 L222 122 L268 122 L284 206 Z"/>
        <ellipse cx="140" cy="104" rx="30" ry="12"/>
        <ellipse cx="245" cy="118" rx="24" ry="10"/>
        <rect x="304" y="146" width="26" height="60" rx="3"/>`,
    "infra.landmark": `
        <rect x="40" y="212" width="320" height="16" rx="3"/>
        <path d="M148 212 L200 66 L252 212 Z"/>
        <path d="M170 152 L230 152 L238 176 L162 176 Z"/>
        <circle cx="200" cy="52" r="10"/>`,
    "infra.industry": `
        <rect x="40" y="208" width="320" height="18" rx="3"/>
        <rect x="70" y="140" width="120" height="68" rx="4"/>
        <path d="M70 140 L100 112 L130 140 Z"/><path d="M130 140 L160 112 L190 140 Z"/>
        <rect x="212" y="108" width="30" height="100" rx="3"/>
        <rect x="262" y="150" width="76" height="58" rx="4"/>`,

    "generic": `
        <circle cx="200" cy="150" r="58"/>
        <rect x="150" y="196" width="100" height="16" rx="8"/>`
};

/* Farbschema je Objekttyp */
const PALETTE = {
    aircraft:       { from: "#1e293b", to: "#0b1220", fg: "#ffd166", glow: "#ffd16633" },
    ship:           { from: "#0b2438", to: "#061420", fg: "#4ade80", glow: "#4ade8033" },
    satellite:      { from: "#0a1430", to: "#050a18", fg: "#38bdf8", glow: "#38bdf833" },
    camera:         { from: "#221033", to: "#100718", fg: "#c084fc", glow: "#c084fc33" },
    infrastructure: { from: "#132018", to: "#080f0b", fg: "#34d399", glow: "#34d39933" },
    generic:        { from: "#1a1f2b", to: "#0b0e14", fg: "#e5e9f0", glow: "#e5e9f033" }
};

/**
 * Ermittelt den passenden Silhouetten-Schlüssel aus den Metadaten.
 */
function pickSilhouette(obj) {
    const m = obj.metadata ?? {};
    const t = (s) => String(s ?? "").toLowerCase();

    if (obj.type === "aircraft") {
        const model = t(m.aircraftType);
        if (/747|a380|a340/.test(model)) return "aircraft.jumbo";
        if (/777|787|a330|a350|767|a340|md-11/.test(model)) return "aircraft.widebody";
        return "aircraft.narrowbody";
    }
    if (obj.type === "ship") {
        const st = t(m.shipType);
        if (/kreuzfahrt|cruise|passagier/.test(st)) return "ship.cruise";
        if (/tanker|öl|oil|lng|gas/.test(st)) return "ship.tanker";
        if (/massengut|bulk/.test(st)) return "ship.bulk";
        if (/forschung|research/.test(st)) return "ship.research";
        if (/auto|car|roro/.test(st)) return "ship.car";
        return "ship.container";
    }
    if (obj.type === "satellite") {
        const st = t(m.satType);
        if (/station/.test(st)) return "satellite.station";
        if (/teleskop|telescope/.test(st)) return "satellite.telescope";
        if (/navigation/.test(st)) return "satellite.navsat";
        if (/wetter|weather|meteo/.test(st)) return "satellite.weather";
        return "satellite.comsat";
    }
    if (obj.type === "camera") return "camera.default";
    if (obj.type === "infrastructure") {
        const cat = t(m.category);
        return SILHOUETTES[`infra.${cat}`] ? `infra.${cat}` : "infra.landmark";
    }
    return "generic";
}

/**
 * Erzeugt eine Illustration als data:-URI.
 * @param {object} obj  normalisiertes Objekt
 * @returns {string} data:image/svg+xml;base64,…
 */
export function createIllustration(obj) {
    const palette = PALETTE[obj.type] ?? PALETTE.generic;
    const key = pickSilhouette(obj);
    const shape = SILHOUETTES[key] ?? SILHOUETTES.generic;
    const uid = key.replace(/\W/g, "");

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="260" viewBox="0 0 400 260">
  <defs>
    <linearGradient id="bg${uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${palette.from}"/><stop offset="1" stop-color="${palette.to}"/>
    </linearGradient>
    <radialGradient id="gl${uid}" cx="0.5" cy="0.55" r="0.55">
      <stop offset="0" stop-color="${palette.fg}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${palette.fg}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="400" height="260" fill="url(#bg${uid})"/>
  <rect width="400" height="260" fill="url(#gl${uid})"/>
  <g stroke="${palette.fg}" stroke-opacity="0.10" stroke-width="1">
    <path d="M0 65 H400 M0 130 H400 M0 195 H400 M100 0 V260 M200 0 V260 M300 0 V260"/>
  </g>
  <g fill="${palette.fg}" stroke="${palette.fg}" transform="translate(0,-8)">${shape}</g>
</svg>`;

    return "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
}
