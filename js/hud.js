/**
 * hud.js – "Tactical HUD": Canvas-Overlay mit Ziel-Boxen und
 * Telemetrie-Text (Geschwindigkeit/Kurs/Höhe/Name) über sichtbaren
 * Objekten, im Stil von "God's Eye View" / Palantir Gotham.
 *
 * Rein dekorativ: es werden nur bereits geladene Objektdaten aller
 * Layer verwendet (Position, Geschwindigkeit, Kurs) – keine eigene
 * Objekterkennung. Wie NVG/FLIR/CRT/Noir/Schnee über sensorStyles.js
 * umschaltbar (siehe app.js), zeichnet aber zusätzlich auf einem
 * eigenen Canvas über dem Cesium-Viewport statt nur einen CSS-Filter
 * zu setzen.
 */

const MAX_TRACKS = 80;             // Deckelung gegen Overdraw bei vielen Objekten
const BOX_SIZE = 46;               // px, Basiskantenlänge der Ziel-Box
const CORNER_LEN = 10;             // px, Länge der Eckklammern
const COLOR = "#34d399";           // Tactical-Grün, passend zu --green im Theme
const COLOR_SELECTED = "#38bdf8";  // Cyan, wie die bestehende Auswahl-Hervorhebung

export class TacticalHUD {

    /**
     * @param {import("./viewer.js").WorldViewer} worldViewer
     * @param {import("./layerManager.js").LayerManager} layerManager
     */
    constructor(worldViewer, layerManager) {
        this.worldViewer = worldViewer;
        this.layerManager = layerManager;
        this.active = false;

        this._canvas = document.createElement("canvas");
        this._canvas.id = "hud-overlay-canvas";
        document.getElementById("main").appendChild(this._canvas);
        this._ctx = this._canvas.getContext("2d");
        this._scratch = new Cesium.Cartesian2();

        window.addEventListener("resize", () => this._resize());
        this._resize();
    }

