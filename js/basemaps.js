/**
 * basemaps.js – Kartenhintergründe ("Basemaps") des Globus.
 *
 * WICHTIG: Die Satellitenansicht funktioniert OHNE jeden API-Key.
 * Sie nutzt den frei zugänglichen Kachel-Dienst "World Imagery" von
 * Esri/ArcGIS – dieselbe Art hochaufgelöster Luft- und Satellitenbilder,
 * die man von Google Maps kennt (bis auf Straßen-/Hausebene).
 *
 * Mit optionalen Keys wird es noch besser:
 *   • Cesium-Ion-Token  → echtes 3D-Gelände + OSM-3D-Gebäude weltweit
 *   • Google-Maps-Key   → fotorealistische 3D-Tiles (Google-Earth-Optik)
 */

const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services";

/**
 * Alle verfügbaren Basemaps.
 * `requires` steuert, ob der Eintrag ohne Key angeboten wird.
 */
export const BASEMAPS = [
    {
        id: "satellite",
        name: "Satellit",
        icon: "🛰️",
        requires: null,
        description: "Hochauflösende Satelliten- und Luftbilder (Esri World Imagery)",
        create: async () => {
            const provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
                `${ESRI}/World_Imagery/MapServer`,
                { enablePickFeatures: false }
            );
            return [new Cesium.ImageryLayer(provider)];
        }
    },
    {
        id: "hybrid",
        name: "Hybrid",
        icon: "🗺️",
        requires: null,
        description: "Satellitenbilder mit Orts- und Straßennamen",
        create: async () => {
            const imagery = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
                `${ESRI}/World_Imagery/MapServer`, { enablePickFeatures: false }
            );
            const labels = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
                `${ESRI}/Reference/World_Boundaries_and_Places/MapServer`,
                { enablePickFeatures: false }
            );
            return [new Cesium.ImageryLayer(imagery), new Cesium.ImageryLayer(labels)];
        }
    },
    {
        id: "streets",
        name: "Karte",
        icon: "🛣️",
        requires: null,
        description: "Klassische Straßenkarte (OpenStreetMap)",
        create: async () => {
            const provider = new Cesium.OpenStreetMapImageryProvider({
                url: "https://tile.openstreetmap.org/"
            });
            return [new Cesium.ImageryLayer(provider)];
        }
    },
    {
        id: "terrain",
        name: "Relief",
        icon: "⛰️",
        requires: null,
        description: "Topografische Karte mit Geländeschummerung (Esri)",
        create: async () => {
            const provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(
                `${ESRI}/World_Topo_Map/MapServer`, { enablePickFeatures: false }
            );
            return [new Cesium.ImageryLayer(provider)];
        }
    },
    {
        id: "ion",
        name: "Bing (Ion)",
        icon: "✨",
        requires: "cesiumIonToken",
        description: "Cesium-Ion-Weltbilder (benötigt Ion-Token)",
        create: async () => {
            const provider = await Cesium.IonImageryProvider.fromAssetId(2);
            return [new Cesium.ImageryLayer(provider)];
        }
    }
];

/**
 * Verwaltet Basemap-, Gelände- und 3D-Gebäude-Umschaltung.
 */
export class BasemapManager {

    constructor(viewer) {
        this.viewer = viewer;
        this.scene = viewer.scene;
        this.currentId = null;
        this._layers = [];

        this._googleTileset = null;
        this._osmBuildings = null;

        const cfg = window.WORLD_VIEWER_CONFIG ?? {};
        this.hasIon = !!cfg.cesiumIonToken;
        this.hasGoogle = !!cfg.googleMapsApiKey;
    }

    /** Basemaps, die mit der aktuellen Konfiguration nutzbar sind. */
    availableBasemaps() {
        const cfg = window.WORLD_VIEWER_CONFIG ?? {};
        return BASEMAPS.filter(b => !b.requires || !!cfg[b.requires]);
    }

