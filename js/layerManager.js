/**
 * layerManager.js – Verwaltung aller Daten-Layer.
 *
 * Der LayerManager:
 *  - registriert Layer
 *  - lädt alle Layer parallel
 *  - reicht Simulations-Updates an alle Layer weiter
 *  - findet Entities/Objekte über alle Layer hinweg (für Suche & Auswahl)
 */

export class LayerManager {

    constructor() {
        this.layers = new Map();   // id → Layer
    }

    /** Layer registrieren (Reihenfolge = Reihenfolge in der Sidebar). */
    register(layer) {
        this.layers.set(layer.id, layer);
        return layer;
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
                console.error(`Layer '${this.getAll()[i].id}' konnte nicht geladen werden:`, res.reason);
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
