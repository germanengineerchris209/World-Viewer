/**
 * graphView.js – Netzwerk-Graph-Ansicht für die Link-Analyse.
 *
 * Öffentliches Gotham-Feature nachgebaut ("Graph"-App): statt der reinen
 * Liste aus linkAnalysis.js zeigt dieses Panel das ausgewählte Objekt und
 * seine Verknüpfungen als interaktiven Node-Graph. Nutzt vis-network
 * (CDN, Apache-2.0) rein clientseitig – keine neue Datenquelle, keine
 * Server-Änderung.
 */

import { findLinkedObjects } from "./linkAnalysis.js";

const TYPE_COLORS = {
    aircraft: "#38bdf8", ship: "#22d3ee", satellite: "#a78bfa",
    infrastructure: "#f59e0b", launch: "#f97316", cable: "#34d399",
    camera: "#f472b6", radio: "#fb7185", earthquake: "#ef4444",
    fire: "#fb923c", aqi: "#84cc16", volcano: "#dc2626"
};
const DEFAULT_COLOR = "#94a3b8";

function nodeColor(type) {
    const c = TYPE_COLORS[type] ?? DEFAULT_COLOR;
    return { background: c, border: "#0f172a", highlight: { background: c, border: "#ffffff" } };
}

function nodeLabel(object) {
    return object.metadata?.callsign ?? object.name ?? "?";
}

const GRAPH_OPTIONS = {
    autoResize: true,
    nodes: { shape: "dot", borderWidth: 2, font: { color: "#e2e8f0", size: 13 } },
    edges: {
        smooth: { type: "continuous" },
        color: { color: "rgba(148,163,184,0.5)", highlight: "#38bdf8" },
        font: { color: "#94a3b8", size: 10, strokeWidth: 0, background: "rgba(15,23,42,0.75)" }
    },
    physics: { solver: "forceAtlas2Based", stabilization: { iterations: 120 } },
    interaction: { hover: true, tooltipDelay: 150 }
};

/** Baut einen Netzwerk-Graph aus dem gewählten Objekt + seinen Verknüpfungen. */
export class GraphView {
    /**
     * @param {object} params
     * @param {HTMLElement} params.container   Zeichenfläche für vis-network
     * @param {HTMLElement} [params.subtitleEl] zeigt Objektname + Anzahl Links
     * @param {LayerManager} params.layerManager
     * @param {(object) => void} params.onSelect  Callback bei Knotenklick (neues Zentrum)
     */
    constructor({ container, subtitleEl, layerManager, onSelect }) {
        this.container = container;
        this.subtitleEl = subtitleEl;
        this.layerManager = layerManager;
        this.onSelect = onSelect;
        this.network = null;
    }

    /** Zentriert den Graphen auf `object` und zeigt dessen Verknüpfungen. */
    show(object) {
        this.centerId = object.id;
        const links = findLinkedObjects(object, this.layerManager);

        const nodes = [{ id: object.id, label: nodeLabel(object), color: nodeColor(object.type), size: 24 }];
        const edges = [];
        for (const { object: linked, reason } of links) {
            nodes.push({ id: linked.id, label: nodeLabel(linked), color: nodeColor(linked.type), size: 15 });
            edges.push({ from: object.id, to: linked.id, label: reason });
        }

        if (this.subtitleEl) {
            this.subtitleEl.textContent =
                `${nodeLabel(object)} · ${links.length} Verknüpfung${links.length === 1 ? "" : "en"}`;
        }

        const data = { nodes: new vis.DataSet(nodes), edges: new vis.DataSet(edges) };

        if (!this.network) {
            this.network = new vis.Network(this.container, data, GRAPH_OPTIONS);
            this.network.on("click", (params) => this._handleClick(params));
        } else {
            this.network.setData(data);
            this.network.setOptions({ physics: GRAPH_OPTIONS.physics });
        }
        // Physik nur für den initialen Aufbau nutzen, danach einfrieren – sonst
        // driften die Knoten dauerhaft weiter und der Graph wird unruhig.
        this.network.once("stabilizationIterationsDone", () => {
            this.network?.setOptions({ physics: false });
            this.network?.fit();
        });
    }

    _handleClick({ nodes }) {
        if (!nodes.length) return;
        const id = nodes[0];
        if (id === this.centerId) return;

        const entity = this.layerManager.findEntityById(id);
        const nextObject = entity?.worldViewerObject;
        if (!nextObject) return;

        this.onSelect?.(nextObject);
        this.show(nextObject);
    }

    destroy() {
        this.network?.destroy();
        this.network = null;
    }
}
