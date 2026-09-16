/**
 * aisStream.mjs – Echte Schiffsdaten (AIS) über AISStream.io.
 *
 * AISStream (https://aisstream.io) sendet Positions- und Stammdaten von
 * Schiffen per WebSocket, kostenlos mit einem selbst angeforderten Key.
 *
 * Warum ein selbstgebauter WebSocket-Client? Dieses Projekt kommt bewusst
 * ohne npm-Pakete aus (siehe server.mjs). Node 18/20 haben noch kein
 * stabiles globales `WebSocket` für ausgehende Client-Verbindungen (das
 * kam erst in Node 22) – deshalb hier ein schlanker RFC-6455-Client,
 * beschränkt auf das, was AISStream tatsächlich braucht: ein TLS-Handshake,
 * Text-Frames senden/empfangen, Ping/Pong, Close.
 *
 * Ablauf:
 *   1. TLS-Verbindung zu stream.aisstream.io, HTTP-Upgrade-Handshake
 *   2. Abo-Nachricht mit API-Key + Bounding-Box senden
 *   3. Eingehende PositionReport-/ShipStaticData-Nachrichten je MMSI in
 *      unser einheitliches Format zusammenführen
 *   4. Wachhund: Kommt länger als WATCHDOG_TIMEOUT_MS keine Nachricht an,
 *      gilt die Verbindung als tot → Neuverbindung mit steigender Pause.
 */

import crypto from "node:crypto";
import tls from "node:tls";

const HOST = "stream.aisstream.io";
const PORT = 443;
const PATH = "/v0/stream";
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const WATCHDOG_TIMEOUT_MS = 90_000;    // AISStream sendet in belebten Gebieten alle paar Sekunden etwas
const WATCHDOG_CHECK_MS = 15_000;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 5 * 60_000;
const STALE_SHIP_MS = 20 * 60_000;     // 20 Min. ohne Meldung → Schiff gilt als weg

/* ═══════════ Minimaler WebSocket-Client (RFC 6455) ═══════════ */

/** Baut einen maskierten Client-Frame (Text- oder Close-Opcode). */
function encodeFrame(opcode, payload) {
    const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
    const len = body.length;
    let header;

    if (len < 126) {
        header = Buffer.from([0x80 | opcode, 0x80 | len]);
    } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 126;
        header.writeUInt16BE(len, 2);
    } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode;
        header[1] = 0x80 | 127;
        header.writeBigUInt64BE(BigInt(len), 2);
    }

    const maskKey = crypto.randomBytes(4);
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = body[i] ^ maskKey[i % 4];

    return Buffer.concat([header, maskKey, masked]);
}

/**
 * Liest so viele vollständige Frames wie möglich aus `buf`.
 * @returns {{frames: Array, rest: Buffer}}
 */
function decodeFrames(buf) {
    const frames = [];
    let offset = 0;

    while (buf.length - offset >= 2) {
        const b0 = buf[offset], b1 = buf[offset + 1];
        const fin = (b0 & 0x80) !== 0;
        const opcode = b0 & 0x0f;
        const masked = (b1 & 0x80) !== 0;
        let len = b1 & 0x7f;
        let pos = offset + 2;

        if (len === 126) {
            if (buf.length - pos < 2) break;
            len = buf.readUInt16BE(pos); pos += 2;
        } else if (len === 127) {
            if (buf.length - pos < 8) break;
            len = Number(buf.readBigUInt64BE(pos)); pos += 8;
        }

        let maskKey = null;
        if (masked) {
            if (buf.length - pos < 4) break;
            maskKey = buf.subarray(pos, pos + 4);
            pos += 4;
        }

        if (buf.length - pos < len) break;   // Frame noch nicht vollständig da

        let payload = buf.subarray(pos, pos + len);
        if (masked) {
            const unmasked = Buffer.alloc(len);
            for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ maskKey[i % 4];
            payload = unmasked;
        }

        frames.push({ fin, opcode, payload: Buffer.from(payload) });
        offset = pos + len;
    }

    return { frames, rest: buf.subarray(offset) };
}

