/**
 * volcanoLabels.mjs – Deutsche Bezeichnungen für die GVP-Vulkandaten.
 *
 * Das Smithsonian Global Volcanism Program liefert Länder- und Typnamen
 * ausschließlich auf Englisch. Die Oberfläche ist deutsch, also werden sie
 * hier übersetzt. Unbekannte Werte werden unverändert durchgereicht –
 * so bleibt die Karte auch dann korrekt, wenn das GVP neue Kategorien
 * einführt (lieber englisch als leer).
 *
 * Genutzt von server/dataProxies.mjs (Live-Abruf) und von
 * scripts/build-volcano-fallback.mjs (Offline-Schnappschuss), damit beide
 * Wege garantiert dieselben Bezeichnungen verwenden.
 */

/** GVP-"Country" → deutscher Ländername. */
const COUNTRY_DE = {
    "Antarctica": "Antarktis",
    "Australia": "Australien",
    "Cabo Verde": "Kap Verde",
    "Cameroon": "Kamerun",
    "Chile": "Chile",
    "Chile-Argentina": "Chile–Argentinien",
    "Chile-Bolivia": "Chile–Bolivien",
    "China": "China",
    "China-North Korea": "China–Nordkorea",
    "Colombia": "Kolumbien",
    "Colombia-Ecuador": "Kolumbien–Ecuador",
    "Costa Rica": "Costa Rica",
    "DR Congo": "DR Kongo",
    "Djibouti": "Dschibuti",
    "Dominica": "Dominica",
    "Ecuador": "Ecuador",
    "El Salvador": "El Salvador",
    "Equatorial Guinea": "Äquatorialguinea",
    "Eritrea": "Eritrea",
    "Ethiopia": "Äthiopien",
    "Ethiopia-Djibouti": "Äthiopien–Dschibuti",
    "France": "Frankreich",
    "France - claimed by Vanuatu": "Frankreich (von Vanuatu beansprucht)",
    "Greece": "Griechenland",
    "Grenada": "Grenada",
    "Guatemala": "Guatemala",
    "Iceland": "Island",
    "India": "Indien",
    "Indonesia": "Indonesien",
    "Italy": "Italien",
    "Japan": "Japan",
    "Japan - administered by Russia": "Japan (von Russland verwaltet)",
    "Kenya": "Kenia",
    "Mexico": "Mexiko",
    "Mexico-Guatemala": "Mexiko–Guatemala",
    "New Zealand": "Neuseeland",
    "Nicaragua": "Nicaragua",
    "Norway": "Norwegen",
    "Papua New Guinea": "Papua-Neuguinea",
    "Peru": "Peru",
    "Philippines": "Philippinen",
    "Portugal": "Portugal",
    "Russia": "Russland",
    "Saint Vincent and the Grenadines": "St. Vincent und die Grenadinen",
    "Samoa": "Samoa",
    "Solomon Islands": "Salomonen",
    "South Africa": "Südafrika",
    "Spain": "Spanien",
    "Tanzania": "Tansania",
    "Tonga": "Tonga",
    "Undersea Features": "Unterseeische Vulkane",
    "Union of the Comoros": "Komoren",
    "United Kingdom": "Vereinigtes Königreich",
    "United States": "USA",
    "Vanuatu": "Vanuatu",
    "Vietnam": "Vietnam",
    "Yemen": "Jemen"
};

/** GVP-"Primary_Volcano_Type" → deutsche Bezeichnung. */
const TYPE_DE = {
    "Caldera": "Caldera",
    "Caldera(s)": "Caldera",
    "Complex": "Komplexvulkan",
    "Compound": "Mehrfachvulkan",
    "Cone": "Vulkankegel",
    "Crater rows": "Kraterreihen",
    "Explosion crater(s)": "Explosionskrater",
    "Fissure vent": "Eruptionsspalte",
    "Fissure vent(s)": "Eruptionsspalten",
    "Lava cone": "Lavakegel",
    "Lava dome": "Lavadom",
    "Lava dome(s)": "Lavadome",
    "Maar(s)": "Maar",
    "Pyroclastic cone": "Pyroklastischer Kegel",
    "Pyroclastic cone(s)": "Pyroklastische Kegel",
    "Shield": "Schildvulkan",
    "Shield(s)": "Schildvulkane",
    "Shield(pyroclastic)": "Schildvulkan (pyroklastisch)",
    "Stratovolcano": "Stratovulkan",
    "Stratovolcano(es)": "Stratovulkane",
    "Stratovolcano?": "Stratovulkan (unsicher)",
    "Volcanic field": "Vulkanfeld"
};

export function countryDe(value) {
    const raw = String(value ?? "").trim();
    return COUNTRY_DE[raw] ?? raw;
}

export function typeDe(value) {
    const raw = String(value ?? "").trim();
    return TYPE_DE[raw] ?? raw;
}

/**
 * GVP schreibt manche Namen invertiert, damit sie sich alphabetisch
 * einsortieren ("Ruiz, Nevado del"). Für die Karte drehen wir das zurück.
 */
export function displayName(value) {
    const raw = String(value ?? "").trim();
    const parts = raw.split(", ");
    return parts.length === 2 ? `${parts[1]} ${parts[0]}` : raw;
}