    _resize() {
        const canvas = this._canvas;
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        this._width = rect.width;
        this._height = rect.height;
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
        this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /** Wird von sensorStyles.js beim Wechsel des Sensor-Stils gerufen. */
    setActive(active) {
        this.active = active;
        this._canvas.classList.toggle("visible", active);
        if (!active) this._ctx.clearRect(0, 0, this._width, this._height);
    }

    /** Pro Frame aus der zentralen Update-Schleife (app.js). Kein Aufwand, wenn inaktiv. */
    update(selectedObjectId) {
        if (!this.active) return;
        if (this._width !== this._canvas.parentElement.clientWidth ||
            this._height !== this._canvas.parentElement.clientHeight) {
            this._resize();
        }

        const ctx = this._ctx;
        ctx.clearRect(0, 0, this._width, this._height);
        ctx.textBaseline = "top";

        const tracks = this._collectTracks(selectedObjectId);
        // Bei vielen Zielen auf dem Bildschirm (z.B. Weltansicht) nur die
        // ausgewählte/nächste Handvoll mit voller Telemetrie beschriften –
        // sonst wird die Anzeige unlesbar.
        const fullDetail = tracks.length <= 20;
        for (const track of tracks) {
            const selected = track.obj.id === selectedObjectId;
            this._drawTrack(track, selected, fullDetail || selected);
        }

        this._drawFrameCorners();
        this._drawStatusLine(tracks.length);
    }

    /**
     * Bildschirmkoordinaten aller sichtbaren, eingeblendeten Objekte ermitteln.
     * Sammelt zunächst layerübergreifend ALLE Treffer (damit z.B. der
     * Aircraft-Layer mit hunderten Objekten nicht allein das Kontingent
     * verbraucht) und dünnt danach gleichmäßig auf MAX_TRACKS aus – das
     * ausgewählte Objekt bleibt dabei immer erhalten.
     */
    _collectTracks(selectedObjectId) {
        const scene = this.worldViewer.scene;
        const time = this.worldViewer.viewer.clock.currentTime;
        const transformToWindow = Cesium.SceneTransforms.wgs84ToWindowCoordinates
            ?? Cesium.SceneTransforms.worldToWindowCoordinates;

        // Objekte auf der erdabgewandten Seite ausblenden (nur im 3D-Modus relevant)
        const occluder = scene.mode === Cesium.SceneMode.SCENE3D
            ? new Cesium.EllipsoidalOccluder(Cesium.Ellipsoid.WGS84, scene.camera.positionWC)
            : null;

        const tracks = [];
        let selectedTrack = null;
        for (const layer of this.layerManager.getAll()) {
            if (!layer.enabled) continue;
            for (const obj of layer.objects) {
                const entity = layer.entityById.get(obj.id);
                if (!entity || entity.show === false) continue;

                const position = entity.position?.getValue(time);
                if (!position) continue;
                if (occluder && !occluder.isPointVisible(position)) continue;

                const win = transformToWindow(scene, position, this._scratch);
                if (!win) continue;
                if (win.x < -BOX_SIZE || win.x > this._width + BOX_SIZE ||
                    win.y < -BOX_SIZE || win.y > this._height + BOX_SIZE) continue;

                const track = { obj, x: win.x, y: win.y, icon: layer.icon };
                if (obj.id === selectedObjectId) selectedTrack = track;
                tracks.push(track);
            }
        }

        if (tracks.length <= MAX_TRACKS) return tracks;

        const step = tracks.length / MAX_TRACKS;
        const sampled = [];
        for (let i = 0; i < MAX_TRACKS; i++) sampled.push(tracks[Math.floor(i * step)]);
        if (selectedTrack && !sampled.includes(selectedTrack)) sampled[0] = selectedTrack;
        return sampled;
    }

    _drawTrack({ obj, x, y, icon }, selected, fullDetail) {
        const ctx = this._ctx;
        const color = selected ? COLOR_SELECTED : COLOR;
        const half = selected ? BOX_SIZE * 0.6 : BOX_SIZE * 0.5;

        ctx.strokeStyle = color;
        ctx.lineWidth = selected ? 2 : 1.25;
        ctx.globalAlpha = selected ? 1 : 0.85;

        // Eckklammern statt vollem Rahmen – klassische Ziel-Box-Optik
        this._corner(x - half, y - half, 1, 1);
        this._corner(x + half, y - half, -1, 1);
        this._corner(x - half, y + half, 1, -1);
        this._corner(x + half, y + half, -1, -1);

        // Telemetrie rechts neben der Box: Name, Geschwindigkeit/Kurs, Höhe
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.font = selected ? "bold 10px 'SF Mono', Consolas, monospace"
                             : "10px 'SF Mono', Consolas, monospace";

        const speedHeading = [
            obj.speed ? `${Math.round(obj.speed)} km/h` : null,
            obj.heading ? `${Math.round(obj.heading)}°` : null
        ].filter(Boolean).join("  ");

        const lines = fullDetail
            ? [
                `${icon ?? ""} ${obj.name}`.trim(),
                speedHeading || null,
                obj.position.altitude ? `${Math.round(obj.position.altitude)} m` : null
              ].filter(Boolean)
            : [`${icon ?? ""} ${obj.name}`.trim()];

        lines.forEach((line, i) => ctx.fillText(line, x + half + 6, y - half + i * 12));
        ctx.globalAlpha = 1;
    }

    _corner(x, y, dx, dy) {
        const ctx = this._ctx;
        ctx.beginPath();
        ctx.moveTo(x, y + dy * CORNER_LEN);
        ctx.lineTo(x, y);
        ctx.lineTo(x + dx * CORNER_LEN, y);
        ctx.stroke();
    }

    /** Dezente Rahmenecken am Bildschirmrand für den "Sensor"-Look. */
    _drawFrameCorners() {
        const ctx = this._ctx;
        const margin = 18, len = 26;
        ctx.strokeStyle = COLOR;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.5;

        const corners = [
            [margin, margin, 1, 1],
            [this._width - margin, margin, -1, 1],
            [margin, this._height - margin, 1, -1],
            [this._width - margin, this._height - margin, -1, -1]
        ];
        for (const [x, y, dx, dy] of corners) {
            ctx.beginPath();
            ctx.moveTo(x, y + dy * len);
            ctx.lineTo(x, y);
            ctx.lineTo(x + dx * len, y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }

    _drawStatusLine(count) {
        const ctx = this._ctx;
        ctx.fillStyle = COLOR;
        ctx.globalAlpha = 0.85;
        ctx.font = "11px 'SF Mono', Consolas, monospace";
        ctx.fillText(`TGT TRACK · ${count}`, 34, 12);
        ctx.globalAlpha = 1;
    }
}
