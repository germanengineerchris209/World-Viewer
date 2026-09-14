/**
 * imageProvider.js – Liefert zu JEDEM Objekt ein Bild.
 *
 * Kaskade (erster Treffer gewinnt):
 *   1. `imageUrl` direkt im Datensatz               → sofort
 *   2. Wikipedia-Vorschaubild (REST-API, CORS-frei) → echtes Foto
 *   3. Generierte SVG-Illustration                  → immer verfügbar
 *
 * Die Wikipedia-Abfrage liefert zusätzlich einen Kurztext ("extract"),
 * der im Detailpanel angezeigt und dem KI-Assistenten als Kontext
 * mitgegeben wird.
 *
 * Alle Ergebnisse werden im Speicher gecacht, damit dasselbe Objekt
 * nicht mehrfach abgefragt wird.
 */

import { createIllustration } from "./illustrations.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.images ?? {};

/** Cache: cacheKey → { url, credit, extract, source, pageUrl } */
const cache = new Map();
/** Laufende Abfragen, damit parallele Aufrufe nicht doppelt fetchen */
const inflight = new Map();

/**
 * Bestimmt die Wikipedia-Suchbegriffe für ein Objekt.
 * Reihenfolge = Priorität.
 */
function wikipediaCandidates(obj) {
    const m = obj.metadata ?? {};
    const list = [];

    // Explizit im Datensatz hinterlegt (genauester Treffer)
    if (m.wikipedia) list.push(m.wikipedia);

    switch (obj.type) {
        case "aircraft":
            // Flugzeugtyp (z.B. "Airbus A320") – das Foto zeigt den Flugzeugtyp
            if (m.aircraftType) list.push(m.aircraftType);
            break;
        case "ship":
        case "satellite":
        case "infrastructure":
        case "camera":
            if (obj.name) list.push(obj.name);
            break;
    }
    return list.filter(Boolean);
}

/** Wikipedia-REST-Abfrage für einen Titel in einer Sprache. */
async function fetchWikipediaSummary(title, lang, signal) {
    const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/`
        + encodeURIComponent(title.replace(/ /g, "_"));

    const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;

    const data = await res.json();
    // Begriffsklärungsseiten liefern kein brauchbares Bild
    if (data.type && data.type.includes("disambiguation")) return null;

    const src = data.thumbnail?.source ?? data.originalimage?.source;
    if (!src) return null;

    // Wikipedia liefert kleine Thumbnails – auf größere Breite hochskalieren
    const bigger = src.replace(/\/(\d+)px-/, "/640px-");

    return {
        url: bigger,
        credit: `Wikipedia (${lang.toUpperCase()})`,
        extract: data.extract ?? "",
        pageUrl: data.content_urls?.desktop?.page ?? "",
        source: "wikipedia"
    };
}

/**
 * Sucht ein Bild für ein Objekt.
 * Liefert IMMER ein Ergebnis (notfalls die generierte Illustration).
 *
 * @param {object} obj normalisiertes Objekt
 * @returns {Promise<{url:string, credit:string, extract:string, pageUrl:string, source:string}>}
 */
export async function getObjectImage(obj) {
    const cfg = CFG();
    const key = `${obj.type}:${obj.metadata?.wikipedia ?? obj.metadata?.aircraftType ?? obj.name}`;

    if (cache.has(key)) return cache.get(key);
    if (inflight.has(key)) return inflight.get(key);

    const fallback = {
        url: createIllustration(obj),
        credit: "Illustration",
        extract: "",
        pageUrl: "",
        source: "illustration"
    };

    // 1) Direkt hinterlegte Bild-URL
    if (obj.metadata?.imageUrl) {
        const result = {
            url: obj.metadata.imageUrl,
            credit: obj.metadata.imageCredit ?? "",
            extract: "",
            pageUrl: "",
            source: "direct"
        };
        cache.set(key, result);
        return result;
    }

    // 2) Wikipedia (abschaltbar über config.js)
    if (cfg.useWikipedia === false) {
        cache.set(key, fallback);
        return fallback;
    }

    const task = (async () => {
        const languages = cfg.wikipediaLanguages ?? ["de", "en"];
        const candidates = wikipediaCandidates(obj);

        // Timeout, damit ein hängender Request das UI nicht blockiert
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), cfg.timeoutMs ?? 6000);

        try {
            for (const title of candidates) {
                for (const lang of languages) {
                    try {
                        const hit = await fetchWikipediaSummary(title, lang, controller.signal);
                        if (hit) {
                            cache.set(key, hit);
                            return hit;
                        }
                    } catch (err) {
                        if (err.name === "AbortError") throw err;
                        // einzelne Fehlschläge sind normal → nächster Kandidat
                    }
                }
            }
        } catch (err) {
            console.debug("[imageProvider] Wikipedia-Abfrage abgebrochen:", err.name);
        } finally {
            clearTimeout(timer);
            inflight.delete(key);
        }

        cache.set(key, fallback);
        return fallback;
    })();

    inflight.set(key, task);
    return task;
}

/** Sofort verfügbares Platzhalterbild (ohne Netzwerk). */
export function getPlaceholderImage(obj) {
    return createIllustration(obj);
}
