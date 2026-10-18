/**
 * gtfsRealtime.mjs – Minimaler Protobuf-Decoder für GTFS-Realtime.
 *
 * GTFS-Realtime (Google/MobilityData-Standard für Live-ÖPNV-Daten) ist
 * Protocol-Buffers-kodiert, nicht JSON. Weil dieses Projekt bewusst ohne
 * npm-Pakete auskommt (siehe package.json) und ohnehin serverseitig
 * dekodieren muss (die Feeds senden kein CORS), lesen wir das
 * Protobuf-Drahtformat hier selbst aus – genau wie server/kmz.mjs das
 * ZIP-Format selbst liest. Protobuf ist dafür einfacher als ZIP: nur
 * Varints und Length-Delimited-Felder, keine Kompression.
 *
 * Schema-Referenz (stabil, öffentlich dokumentiert):
 * https://gtfs.org/realtime/reference/ – hier werden bewusst nur die für
 * die Kartendarstellung relevanten Felder aus FeedMessage → FeedEntity →
 * VehiclePosition ausgelesen.
 */

/** Liest einen Varint ab Position `pos`. Gibt [wert, neuePosition] zurück. */
function readVarint(buf, pos) {
    let result = 0n;
    let shift = 0n;
    let b;
    do {
        b = buf[pos++];
        result |= BigInt(b & 0x7f) << shift;
        shift += 7n;
    } while (b & 0x80);
    return [result, pos];
}

/**
 * Liest ein einzelnes Feld (Tag + Wert) ab `pos`.
 * @returns {[{fieldNumber:number, wireType:number, value:*}, number]}
 */
function readField(buf, pos) {
    const [tag, afterTag] = readVarint(buf, pos);
    const fieldNumber = Number(tag >> 3n);
    const wireType = Number(tag & 0x7n);
    pos = afterTag;

    if (wireType === 0) {                       // Varint
        const [value, next] = readVarint(buf, pos);
        return [{ fieldNumber, wireType, value }, next];
    }
    if (wireType === 1) {                        // 64-bit (fixed64/double)
        const value = buf.readDoubleLE(pos);
        return [{ fieldNumber, wireType, value }, pos + 8];
    }
    if (wireType === 2) {                         // Length-delimited (Bytes/String/Message)
        const [len, afterLen] = readVarint(buf, pos);
        const length = Number(len);
        const value = buf.subarray(afterLen, afterLen + length);
        return [{ fieldNumber, wireType, value }, afterLen + length];
    }
    if (wireType === 5) {                         // 32-bit (fixed32/float)
        const value = buf.readFloatLE(pos);
        return [{ fieldNumber, wireType, value }, pos + 4];
    }
    throw new Error(`GTFS-RT: unbekannter Wire-Type ${wireType} bei Feld ${fieldNumber}`);
}

/** Zerlegt eine Protobuf-Nachricht in ein Feldnummer → Werte[]-Map. */
function parseMessage(buf) {
    const fields = new Map();
    let pos = 0;
    while (pos < buf.length) {
        const [field, next] = readField(buf, pos);
        if (!fields.has(field.fieldNumber)) fields.set(field.fieldNumber, []);
        fields.get(field.fieldNumber).push(field.value);
        pos = next;
    }
    return fields;
}

const first = (fields, n) => fields.get(n)?.[0];
const text = (fields, n) => {
    const v = first(fields, n);
    return v instanceof Uint8Array ? Buffer.from(v).toString("utf8") : undefined;
};
const num = (fields, n) => {
    const v = first(fields, n);
    return typeof v === "bigint" ? Number(v) : v;
};

// FeedEntity.VehiclePosition.VehicleDescriptor-Feldnummern (GTFS-RT-Schema)
const VEHICLE_STATUS = ["INCOMING_AT", "STOPPED_AT", "IN_TRANSIT_TO"];

/** Zerlegt VehiclePosition.TripDescriptor (Feld 1 auf VehiclePosition-Ebene). */
function parseTripDescriptor(buf) {
    const f = parseMessage(buf);
    return {
        tripId: text(f, 1),
        routeId: text(f, 5),
        directionId: num(f, 6)
    };
}

/** Zerlegt VehiclePosition.Position (Feld 2 auf VehiclePosition-Ebene). */
function parsePosition(buf) {
    const f = parseMessage(buf);
    return {
        latitude: num(f, 1),
        longitude: num(f, 2),
        bearing: num(f, 3),
        speed: num(f, 5)      // m/s laut Schema
    };
}

/** Zerlegt VehiclePosition.VehicleDescriptor (Feld 8). */
function parseVehicleDescriptor(buf) {
    const f = parseMessage(buf);
    return {
        vehicleId: text(f, 1),
        vehicleLabel: text(f, 2)
    };
}

/** Zerlegt eine FeedEntity (Feld 3 der FeedMessage) → VehiclePosition, falls vorhanden. */
function parseEntity(buf) {
    const f = parseMessage(buf);
    const entityId = text(f, 1);
    const vpBuf = first(f, 4);   // FeedEntity.vehicle (VehiclePosition)
    if (!(vpBuf instanceof Uint8Array)) return null;

    const vp = parseMessage(vpBuf);
    const tripBuf = first(vp, 1);
    const posBuf = first(vp, 2);
    const vehBuf = first(vp, 8);
    const position = posBuf instanceof Uint8Array ? parsePosition(posBuf) : null;
    if (!position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) {
        return null;
    }

    const trip = tripBuf instanceof Uint8Array ? parseTripDescriptor(tripBuf) : {};
    const vehicle = vehBuf instanceof Uint8Array ? parseVehicleDescriptor(vehBuf) : {};
    const currentStatus = num(vp, 4);
    const timestamp = num(vp, 5);
    const currentStopSequence = num(vp, 3);
    const stopId = text(vp, 7);

    return {
        id: entityId ?? vehicle.vehicleId ?? trip.tripId ?? `vp-${Math.random().toString(36).slice(2, 9)}`,
        tripId: trip.tripId ?? null,
        routeId: trip.routeId ?? null,
        directionId: trip.directionId ?? null,
        latitude: position.latitude,
        longitude: position.longitude,
        bearing: position.bearing ?? null,
        speed: position.speed ?? null,
        currentStatus: VEHICLE_STATUS[currentStatus] ?? null,
        stopId: stopId ?? null,
        currentStopSequence: currentStopSequence ?? null,
        vehicleId: vehicle.vehicleId ?? null,
        vehicleLabel: vehicle.vehicleLabel ?? null,
        timestamp: timestamp ? timestamp * 1000 : null
    };
}

/**
 * Dekodiert einen GTFS-Realtime-FeedMessage-Buffer (z.B. VehiclePositions.pb)
 * zu einer Liste von Fahrzeugpositionen im obigen, bereits JSON-tauglichen Format.
 * Entities ohne VehiclePosition (z.B. reine TripUpdates/Alerts in gemischten
 * Feeds) werden übersprungen.
 */
export function decodeVehiclePositions(buf) {
    const top = parseMessage(buf);
    const entityBufs = top.get(2) ?? [];   // FeedMessage.entity (wiederholt)
    const vehicles = [];
    for (const entityBuf of entityBufs) {
        if (!(entityBuf instanceof Uint8Array)) continue;
        try {
            const vehicle = parseEntity(entityBuf);
            if (vehicle) vehicles.push(vehicle);
        } catch {
            // Einzelne kaputte Entity überspringen statt den ganzen Feed zu verwerfen
        }
    }
    return vehicles;
}
