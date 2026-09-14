/**
 * loadEnv.mjs – Liest eine .env-Datei ein, bevor der Server startet.
 *
 * Warum eine eigene Datei und kein npm-Paket (dotenv)?
 * Weil dieses Projekt bewusst ohne Abhängigkeiten auskommt – es soll
 * mit einem blanken Node.js laufen, ohne `npm install`.
 *
 * Warum ein eigenes MODUL und nicht einfach eine Funktion in server.mjs?
 * ES-Module werden vollständig ausgewertet, bevor der Rumpf des
 * importierenden Moduls läuft. Nur so stehen die Werte schon bereit,
 * wenn server.mjs seine Konstanten aus process.env liest.
 * Deshalb muss dieser Import in server.mjs ganz OBEN stehen.
 *
 * Vorrang: Bereits gesetzte Umgebungsvariablen gewinnen. Ein
 *   FIRMS_MAP_KEY=... node server/server.mjs
 * überschreibt also den Wert aus der .env-Datei.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.resolve(__dirname, "..", ".env");

function parseEnvFile(text) {
    const values = {};

    for (const rawLine of text.split("\n")) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;

        // Optionales "export " am Zeilenanfang erlauben
        const withoutExport = line.startsWith("export ") ? line.slice(7).trim() : line;

        const eq = withoutExport.indexOf("=");
        if (eq < 1) continue;

        const key = withoutExport.slice(0, eq).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

        let value = withoutExport.slice(eq + 1).trim();

        // Anführungszeichen entfernen; nur in doppelten werden \n aufgelöst
        if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1).replace(/\\n/g, "\n");
        } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
            value = value.slice(1, -1);
        } else {
            // Unquotiert: alles ab einem " #" ist ein Kommentar
            const hash = value.indexOf(" #");
            if (hash >= 0) value = value.slice(0, hash).trim();
        }

        values[key] = value;
    }
    return values;
}

let loadedKeys = [];

try {
    if (fs.existsSync(ENV_FILE)) {
        const values = parseEnvFile(fs.readFileSync(ENV_FILE, "utf8"));
        for (const [key, value] of Object.entries(values)) {
            // Bereits gesetzte Variablen nicht überschreiben
            if (process.env[key] === undefined) {
                process.env[key] = value;
                loadedKeys.push(key);
            }
        }
    }
} catch (err) {
    console.warn("[env] .env konnte nicht gelesen werden:", err.message);
}

/** Welche Variablen kamen aus der .env-Datei? (nur Namen, nie Werte) */
export const loadedFromEnvFile = loadedKeys;
export const envFilePath = ENV_FILE;
