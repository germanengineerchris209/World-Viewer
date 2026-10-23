/**
 * layerManager.js – Verwaltung aller Daten-Layer.
 *
 * Der LayerManager:
 *  - registriert Layer
 *  - lädt alle Layer parallel
 *  - reicht Simulations-Updates an alle Layer weiter
 *  - findet Entities/Objekte über alle Layer hinweg (für Suche & Auswahl)
 *  - taktet alle Layer-Refresh-Timer zentral (WEB-160) und pausiert sie im
 *    Hintergrund-Tab bzw. solange ein Layer ausgeblendet ist
 */

export class LayerManager {

    constructor() {
        this.layers = new Map();   // id → Layer
        this._timers = new Map();  // layerId → Map(name → { intervalMs, callback, handle })

        // WEB-160: zentrale Drosselung – sobald der Tab in den Hintergrund
        // wechselt, pausieren alle registrierten Layer-Timer; bei Rückkehr
        // sofortiger Nachlade-Tick statt auf das nächste Intervall zu warten.
        document.addEventListener("visibilitychange", () => this._onVisibilityChange());
    }

    /** Layer registrieren (Reihenfolge = Reihenfolge in der Sidebar). */
    register(layer) {
        this.layers.set(layer.id, layer);
        layer.layerManager = this;
        return layer;
    }

    /**
     * Zentrale Timer-Registrierung (WEB-160) – ersetzt eigenes setInterval
     * je Layer. `name` unterscheidet mehrere Timer desselben Layers (z.B.
     * Datenabruf vs. Abspiel-Takt). Läuft nicht an, solange der Tab im
     * Hintergrund liegt oder der Layer ausgeblendet ist (siehe BaseLayer).
     */
    registerTimer(layerId, name, intervalMs, callback) {
        this.unregisterTimer(layerId, name);
        let byLayer = this._timers.get(layerId);
        if (!byLayer) { byLayer = new Map(); this._timers.set(layerId, byLayer); }
        const entry = { intervalMs, callback, handle: null };
        byLayer.set(name, entry);
        this._arm(layerId, entry);
    }

    /** Timer wieder abmelden (z.B. beim Entfernen/Zurücksetzen eines Layers). */
    unregisterTimer(layerId, name) {
        const entry = this._timers.get(layerId)?.get(name);
        if (!entry) return;
        if (entry.handle) clearInterval(entry.handle);
        this._timers.get(layerId).delete(name);
    }

    /** Startet den nativen setInterval, wenn Tab sichtbar + Layer eingeblendet. */
    _arm(layerId, entry) {
        if (entry.handle) { clearInterval(entry.handle); entry.handle = null; }
        if (document.hidden) return;
        const layer = this.layers.get(layerId);
        if (layer && !layer.enabled) return;
        entry.handle = setInterval(entry.callback, entry.intervalMs);
    }

    _onVisibilityChange() {
        if (document.hidden) {
            for (const byLayer of this._timers.values()) {
                for (const entry of byLayer.values()) {
                    if (entry.handle) { clearInterval(entry.handle); entry.handle = null; }
                }
            }
            return;
        }
        // Tab wieder sichtbar: alle Timer eingeblendeter Layer sofort einmal
        // auslösen (aktuelle Daten statt Warten auf das nächste Intervall)
        // und danach normal weitertakten.
        for (const [layerId, byLayer] of this._timers.entries()) {
            const layer = this.layers.get(layerId);
            if (layer && !layer.enabled) continue;
            for (const entry of byLayer.values()) {
                entry.callback();
                this._arm(layerId, entry);
            }
        }
    }

    /** Von BaseLayer.show()/hide() aufgerufen (WEB-160). */
    _setLayerTimersActive(layerId, active) {
        const byLayer = this._timers.get(layerId);
        if (!byLayer) return;
        if (active) {
            if (document.hidden) return; // Hintergrund-Tab hat Vorrang
            for (const entry of byLayer.values()) {
                entry.callback();
                this._arm(layerId, entry);
            }
        } else {
            for (const entry of byLayer.values()) {
                if (entry.handle) { clearInterval(entry.handle); entry.handle = null; }
            }
        }
    }

    get(id) { return this.layers.get(id); }

    getAll() { return [...this.layers.values()]; }

    /** Alle Layer parallel laden – ein fehlerhafter Layer stoppt nicht die anderen. */
    async loadAll() {
        const results = await Promise.allSettled(
            this.getAll().map(layer => layer.load())
        );
        results.forEach((res, i) => {
            if (res.status === "rejected") {
                const layer = this.getAll()[i];
                console.error(`Layer '${layer.id}' konnte nicht geladen werden:`, res.reason);
                layer.status = "fehler";
            }
        });
    }

    /**
     * Tick an alle Layer weiterreichen.
     * @param {number} simDeltaSeconds   mit Zeitraffer (Demo/Simulation)
     * @param {number} realDeltaSeconds  echte Zeit (Live-Daten)
     */
    update(simDeltaSeconds, realDeltaSeconds = simDeltaSeconds) {
        for (const layer of this.layers.values()) {
            layer.update(simDeltaSeconds, realDeltaSeconds);
        }
    }

    /** Layer ein-/ausblenden. */
    toggle(id) {
        const layer = this.layers.get(id);
        return layer ? layer.toggle() : false;
    }

    /** Beschriftungen global ein-/ausblenden. */
    setLabelsVisible(visible) {
        for (const layer of this.layers.values()) {
            layer.setLabelsVisible(visible);
        }
    }

    /** Bewegungsspuren global ein-/ausblenden (nur Layer mit enableTrails()). */
    setTrailsVisible(visible) {
        for (const layer of this.layers.values()) {
            if (layer.supportsTrails) layer.setTrailsVisible(visible);
        }
    }

    /** Entity über alle Layer hinweg per Objekt-ID finden. */
    findEntityById(objectId) {
        for (const layer of this.layers.values()) {
            const entity = layer.entityById.get(objectId);
            if (entity) return entity;
        }
        return null;
    }

    /** Alle normalisierten Objekte aller Layer (für die Suche). */
    getAllObjects() {
        const all = [];
        for (const layer of this.layers.values()) {
            all.push(...layer.objects);
        }
        return all;
    }

    /** Statistik für die Sidebar. */
    getStats() {
        let total = 0, visible = 0;
        for (const layer of this.layers.values()) {
            total += layer.count;
            if (layer.enabled) visible += layer.count;
        }
        return { total, visible };
    }
}
