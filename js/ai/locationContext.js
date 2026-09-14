/**
 * locationContext.js – Sammelt den Kontext, den der KI-Assistent braucht.
 *
 * Der Assistent soll Fragen zum aktuell betrachteten ORT beantworten
 * können. Dafür stellen wir zusammen:
 *
 *   • Kameraposition (Koordinaten + Höhe + ungefährer Sichtbereich)
 *   • Ortsname per Reverse-Geocoding (OpenStreetMap/Nominatim, kostenlos)
 *   • aktuell ausgewähltes Objekt (falls vorhanden)
 *   • Objekte in der Nähe (Flugzeuge, Schiffe, Kameras, Infrastruktur …)
 *
 * Alles ohne API-Key. Nominatim-Ergebnisse werden gecacht, damit der
 * Dienst nicht unnötig belastet wird.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org/reverse";
const geoCache = new Map();

/** Entfernung zwischen zwei Koordinaten in km (Haversine). */
export function distanceKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

/** Ortsname zu Koordinaten ermitteln (leer, wenn nicht erreichbar). */
export async function reverseGeocode(lat, lon, height) {
    // Zoomstufe an die Kamerahöhe koppeln: von Land (3) bis Gebäude (18)
    const zoom = height > 3_000_000 ? 3
        : height > 500_000 ? 6
        : height > 100_000 ? 10
        : height > 20_000 ? 13
        : height > 3_000 ? 16 : 18;

    const key = `${lat.toFixed(2)},${lon.toFixed(2)},${zoom}`;
    if (geoCache.has(key)) return geoCache.get(key);

    const url = `${NOMINATIM}?format=jsonv2&lat=${lat}&lon=${lon}`
        + `&zoom=${zoom}&accept-language=de`;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(String(res.status));

        const data = await res.json();
        const name = data.display_name ?? "";
        geoCache.set(key, name);
        return name;
    } catch {
        // Über Wasser oder Dienst nicht erreichbar → kein Ortsname
        geoCache.set(key, "");
        return "";
    }
}

/** Kurzbeschreibung eines Objekts für den KI-Kontext. */
function describeObject(obj, cameraPos) {
    const m = obj.metadata ?? {};
    const parts = [];

    switch (obj.type) {
        case "aircraft":
            parts.push(`Flugzeug ${m.callsign ?? obj.name}`);
            if (m.aircraftType) parts.push(m.aircraftType);
            if (m.airline) parts.push(m.airline);
            if (m.route) parts.push(`Route ${m.route}`);
            parts.push(`Höhe ${Math.round(obj.position.altitude)} m`);
            parts.push(`${Math.round(obj.speed)} km/h`);
            break;
        case "ship":
            parts.push(`Schiff ${obj.name}`);
            if (m.shipType) parts.push(m.shipType);
            if (m.flag) parts.push(`Flagge ${m.flag}`);
            if (m.destination) parts.push(`Ziel ${m.destination}`);
            parts.push(`${obj.speed} Knoten`);
            break;
        case "satellite":
            parts.push(`Satellit ${obj.name}`);
            if (m.satType) parts.push(m.satType);
            if (m.operator) parts.push(m.operator);
            parts.push(`Bahnhöhe ${m.altitude} km`);
            break;
        case "camera":
            parts.push(`Kamera ${obj.name}`);
            if (m.location) parts.push(m.location);
            parts.push(m.status === "online" ? "online" : "offline");
            break;
        case "infrastructure":
            parts.push(obj.name);
            if (m.category) parts.push(m.category);
            if (m.code) parts.push(m.code);
            if (m.country) parts.push(m.country);
            break;
        default:
            parts.push(obj.name);
    }

    if (cameraPos) {
        const d = distanceKm(cameraPos.latitude, cameraPos.longitude,
            obj.position.latitude, obj.position.longitude);
        parts.push(`${Math.round(d)} km vom Blickpunkt`);
    }
    return `- ${parts.join(", ")}`;
}

