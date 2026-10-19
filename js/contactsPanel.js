/**
 * contactsPanel.js – Sidebar/Rail-UI für die Kontakte-Liste (WEB-91).
 *
 * Zeigt alle Objekte aktiver Layer im einstellbaren Radius um das
 * Kamerazentrum, nach Entfernung sortiert. Klick auf eine Zeile nutzt die
 * bestehende Auswahl-/Tracking-Logik aus ui.js (keine neue Selektion).
 *
 * Lebt in der rechten Rail neben dem Detailpanel (U2 wird diese Rail später
 * dockbar/verschiebbar machen; bis dahin ist #right-rail ein einfacher
 * Flex-Stapel).
 */

import { LINK_TYPE_ICONS } from "./ui.js";

const TYPE_LABELS = {
    aircraft: "Flugzeug", ship: "Schiff", satellite: "Satellit",
    camera: "Kamera", infrastructure: "Infrastruktur", earthquake: "Erdbeben",
    launch: "Start", asteroid: "Asteroid", fire: "Feuer", radio: "Radio",
    cable: "Kabel", aqi: "Luftqualität", volcano: "Vulkan",
    fuelReserve: "Kraftstoff", weather: "Wetter", cyclone: "Zyklon",
    event: "Ereignis", comet: "Komet", allsky: "Allsky-Kamera",
    spaceWeather: "Weltraumwetter", heatmap: "Dichte", image: "Bild"
};

const kennung = (obj) => obj.metadata?.callsign ?? obj.name;

/** Aktualisierung drosseln: reicht für eine flüssige Liste ohne fps-Einbruch. */
const REFRESH_INTERVAL_MS = 1000;

export class ContactsPanel {

    /**
     * @param {ContactsRoster} roster
     * @param {UI} ui
     */
    constructor(roster, ui) {
        this.roster = roster;
        this.ui = ui;
        this.visible = false;
        this._lastRefresh = 0;

        this._el = {
            toggleBtn: document.getElementById("btn-contacts"),
            panel: document.getElementById("contacts-panel"),
            closeBtn: document.getElementById("contacts-close"),
            radiusInput: document.getElementById("contacts-radius"),
            countBadge: document.getElementById("contacts-count"),
            list: document.getElementById("contacts-list")
        };

        this._bind();
    }

    _bind() {
        this._el.toggleBtn?.addEventListener("click", () => this.toggle());
        this._el.closeBtn?.addEventListener("click", () => this.hide());

        this._el.radiusInput?.addEventListener("change", () => {
            this.roster.setRadiusKm(this._el.radiusInput.value);
            this._el.radiusInput.value = this.roster.radiusKm;
            this.refresh(true);
        });
    }

    toggle() {
        this.visible ? this.hide() : this.show();
    }

    show() {
        this.visible = true;
        this._el.panel?.classList.remove("hidden");
        this._el.toggleBtn?.classList.add("active");
        this.refresh(true);
    }

    hide() {
        this.visible = false;
        this._el.panel?.classList.add("hidden");
        this._el.toggleBtn?.classList.remove("active");
    }

    /**
     * Von der zentralen Update-Schleife aufgerufen – drosselt selbst, damit
     * ein voller Neuaufbau der Liste nicht pro Frame passiert.
     * @param {number} now performance.now()-Zeitstempel
     * @param {boolean} force Drosselung ignorieren (z.B. nach Radius-Änderung)
     */
    refresh(force = false, now = performance.now()) {
        if (!this.visible) return;
        if (!force && now - this._lastRefresh < REFRESH_INTERVAL_MS) return;
        this._lastRefresh = now;

        const contacts = this.roster.recompute();
        this._render(contacts);
    }

    _render(contacts) {
        if (this._el.countBadge) {
            this._el.countBadge.textContent = String(contacts.length);
        }

        const list = this._el.list;
        if (!list) return;
        list.innerHTML = "";

        if (contacts.length === 0) {
            list.innerHTML = `<p class="contacts-empty">Keine Objekte im Radius.</p>`;
            return;
        }

        for (const { object, distanceKm, bearingDeg } of contacts) {
            const icon = LINK_TYPE_ICONS[object.type] ?? "📍";
            const label = TYPE_LABELS[object.type] ?? object.type;
            const bearing = String(Math.round(bearingDeg) % 360).padStart(3, "0");
            const distance = distanceKm < 10
                ? `${distanceKm.toFixed(1)} km`
                : `${Math.round(distanceKm)} km`;

            const row = document.createElement("li");
            row.className = "contact-row";
            row.dataset.id = object.id;
            row.innerHTML = `
                <span class="contact-icon" title="${label}">${icon}</span>
                <span class="contact-name">${kennung(object)}</span>
                <span class="contact-distance">${distance}</span>
                <span class="contact-bearing">${bearing}°</span>`;
            row.addEventListener("click", () => {
                const entity = this.ui.layerManager.findEntityById(object.id);
                if (entity) this.ui.selectEntity(entity, { fly: true });
            });
            list.appendChild(row);
        }
    }
}