/**
 * Verbindet sich per TLS + HTTP-Upgrade und liefert ein schlankes
 * WebSocket-Handle zurück ({ send, close, on }).
 */
function openWebSocket({ onOpen, onMessage, onClose, onError }) {
    const key = crypto.randomBytes(16).toString("base64");
    let handshakeDone = false;
    let httpBuffer = Buffer.alloc(0);
    let frameBuffer = Buffer.alloc(0);
    let fragmentOpcode = null;
    let fragmentChunks = [];
    let closed = false;

    const socket = tls.connect({ host: HOST, port: PORT, servername: HOST }, () => {
        const req =
            `GET ${PATH} HTTP/1.1\r\n` +
            `Host: ${HOST}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\n` +
            `Sec-WebSocket-Version: 13\r\n` +
            `\r\n`;
        socket.write(req);
    });

    socket.setTimeout(30_000, () => {
        if (!handshakeDone) socket.destroy(new Error("Zeitüberschreitung beim Handshake"));
    });

    function handlePayload(opcode, payload) {
        if (opcode === 0x8) {           // Close
            close();
            onClose?.();
        } else if (opcode === 0x9) {    // Ping → Pong
            if (!closed) socket.write(encodeFrame(0xA, payload));
        } else if (opcode === 0x1) {    // Text
            onMessage?.(payload.toString("utf8"));
        }
        // Binär/Pong werden hier nicht gebraucht und ignoriert.
    }

    function processFrames() {
        const { frames, rest } = decodeFrames(frameBuffer);
        frameBuffer = Buffer.from(rest);

        for (const frame of frames) {
            if (frame.opcode === 0x0) {
                // Fortsetzung eines fragmentierten Frames
                fragmentChunks.push(frame.payload);
                if (frame.fin) {
                    handlePayload(fragmentOpcode, Buffer.concat(fragmentChunks));
                    fragmentOpcode = null;
                    fragmentChunks = [];
                }
            } else if (!frame.fin && (frame.opcode === 0x1 || frame.opcode === 0x2)) {
                fragmentOpcode = frame.opcode;
                fragmentChunks = [frame.payload];
            } else {
                handlePayload(frame.opcode, frame.payload);
            }
        }
    }

    socket.on("data", (chunk) => {
        if (!handshakeDone) {
            httpBuffer = Buffer.concat([httpBuffer, chunk]);
            const headerEnd = httpBuffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) return;

            const head = httpBuffer.subarray(0, headerEnd).toString("latin1");
            const statusLine = head.split("\r\n")[0];

            if (!/^HTTP\/1\.1 101\b/.test(statusLine)) {
                socket.destroy(new Error(`Unerwartete Antwort beim Handshake: ${statusLine}`));
                return;
            }

            const acceptMatch = head.match(/Sec-WebSocket-Accept:\s*(\S+)/i);
            const expected = crypto.createHash("sha1").update(key + WS_GUID).digest("base64");
            if (!acceptMatch || acceptMatch[1] !== expected) {
                socket.destroy(new Error("Sec-WebSocket-Accept stimmt nicht überein"));
                return;
            }

            handshakeDone = true;
            frameBuffer = httpBuffer.subarray(headerEnd + 4);
            onOpen?.();
            if (frameBuffer.length) processFrames();
            return;
        }

        frameBuffer = Buffer.concat([frameBuffer, chunk]);
        processFrames();
    });

    socket.on("error", (err) => { if (!closed) onError?.(err); });
    socket.on("close", () => { if (!closed) { closed = true; onClose?.(); } });

    function send(text) {
        if (!closed && handshakeDone) socket.write(encodeFrame(0x1, text));
    }

    function close() {
        if (closed) return;
        closed = true;
        try { socket.write(encodeFrame(0x8, Buffer.alloc(0))); } catch { /* egal, wird eh zerstört */ }
        socket.end();
        setTimeout(() => socket.destroy(), 1000);
    }

    return { send, close };
}