/**
 * Baut den vollständigen Kontext-Text für den System-Prompt.
 *
 * @param {WorldViewer} worldViewer
 * @param {LayerManager} layerManager
 * @param {object|null} selectedObject
 */
export async function buildContext(worldViewer, layerManager, selectedObject) {
    const cam = worldViewer.getCameraPosition();
    const lines = [];

    if (!cam) return "Aktuell ist keine Kameraposition verfügbar.";

    const heightText = cam.height > 10000
        ? `${Math.round(cam.height / 1000)} km`
        : `${Math.round(cam.height)} m`;

    lines.push("## Aktueller Blickpunkt des Nutzers");
    lines.push(`Koordinaten: ${cam.latitude.toFixed(4)}, ${cam.longitude.toFixed(4)}`);
    lines.push(`Kamerahöhe: ${heightText}`);

    const place = await reverseGeocode(cam.latitude, cam.longitude, cam.height);
    if (place) {
        lines.push(`Ort laut OpenStreetMap: ${place}`);
    } else {
        lines.push("Ort: kein Treffer (vermutlich über Wasser oder unbewohntem Gebiet)");
    }

    // Ausgewähltes Objekt
    if (selectedObject) {
        lines.push("");
        lines.push("## Vom Nutzer ausgewähltes Objekt");
        lines.push(describeObject(selectedObject, cam).replace(/^- /, ""));
        const extract = selectedObject.__wikiExtract;
        if (extract) {
            lines.push(`Hintergrund (Wikipedia): ${extract}`);
        }
    }

    // Objekte in der Nähe – Radius abhängig von der Zoomstufe
    const radiusKm = Math.max(50, Math.min(cam.height / 1000 * 1.2, 2000));
    const nearby = [];

    for (const layer of layerManager.getAll()) {
        if (!layer.enabled) continue;
        for (const obj of layer.objects) {
            const d = distanceKm(cam.latitude, cam.longitude,
                obj.position.latitude, obj.position.longitude);
            if (d <= radiusKm) nearby.push({ obj, d });
        }
    }
    nearby.sort((a, b) => a.d - b.d);

    if (nearby.length) {
        lines.push("");
        lines.push(`## Objekte im Umkreis von ${Math.round(radiusKm)} km (max. 15)`);
        for (const { obj } of nearby.slice(0, 15)) {
            lines.push(describeObject(obj, cam));
        }
        if (nearby.length > 15) {
            lines.push(`… und ${nearby.length - 15} weitere.`);
        }
    } else {
        lines.push("");
        lines.push("## Objekte in der Nähe");
        lines.push("Im sichtbaren Bereich sind derzeit keine Objekte aktiv.");
    }

    return lines.join("\n");
}

/** Der feste Teil des System-Prompts. */
export const SYSTEM_PROMPT_BASE = `Du bist der Assistent im "World Viewer", einer 3D-Globus-Anwendung.
Der Nutzer betrachtet gerade einen bestimmten Ort auf der Erde und stellt dazu Fragen.

Deine Aufgabe:
- Beantworte Fragen zum betrachteten Ort: Geografie, Geschichte, Sehenswürdigkeiten, Wirtschaft, Verkehr, Klima, Besonderheiten.
- Beziehe die unten angegebenen Live-Daten (Flugzeuge, Schiffe, Satelliten, Kameras, Infrastruktur) ein, wenn sie zur Frage passen.
- Antworte auf Deutsch, sachlich, kompakt und gut lesbar. Nutze kurze Absätze, bei Aufzählungen Listen.
- Halte dich kurz: normalerweise 2–5 Sätze, nur bei ausdrücklichem Wunsch ausführlicher.
- Wenn du etwas nicht sicher weißt, sage das offen, statt zu raten.

Wichtiger Hinweis zu den Daten: Die Positionen von Flugzeugen und Schiffen stammen in dieser
Version aus einer Simulation mit realistischen, aber erfundenen Startwerten. Behandle sie als
Beispieldaten und stelle sie nicht als echte Live-Verkehrsdaten dar, wenn der Nutzer danach fragt.`;
