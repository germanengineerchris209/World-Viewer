/**
 * dossier.js – Objekt-Dossier-Export als Textdatei.
 *
 * Öffentliches Gotham-Feature nachgebaut ("Bericht zu einem Objekt"):
 * fasst Detailfelder, Kurzbeschreibung und Verknüpfungen eines Objekts
 * in einer Textdatei zusammen, die sich der Nutzer herunterladen kann.
 * Reine Textformatierung bereits vorhandener Daten – kein Server, keine
 * neue Datenquelle.
 */

/**
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.badge
 * @param {Array<[string, string]>} params.rows  Detailfelder (Label, Wert)
 * @param {string} [params.description]          Kurzbeschreibung (z.B. Wikipedia)
 * @param {Array<{object, reason}>} [params.links]  aus linkAnalysis.js
 * @param {Date} [params.generatedAt]
 * @returns {string}
 */
export function buildDossierText({ title, badge, rows, description = "", links = [], generatedAt = new Date() }) {
    const lines = [];

    lines.push("OBJEKT-DOSSIER — World Viewer");
    lines.push(`Erstellt: ${generatedAt.toLocaleString("de-DE")}`);
    lines.push("");
    lines.push(title.toUpperCase());
    lines.push(`Typ: ${badge}`);
    lines.push("");

    lines.push("FELDER");
    for (const [label, value] of rows) {
        lines.push(`  ${label}: ${value}`);
    }

    if (description) {
        lines.push("");
        lines.push("BESCHREIBUNG");
        lines.push(description);
    }

    if (links.length > 0) {
        lines.push("");
        lines.push("VERKNÜPFUNGEN");
        for (const { object, reason } of links) {
            const name = object.metadata?.callsign ?? object.name;
            lines.push(`  ${name} — ${reason}`);
        }
    }

    lines.push("");
    lines.push("---");
    lines.push("Erzeugt von World Viewer auf Basis öffentlicher Live-/Referenzdaten "
        + "(OpenSky, AIS, Wikipedia, ...). Kein Beleg für aktuelle Echtzeitdaten "
        + "über den Erstellungszeitpunkt hinaus.");

    return lines.join("\n");
}

/** Baut einen dateisystem-sicheren Dateinamen aus einem Objektnamen. */
export function dossierFilename(name) {
    const slug = (name || "objekt")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "objekt";
    const stamp = new Date().toISOString().slice(0, 10);
    return `dossier-${slug}-${stamp}.txt`;
}

/** Löst einen Browser-Download der übergebenen Textdatei aus. */
export function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
