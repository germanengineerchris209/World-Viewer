/**
 * anomalyAlerts.js – Notfall-Squawk- und AIS-Auffälligkeits-Alarme.
 *
 * Zweite Alarmkategorie neben den Geofence-Alarmen aus watchlist.js
 * (WEB-20), ohne neue Datenquelle: OpenSky-State-Vectors liefern bereits
 * das Feld "squawk" pro Flugzeug, AIS-Meldungen (AISStream) liefern
 * bereits Geschwindigkeit/Kurs pro Schiff. Beides wird bei jeder Prüfung
 * gegen einfache Schwellenwerte gehalten – analog zur Ein-/Austritts-
 * Erkennung der Watchlist.
 */

import { haversineKm } from "./dataManager.js";

const EMERGENCY_SQUAWKS = {
    "7500": "Entführung (Hijack)",
    "7600": "Funkausfall",
    "7700": "Allgemeiner Notfall"
};

const MAX_ALERTS = 200;

// Ab dieser Geschwindigkeit (Knoten) gilt ein Schiff als "in Fahrt".
const WAS_MOVING_KNOTS = 5;
// Darunter gilt es nach vorheriger Fahrt als "gestoppt".
const STOP_THRESHOLD_KNOTS = 1;
// Positionssprung: die aus der Distanz berechnete Geschwindigkeit darf die
// gemeldete AIS-Geschwindigkeit nur um das X-fache zzgl. Mindestabstand
// (Rundungsrauschen) übersteigen, sonst gilt der Sprung als unplausibel.
const JUMP_FACTOR = 3;
const JUMP_MIN_EXCESS_KNOTS = 20;

let alertCounter = 0;

export class AnomalyAlerts {

    /**
     * @param {LayerManager} layerManager
     */
    constructor(layerManager) {
        this.layerManager = layerManager;

        this.alerts = [];              // { id, timestamp, category, event, severity, objectId, objectName, objectType, detail }
        this._squawkState = new Map(); // objectId → zuletzt gemeldeter Notfall-Code
        this._shipTrack = new Map();   // objectId → { lat, lon, speed, timestamp }

        this.onAlert = null;           // (alert) => void, von der UI gesetzt
    }

    /** Gegen die aktuellen Flugzeug-/Schiffspositionen prüfen. */
    check() {
        const aircraftLayer = this.layerManager.get("aircraft");
        if (aircraftLayer?.enabled) this._checkSquawks(aircraftLayer.objects);

        // Positions-/Geschwindigkeitsvergleich basiert auf Wanduhrzeit
        // zwischen zwei Prüfungen. Im Demo-Modus bewegen sich Schiffe per
        // Koppelnavigation in SIMULATIONSZEIT (Zeitraffer, siehe
        // ShipLayer.update()) – das würde bei laufendem Zeitraffer ständig
        // falsche "Positionssprung"-Alarme auslösen. Daher nur bei echten
        // AIS-Meldungen prüfen, deren Zeitstempel der Wanduhrzeit entsprechen.
        const shipLayer = this.layerManager.get("ships");
        if (shipLayer?.enabled && shipLayer.mode === "live") this._checkAis(shipLayer.objects);
    }

    /* ─────────── Notfall-Squawk (7500 / 7600 / 7700) ─────────── */

    _checkSquawks(objects) {
        const seen = new Set();

        for (const obj of objects) {
            seen.add(obj.id);
            const squawk = obj.metadata?.squawk ?? "";
            const label = EMERGENCY_SQUAWKS[squawk];
            const previous = this._squawkState.get(obj.id);

            if (label) {
                if (previous !== squawk) {
                    this._squawkState.set(obj.id, squawk);
                    this._raise({
                        category: "squawk",
                        event: `squawk_${squawk}`,
                        severity: "critical",
                        obj,
                        detail: `Squawk ${squawk} – ${label}`
                    });
                }
            } else if (previous) {
                this._squawkState.delete(obj.id);
            }
        }

        for (const id of this._squawkState.keys()) {
            if (!seen.has(id)) this._squawkState.delete(id);
        }
    }

    /* ─────────── AIS-Auffälligkeiten (Stopp / Positionssprung) ─────────── */

    _checkAis(objects) {
        const seen = new Set();

        for (const obj of objects) {
            seen.add(obj.id);
            const previous = this._shipTrack.get(obj.id);
            const current = {
                lat: obj.position.latitude,
                lon: obj.position.longitude,
                speed: obj.speed ?? 0,
                timestamp: Date.now()
            };

            if (previous) {
                if (previous.speed >= WAS_MOVING_KNOTS && current.speed <= STOP_THRESHOLD_KNOTS) {
                    this._raise({
                        category: "ais",
                        event: "ais_stop",
                        severity: "warning",
                        obj,
                        detail: `Plötzlicher Stopp (vorher ${Math.round(previous.speed)} kn)`
                    });
                }

                const elapsedHours = (current.timestamp - previous.timestamp) / 3_600_000;
                if (elapsedHours > 0) {
                    const distanceKm = haversineKm(previous.lat, previous.lon, current.lat, current.lon);
                    const impliedKnots = (distanceKm / 1.852) / elapsedHours;
                    const reference = Math.max(previous.speed, current.speed);

                    if (impliedKnots > reference * JUMP_FACTOR + JUMP_MIN_EXCESS_KNOTS) {
                        this._raise({
                            category: "ais",
                            event: "ais_jump",
                            severity: "warning",
                            obj,
                            detail: `Unplausibler Positionssprung: ${Math.round(distanceKm)} km `
                                + `in ${Math.max(1, Math.round(elapsedHours * 60))} min (~${Math.round(impliedKnots)} kn)`
                        });
                    }
                }
            }

            this._shipTrack.set(obj.id, current);
        }

        for (const id of this._shipTrack.keys()) {
            if (!seen.has(id)) this._shipTrack.delete(id);
        }
    }

    /* ─────────── Alarm erzeugen ─────────── */

    _raise({ category, event, severity, obj, detail }) {
        const alert = {
            id: `anomaly-${Date.now()}-${alertCounter++}`,
            timestamp: Date.now(),
            category,
            event,
            severity,
            objectId: obj.id,
            objectName: obj.metadata?.callsign || obj.name,
            objectType: obj.type,
            detail
        };
        this.alerts.unshift(alert);
        this.alerts.length = Math.min(this.alerts.length, MAX_ALERTS);
        this.onAlert?.(alert);
    }

    clearAlerts() {
        this.alerts = [];
    }
}