/* ═══════════ AIS-Nachrichten auswerten ═══════════ */

// Grobe Kategorien nach AIS-Schiffstyp-Code (erste Ziffer = Kategorie)
const SHIP_TYPE_NAMES = {
    "3": "Fischereifahrzeug",
    "4": "Hochgeschwindigkeitsfahrzeug",
    "5": "Lotsen-/Behördenfahrzeug",
    "6": "Passagierschiff",
    "7": "Frachtschiff",
    "8": "Tankschiff",
    "9": "Sonstiges Fahrzeug"
};

function shipTypeName(code) {
    const n = Number(code);
    if (!Number.isFinite(n) || n <= 0) return "";
    if (n === 30) return "Fischereifahrzeug";
    if (n === 36 || n === 37) return "Segel-/Freizeitboot";
    if (n === 50) return "Lotsenboot";
    if (n === 51) return "Such- und Rettungsboot";
    if (n === 52) return "Schlepper";
    if (n >= 60 && n < 70) return "Passagierschiff";
    if (n >= 70 && n < 80) return "Frachtschiff";
    if (n >= 80 && n < 90) return "Tankschiff";
    return SHIP_TYPE_NAMES[String(n)[0]] ?? "Schiff";
}

/**
 * Wandelt eine AISStream-Nachricht in ein flaches Schiffs-Objekt um
 * (gleiche Konvention wie makeAircraft() in flightProviders.mjs – das
 * eigentliche einheitliche {id, position{...}, ...}-Format baut der
 * Client aus diesen flachen Feldern via normalizeRecord(), siehe
 * dataManager.js). Gibt null zurück, wenn keine brauchbare Position da ist.
 */
