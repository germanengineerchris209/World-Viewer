/**
 * kmz.mjs – Minimaler ZIP-Reader + KML-Auszug für NHC-Kegeldateien.
 *
 * Die Vorhersagekegel ("Cone of Uncertainty") des National Hurricane
 * Center gibt es nur als KMZ (gezipptes KML) oder Shapefile – kein
 * GeoJSON. Weil dieses Projekt bewusst ohne npm-Pakete auskommt (siehe
 * package.json), lesen wir das ZIP-Format hier selbst: KMZ ist ein
 * stinknormales ZIP mit genau einer .kml-Datei, Kompression ist
 * entweder "store" oder "deflate" – beides kann Node selbst (zlib).
 */

import zlib from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

/** Findet die "End of Central Directory"-Signatur vom Dateiende her. */
function findEndOfCentralDirectory(buf) {
    const maxCommentLength = 65535;
    const start = Math.max(0, buf.length - 22 - maxCommentLength);
    for (let i = buf.length - 22; i >= start; i--) {
        if (buf.readUInt32LE(i) === EOCD_SIGNATURE) return i;
    }
    return -1;
}

/** Liest alle Einträge eines ZIP/KMZ-Archivs (Name + entpackte Daten). */
function readZipEntries(buf) {
    const eocdOffset = findEndOfCentralDirectory(buf);
    if (eocdOffset === -1) throw new Error("Kein gültiges ZIP/KMZ (EOCD fehlt)");

    const entryCount = buf.readUInt16LE(eocdOffset + 10);
    let cdOffset = buf.readUInt32LE(eocdOffset + 16);

    const entries = [];
    for (let i = 0; i < entryCount; i++) {
        if (buf.readUInt32LE(cdOffset) !== CENTRAL_DIR_SIGNATURE) break;

        const compressionMethod = buf.readUInt16LE(cdOffset + 10);
        const compressedSize = buf.readUInt32LE(cdOffset + 20);
        const fileNameLength = buf.readUInt16LE(cdOffset + 28);
        const extraFieldLength = buf.readUInt16LE(cdOffset + 30);
        const fileCommentLength = buf.readUInt16LE(cdOffset + 32);
        const localHeaderOffset = buf.readUInt32LE(cdOffset + 42);
        const fileName = buf.toString("utf8", cdOffset + 46, cdOffset + 46 + fileNameLength);

        entries.push({ fileName, compressionMethod, compressedSize, localHeaderOffset });
        cdOffset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }
    return entries.map(entry => ({
        fileName: entry.fileName,
        getData: () => extractEntryData(buf, entry)
    }));
}

function extractEntryData(buf, entry) {
    const { compressionMethod, compressedSize, localHeaderOffset } = entry;
    if (buf.readUInt32LE(localHeaderOffset) !== LOCAL_HEADER_SIGNATURE) {
        throw new Error(`Kein gültiger ZIP-Lokalheader bei ${entry.fileName}`);
    }
    const fileNameLength = buf.readUInt16LE(localHeaderOffset + 26);
    const extraFieldLength = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + fileNameLength + extraFieldLength;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) return compressed;          // store
    if (compressionMethod === 8) return zlib.inflateRawSync(compressed); // deflate
    throw new Error(`Nicht unterstützte ZIP-Kompression (Methode ${compressionMethod})`);
}

/** Liest die erste .kml-Datei aus einem KMZ-Archiv als Text. */
export function readKmzAsKml(kmzBuffer) {
    const entries = readZipEntries(kmzBuffer);
    const kml = entries.find(e => /\.kml$/i.test(e.fileName));
    if (!kml) throw new Error("KMZ enthält keine .kml-Datei");
    return kml.getData().toString("utf8");
}

/**
 * Extrahiert das erste Polygon (Kegel) aus NHC-Kegel-KML als
 * [lon, lat]-Paare. NHC liefert eine einzelne Placemark/Polygon
 * pro Datei, daher reicht das erste Vorkommen.
 */
export function extractConePolygon(kmlText) {
    const match = kmlText.match(/<coordinates>([\s\S]*?)<\/coordinates>/i);
    if (!match) return null;

    const pairs = match[1].trim().split(/\s+/).map(tuple => {
        const [lon, lat] = tuple.split(",").map(Number);
        return [lon, lat];
    }).filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));

    return pairs.length >= 3 ? pairs : null;
}