    /**
     * Basemap aktivieren.
     * @param {string} id  z.B. "satellite"
     */
    async setBasemap(id) {
        const basemap = BASEMAPS.find(b => b.id === id);
        if (!basemap) {
            console.warn(`[basemaps] Unbekannte Basemap: ${id}`);
            return false;
        }

        try {
            const layers = await basemap.create();

            // Alte Layer erst entfernen, wenn die neuen erfolgreich erstellt wurden
            // (so bleibt bei einem Fehler die alte Karte sichtbar)
            for (const old of this._layers) {
                this.viewer.imageryLayers.remove(old, true);
            }
            this._layers = [];

            for (const layer of layers) {
                this.viewer.imageryLayers.add(layer);
                this._layers.push(layer);
            }
            // Basemap muss unter allen anderen Layern liegen
            for (const layer of this._layers) {
                this.viewer.imageryLayers.lowerToBottom(layer);
            }
            // Reihenfolge innerhalb der Basemap wiederherstellen (Labels oben)
            for (let i = this._layers.length - 1; i >= 0; i--) {
                this.viewer.imageryLayers.lowerToBottom(this._layers[i]);
            }

            this.currentId = id;
            return true;
        } catch (err) {
            console.error(`[basemaps] Basemap '${id}' konnte nicht geladen werden:`, err);
            return false;
        }
    }

    /**
     * 3D-Gelände aktivieren (echte Berge statt flacher Kugel).
     * Ohne Ion-Token bleibt die Erde eine glatte Ellipsoid-Oberfläche.
     */
    async enableTerrain() {
        if (!this.hasIon) return false;
        try {
            const terrain = await Cesium.CesiumTerrainProvider.fromIonAssetId(1, {
                requestVertexNormals: true,
                requestWaterMask: true
            });
            this.viewer.terrainProvider = terrain;
            return true;
        } catch (err) {
            console.warn("[basemaps] World Terrain nicht verfügbar:", err);
            return false;
        }
    }

    /**
     * Fotorealistische 3D-Tiles von Google (Gebäude wie in Google Earth).
     * Benötigt einen Google-Maps-Key mit aktivierter "Map Tiles API".
     */
    async enableGooglePhotorealistic() {
        const key = window.WORLD_VIEWER_CONFIG?.googleMapsApiKey;
        if (!key) return false;
        if (this._googleTileset) { this._googleTileset.show = true; return true; }

        try {
            const tileset = await Cesium.Cesium3DTileset.fromUrl(
                `https://tile.googleapis.com/v1/3dtiles/root.json?key=${key}`,
                { showCreditsOnScreen: true }
            );
            this.scene.primitives.add(tileset);
            this._googleTileset = tileset;
            // Der Globus würde sonst durch die 3D-Tiles durchscheinen
            this.scene.globe.show = false;
            return true;
        } catch (err) {
            console.warn("[basemaps] Google 3D Tiles nicht verfügbar " +
                "(Key gültig? 'Map Tiles API' aktiviert?):", err);
            return false;
        }
    }

    /** OSM-3D-Gebäude (grau, weltweit) – Alternative ohne Google-Key, braucht Ion. */
    async enableOsmBuildings() {
        if (!this.hasIon) return false;
        if (this._osmBuildings) { this._osmBuildings.show = true; return true; }
        try {
            this._osmBuildings = await Cesium.createOsmBuildingsAsync();
            this.scene.primitives.add(this._osmBuildings);
            return true;
        } catch (err) {
            console.warn("[basemaps] OSM Buildings nicht verfügbar:", err);
            return false;
        }
    }

    /** 3D-Gebäude ein-/ausblenden (Google-Tiles bevorzugt, sonst OSM). */
    async toggleBuildings() {
        const target = this._googleTileset ?? this._osmBuildings;
        if (target) {
            target.show = !target.show;
            if (this._googleTileset) this.scene.globe.show = !this._googleTileset.show;
            return target.show;
        }
        // Noch nicht geladen → jetzt laden
        if (await this.enableGooglePhotorealistic()) return true;
        if (await this.enableOsmBuildings()) return true;
        return false;
    }

    get hasBuildings() {
        return !!(this._googleTileset || this._osmBuildings) || this.hasGoogle || this.hasIon;
    }
}
