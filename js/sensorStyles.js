/**
 * sensorStyles.js – "Sensor-Optik" über CSS-Filter auf dem Cesium-Canvas.
 *
 * Idee aus "God's Eye View" (Bilawal Sidhu, MIT-Lizenz): die Weltansicht
 * wirkt, als würde man durch ein anderes Sensorsystem schauen. Statt
 * echter GLSL-Post-Effekte reichen CSS-`filter`-Ketten auf dem Canvas –
 * kein Eingriff in Cesiums Rendering nötig, funktioniert überall.
 */

const STYLES = {
    normal: { label: "Normal", filter: "none" },
    crt:    { label: "CRT",    filter: "contrast(1.15) saturate(1.4) brightness(1.05) blur(0.15px)" },
    nvg:    { label: "NVG (Nachtsicht)",
              filter: "grayscale(1) sepia(1) hue-rotate(60deg) saturate(5) brightness(1.25) contrast(1.3)" },
    flir:   { label: "FLIR (Wärmebild)",
              filter: "grayscale(1) invert(1) sepia(1) hue-rotate(180deg) saturate(6) contrast(1.25)" },
    noir:   { label: "Noir", filter: "grayscale(1) contrast(1.25) brightness(0.95)" },
    snow:   { label: "Schnee", filter: "brightness(1.3) contrast(0.9) saturate(0.6)" }
};

const ORDER = ["normal", "crt", "nvg", "flir", "noir", "snow"];

export class SensorStyles {

    constructor(worldViewer) {
        this._canvas = worldViewer.scene.canvas;
        this._index = 0;
        this.onChange = null; // (key, label) => void
    }

    get current() { return ORDER[this._index]; }

    apply(key) {
        const style = STYLES[key];
        if (!style) return;
        this._index = ORDER.indexOf(key);
        this._canvas.style.filter = style.filter;
        this.onChange?.(key, style.label);
    }

    /** Zum nächsten Stil weiterschalten (Button/Taste). */
    cycle() {
        this._index = (this._index + 1) % ORDER.length;
        this.apply(ORDER[this._index]);
    }

    /** Direkt per Tastendruck 1–6 anwählen. */
    applyByDigit(digit) {
        const key = ORDER[digit - 1];
        if (key) this.apply(key);
    }
}