function toShipRecord(msg, existing) {
    const meta = msg.MetaData ?? {};
    const mmsi = meta.MMSI ?? meta.MMSI_String;
    if (!mmsi) return null;

    const body = msg.Message?.[msg.MessageType] ?? {};
    const lat = Number(body.Latitude ?? meta.latitude);
    const lon = Number(body.Longitude ?? meta.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    // TrueHeading 511 = "nicht verfügbar" → dann auf Kurs über Grund (Cog) ausweichen
    const heading = Number.isFinite(body.TrueHeading) && body.TrueHeading !== 511
        ? body.TrueHeading
        : Number.isFinite(body.Cog) ? body.Cog : (existing?.heading ?? 0);

    const speed = Number.isFinite(body.Sog) ? body.Sog : (existing?.speed ?? 0);

    const name = (meta.ShipName || body.Name || existing?.name || String(mmsi)).trim();
    const shipType = msg.MessageType === "ShipStaticData"
        ? shipTypeName(body.Type)
        : (existing?.shipType || "");

    return {
        id: `ship-${mmsi}`,
        mmsi: String(mmsi),
        name,
        latitude: lat,
        longitude: lon,
        heading,
        speed,                       // Knoten (SOG) – wie im bisherigen Datenformat
        shipType,
        destination: msg.MessageType === "ShipStaticData"
            ? (body.Destination || "").trim()
            : existing?.destination || "",
        callSign: (body.CallSign || existing?.callSign || "").trim(),
        navigationalStatus: body.NavigationalStatus ?? existing?.navigationalStatus ?? null,
        timestamp: Date.parse(meta.time_utc?.replace(" ", "T") + "Z") || Date.now()
    };
}

/* ═══════════ Zustand & Verwaltung ═══════════ */

const ships = new Map();     // mmsi → Ship-Objekt im einheitlichen Format
let ws = null;
let watchdogTimer = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_BASE_MS;
let lastMessageAt = 0;
let connected = false;
let totalMessages = 0;
let lastError = "";
let apiKey = "";
let boundingBoxes = [[[-90, -180], [90, 180]]];
let started = false;

function pruneStaleShips() {
    const cutoff = Date.now() - STALE_SHIP_MS;
    for (const [mmsi, ship] of ships) {
        if (ship.timestamp < cutoff) ships.delete(mmsi);
    }
}

function scheduleReconnect() {
    if (!started || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

function teardown() {
    connected = false;
    if (ws) { ws.close(); ws = null; }
}

function connect() {
    if (!apiKey || !started) return;

    ws = openWebSocket({
        onOpen: () => {
            connected = true;
            lastMessageAt = Date.now();
            reconnectDelay = RECONNECT_BASE_MS;   // erfolgreiche Verbindung → Backoff zurücksetzen
            ws.send(JSON.stringify({
                APIKey: apiKey,
                BoundingBoxes: boundingBoxes
            }));
            console.log("[ais] Verbunden, Abo gesendet.");
        },
        onMessage: (text) => {
            lastMessageAt = Date.now();
            totalMessages++;
            let msg;
            try { msg = JSON.parse(text); } catch { return; }

            if (msg.error) {
                lastError = String(msg.error);
                console.warn("[ais]", lastError);
                return;
            }
            if (!msg.MessageType) return;

            const mmsi = String(msg.MetaData?.MMSI ?? "");
            if (!mmsi) return;

            const record = toShipRecord(msg, ships.get(mmsi));
            if (record) ships.set(mmsi, record);
        },
        onError: (err) => {
            lastError = err.message;
            console.warn("[ais] Verbindungsfehler:", err.message);
            teardown();
            scheduleReconnect();
        },
        onClose: () => {
            if (connected) console.warn("[ais] Verbindung geschlossen, versuche erneut zu verbinden.");
            connected = false;
            ws = null;
            scheduleReconnect();
        }
    });
}

/** Wachhund: Neuverbindung erzwingen, wenn lange nichts mehr ankam. */
function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
        pruneStaleShips();
        if (!connected) return;
        if (Date.now() - lastMessageAt > WATCHDOG_TIMEOUT_MS) {
            console.warn("[ais] Wachhund: keine Daten mehr erhalten, verbinde neu.");
            teardown();
            connect();
        }
    }, WATCHDOG_CHECK_MS);
}

/**
 * Startet den AIS-Feed. Ohne Key bleibt der Layer einfach leer –
 * das meldet handleShips()/handleShipsStatus() dem Client.
 *
 * @param {object} opts { apiKey, bbox: {north,south,west,east} }
 */
export function startAisStream(opts = {}) {
    if (started) return;
    started = true;
    apiKey = opts.apiKey ?? "";
    if (opts.bbox) {
        const { north, south, west, east } = opts.bbox;
        boundingBoxes = [[[south, west], [north, east]]];
    }
    if (!apiKey) {
        console.log("[ais] Kein AISSTREAM_API_KEY gesetzt – Schiffs-Layer bleibt bei Demo-Daten.");
        return;
    }
    startWatchdog();
    connect();
}

export function stopAisStream() {
    started = false;
    if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    teardown();
}

/** Aktuelle Schiffe, optional auf eine Bounding-Box begrenzt. */
export function getShips(bounds, limit) {
    let list = [...ships.values()];

    if (bounds) {
        list = list.filter(s =>
            s.latitude <= bounds.north && s.latitude >= bounds.south &&
            (bounds.west <= bounds.east
                ? (s.longitude >= bounds.west && s.longitude <= bounds.east)
                : (s.longitude >= bounds.west || s.longitude <= bounds.east)));
    }

    list.sort((a, b) => b.timestamp - a.timestamp);
    return limit ? list.slice(0, limit) : list;
}

export function getAisStatus() {
    return {
        configured: !!apiKey,
        connected,
        count: ships.size,
        totalMessages,
        lastMessageAt,
        lastError
    };
}
