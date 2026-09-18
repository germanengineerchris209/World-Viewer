/**
 * watchlistPanel.js – Sidebar-UI für Beobachtungszonen und Alarme.
 *
 * Bedienung: "Zone hinzufügen" → Klick auf die Karte setzt den Mittelpunkt,
 * Name und Radius werden abgefragt. Jede Zone erscheint als Kreis auf dem
 * Globus; betritt oder verlässt ein Objekt eine Zone, erscheint ein Alarm
 * in der Liste (anklickbar → fliegt zum Objekt).
 */

const TYPE_ICONS = {
    aircraft: "✈️", ship: "🚢", satellite: "🛰️",
    camera: "📷", infrastructure: "🏗️", earthquake: "🌋",
    launch: "🚀", fire: "🔥"
};

const EVENT_LABEL = { entered: "hat betreten", exited: "hat verlassen" };

const MAX_VISIBLE_ALERTS = 30;

export class WatchlistPanel {

    /**
     * @param {Watchlist} watchlist
     * @param {WorldViewer} worldViewer
     * @param {UI} ui
     */
    constructor(watchlist, worldViewer, ui) {
        this.watchlist = watchlist;
        this.worldViewer = worldViewer;
        this.ui = ui;

        this._picking = false;

        this._el = {
            addBtn: document.getElementById("watchlist-add"),
            zoneList: document.getElementById("watchlist-zones"),
            alertList: document.getElementById("watchlist-alerts"),
            clearBtn: document.getElementById("watchlist-clear")
        };

        watchlist.onAlert = (alert) => this._addAlertRow(alert);
        watchlist.onZonesChanged = () => this._renderZones();

        this._bind();
        this._renderZones();
    }

    _bind() {
        this._el.addBtn.addEventListener("click", () => this._startPicking());
        this._el.clearBtn.addEventListener("click", () => {
            this._el.alertList.innerHTML = "";
            this.watchlist.clearAlerts();
        });
    }

    /** Wartet auf einen Klick auf die Karte, dann Name/Radius abfragen. */
    _startPicking() {
        if (this._picking) return;
        this._picking = true;
        this._el.addBtn.classList.add("active");
        const originalLabel = this._el.addBtn.textContent;
        this._el.addBtn.textContent = "📍 Ort auf der Karte anklicken …";

        this.worldViewer.requestLocationPick((lon, lat) => {
            this._picking = false;
            this._el.addBtn.classList.remove("active");
            this._el.addBtn.textContent = originalLabel;
            if (lon == null || lat == null) return;

            const name = window.prompt("Name der Beobachtungszone:", "Neue Zone");
            if (name === null) return; // abgebrochen

            const radiusInput = window.prompt("Radius in km:", "25");
            if (radiusInput === null) return; // abgebrochen

            const radiusKm = parseFloat(radiusInput.replace(",", "."));
            if (!isFinite(radiusKm) || radiusKm <= 0) {
                alert("Ungültiger Radius – die Zone wurde nicht angelegt.");
                return;
            }

            this.watchlist.addZone({ name, lat, lon, radiusKm });
        });
    }

    _renderZones() {
        this._el.zoneList.innerHTML = "";
        for (const zone of this.watchlist.zones) {
            const row = document.createElement("div");
            row.className = "watchlist-zone-row";
            row.innerHTML = `
                <span class="wz-name">🔶 ${zone.name}</span>
                <span class="wz-radius">${zone.radiusKm} km</span>
                <button class="wz-remove" title="Zone entfernen">✕</button>`;
            row.querySelector(".wz-remove").addEventListener("click", () => {
                this.watchlist.removeZone(zone.id);
            });
            this._el.zoneList.appendChild(row);
        }

        if (this.watchlist.zones.length === 0) {
            this._el.zoneList.innerHTML =
                `<p class="watchlist-empty">Noch keine Zonen angelegt.</p>`;
        }
    }

    _addAlertRow(alert) {
        const li = document.createElement("li");
        li.className = `watchlist-alert wa-${alert.event}`;
        const time = new Date(alert.timestamp).toLocaleTimeString("de-DE");
        const icon = TYPE_ICONS[alert.objectType] ?? "📍";
        li.innerHTML = `
            <span class="wa-icon">${icon}</span>
            <span class="wa-text">${alert.objectName} ${EVENT_LABEL[alert.event]}
                „${alert.zoneName}"</span>
            <span class="wa-time">${time}</span>`;
        li.addEventListener("click", () => {
            const entity = this.ui.layerManager.findEntityById(alert.objectId);
            if (entity) this.ui.selectEntity(entity, { fly: true });
        });
        this._el.alertList.prepend(li);

        while (this._el.alertList.children.length > MAX_VISIBLE_ALERTS) {
            this._el.alertList.removeChild(this._el.alertList.lastChild);
        }
    }
}
