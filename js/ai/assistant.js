/**
 * assistant.js – KI-Assistent (Button unten links + Chatfenster).
 *
 * Der Nutzer kann Fragen zum aktuell betrachteten Ort stellen –
 * getippt oder gesprochen. Der Kontext (Koordinaten, Ortsname,
 * sichtbare Objekte) wird automatisch an Claude mitgeschickt.
 *
 * Sprache läuft über die im Browser eingebaute Web Speech API
 * (siehe voice.js): Mikrofon zum Diktieren, Vorlesen der Antworten
 * satzweise schon während des Streamings.
 */

import { ClaudeClient } from "./claudeClient.js";
import { buildContext, SYSTEM_PROMPT_BASE } from "./locationContext.js";
import { VoiceInput, VoiceOutput } from "./voice.js";

/** Vorschlagsfragen, die als Chips angeboten werden. */
const SUGGESTIONS = [
    "Was ist hier zu sehen?",
    "Erzähl mir die Geschichte dieses Ortes",
    "Welche Sehenswürdigkeiten gibt es hier?",
    "Was ist wirtschaftlich wichtig an dieser Region?",
    "Erkläre mir das ausgewählte Objekt"
];

export class Assistant {

    /**
     * @param {WorldViewer} worldViewer
     * @param {LayerManager} layerManager
     * @param {UI} ui
     */
    constructor(worldViewer, layerManager, ui) {
        this.worldViewer = worldViewer;
        this.layerManager = layerManager;
        this.ui = ui;

        this.client = new ClaudeClient();
        this.history = [];          // [{role, content}]
        this.busy = false;

        this._el = {
            button: document.getElementById("ai-button"),
            panel: document.getElementById("ai-panel"),
            close: document.getElementById("ai-close"),
            messages: document.getElementById("ai-messages"),
            input: document.getElementById("ai-input"),
            send: document.getElementById("ai-send"),
            stop: document.getElementById("ai-stop"),
            clear: document.getElementById("ai-clear"),
            place: document.getElementById("ai-place"),
            suggestions: document.getElementById("ai-suggestions"),
            setup: document.getElementById("ai-setup"),
            keyInput: document.getElementById("ai-key-input"),
            keySave: document.getElementById("ai-key-save"),
            mic: document.getElementById("ai-mic"),
            speakToggle: document.getElementById("ai-speak-toggle"),
            handsFreeToggle: document.getElementById("ai-handsfree-toggle"),
            listening: document.getElementById("ai-listening"),
            transcript: document.getElementById("ai-transcript")
        };

        this.voiceIn = new VoiceInput();
        this.voiceOut = new VoiceOutput();
        this.handsFree = !!(window.WORLD_VIEWER_CONFIG?.voice?.handsFree);

        this._bind();
        this._setupVoice();
        this._renderSuggestions();
        // Erreichbarkeit im Hintergrund prüfen (blockiert den Start nicht)
        this._checkConfiguration();
    }

    /* ─────────── Aufbau ─────────── */

    _bind() {
        this._el.button.addEventListener("click", () => this.toggle());
        this._el.close.addEventListener("click", () => this.close());
        this._el.send.addEventListener("click", () => this._submit());
        this._el.stop.addEventListener("click", () => this._stop());
        this._el.clear.addEventListener("click", () => this._clearChat());

        this._el.input.addEventListener("keydown", (e) => {
            // Enter sendet, Shift+Enter macht einen Zeilenumbruch
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this._submit();
            }
        });

        // Textfeld mitwachsen lassen
        this._el.input.addEventListener("input", () => {
            this._el.input.style.height = "auto";
            this._el.input.style.height = Math.min(this._el.input.scrollHeight, 120) + "px";
        });

        this._el.keySave.addEventListener("click", async () => {
            const key = this._el.keyInput.value.trim();
            if (!key) return;
            this.client.setApiKey(key);
            this._el.keyInput.value = "";
            const ok = await this._checkConfiguration();
            this._addMessage("system", ok
                ? "API-Key gespeichert. Du kannst jetzt Fragen stellen."
                : "Key gespeichert, aber Claude ist weiterhin nicht erreichbar.");
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && this.isOpen) this.close();
        });
    }

    /* ─────────── Sprache ─────────── */

    _setupVoice() {
        const cfg = window.WORLD_VIEWER_CONFIG?.voice ?? {};

        /* ── Eingabe (Mikrofon) ── */
        if (this.voiceIn.supported) {
            this._el.mic.addEventListener("click", () => this._toggleMic());

            this.voiceIn.onStateChange = (listening) => {
                this._el.mic.classList.toggle("listening", listening);
                this._el.listening.classList.toggle("hidden", !listening);
                if (listening) this._el.transcript.textContent = "Ich höre zu …";
            };

            // Live mitschreiben, damit man sieht, dass es funktioniert
            this.voiceIn.onInterim = (text) => {
                this._el.transcript.textContent = text;
            };

            this.voiceIn.onResult = (text) => {
                this._el.input.value = text;
                this._el.input.dispatchEvent(new Event("input"));
                if (cfg.autoSend !== false) this._submit();
                else this._el.input.focus();
            };

            this.voiceIn.onError = (message) => {
                this._el.listening.classList.add("hidden");
                this._addMessage("system", `🎤 ${message}`);
            };
        } else {
            this._el.mic.disabled = true;
            this._el.mic.title = "Dieser Browser unterstützt keine Spracheingabe "
                + "(funktioniert in Chrome, Edge und Safari).";
            this._el.mic.classList.add("unsupported");
        }

        /* ── Ausgabe (Vorlesen) ── */
        if (this.voiceOut.supported) {
            this.voiceOut.setEnabled(!!cfg.speakByDefault);
            this._updateSpeakButton();

            this._el.speakToggle.addEventListener("click", () => {
                const on = this.voiceOut.setEnabled(!this.voiceOut.enabled);
                this._updateSpeakButton();
                // Beim Einschalten die letzte Antwort gleich vorlesen
                if (on) {
                    const last = [...this.history].reverse()
                        .find(m => m.role === "assistant");
                    if (last) this.voiceOut.speakAll(last.content);
                }
            });

            // Während gesprochen wird, zeigt der Knopf das an
            this.voiceOut.onStateChange = () => this._updateSpeakButton();

            // Fällt die Sprachausgabe aus, sagen wir das einmal – der Chat
            // läuft normal weiter
            this.voiceOut.onUnavailable = () => {
                this._updateSpeakButton();
                this._el.speakToggle.disabled = true;
                this._addMessage("system",
                    "🔈 Die Sprachausgabe ist in diesem Browser nicht verfügbar. "
                    + "Der Chat funktioniert weiterhin.");
            };
        } else {
            this._el.speakToggle.disabled = true;
            this._el.speakToggle.title = "Dieser Browser kann keine Sprachausgabe.";
        }

        /* ── Freisprechen ── */
        if (this.voiceIn.supported && this.voiceOut.supported) {
            this._el.handsFreeToggle.addEventListener("click", () => {
                this.handsFree = !this.handsFree;
                // Freisprechen ergibt nur mit Sprachausgabe Sinn
                if (this.handsFree && !this.voiceOut.enabled) {
                    this.voiceOut.setEnabled(true);
                    this._updateSpeakButton();
                }
                this._el.handsFreeToggle.classList.toggle("active", this.handsFree);
                this._addMessage("system", this.handsFree
                    ? "Freisprechen ist an: Nach jeder Antwort höre ich automatisch weiter zu."
                    : "Freisprechen ist aus.");
            });
            this._el.handsFreeToggle.classList.toggle("active", this.handsFree);
        } else {
            this._el.handsFreeToggle.disabled = true;
            this._el.handsFreeToggle.title = "Benötigt Spracheingabe und -ausgabe.";
        }
    }

    _updateSpeakButton() {
        const btn = this._el.speakToggle;
        const on = this.voiceOut.enabled;
        btn.classList.toggle("active", on);
        btn.classList.toggle("speaking", this.voiceOut.speaking);
        btn.textContent = on ? (this.voiceOut.speaking ? "🔊" : "🔉") : "🔈";
        btn.title = on
            ? "Vorlesen ist an – klicken zum Ausschalten"
            : "Antworten vorlesen";
    }

    /** Mikrofon starten/stoppen. Beim Start verstummt die Sprachausgabe. */
    _toggleMic() {
        if (this.voiceIn.listening) {
            this.voiceIn.stop();
            return;
        }
        // Sonst würde das Mikrofon die eigene Sprachausgabe aufnehmen
        this.voiceOut.cancel();
        this.voiceIn.start();
    }

    _renderSuggestions() {
        this._el.suggestions.innerHTML = "";
        for (const text of SUGGESTIONS) {
            const chip = document.createElement("button");
            chip.className = "ai-chip";
            chip.textContent = text;
            chip.addEventListener("click", () => {
                this._el.input.value = text;
                this._submit();
            });
            this._el.suggestions.appendChild(chip);
        }
    }

    /**
     * Prüft (mit echter Server-Abfrage), ob Claude erreichbar ist,
     * und blendet bei Bedarf die Einrichtung ein.
     */
    async _checkConfiguration() {
        await this.client.resolveMode();
        return this._applyConfigurationState();
    }

    /** Übernimmt das Ergebnis der Prüfung ins UI (ohne erneute Abfrage). */
    _applyConfigurationState() {
        const ok = this.client.isConfigured();

        this._el.setup.classList.toggle("hidden", ok);
        this._el.input.disabled = !ok;
        this._el.send.disabled = !ok;
        this._el.input.placeholder = ok
            ? "Frage zu diesem Ort stellen …"
            : "Zuerst API-Key eintragen";

        this._el.setup.querySelector(".ai-setup-mode").textContent =
            this.client.statusText;

        // Button unten links kennzeichnen, wenn noch etwas fehlt
        this._el.button.classList.toggle("needs-setup", !ok);
        return ok;
    }

    /* ─────────── Öffnen / Schließen ─────────── */

    get isOpen() { return !this._el.panel.classList.contains("hidden"); }

    toggle() { this.isOpen ? this.close() : this.open(); }

    open() {
        this._el.panel.classList.remove("hidden");
        this._el.button.classList.add("active");
        this._updatePlaceLabel();
        // Beim Öffnen erneut prüfen – der Proxy könnte zwischenzeitlich laufen
        this._checkConfiguration().then((ok) => {
            if (ok && this.isOpen) this._el.input.focus();
        });
    }

    close() {
        this._el.panel.classList.add("hidden");
        this._el.button.classList.remove("active");
        // Nichts soll im Hintergrund weiterlaufen
        this.voiceIn.abort();
        this.voiceOut.cancel();
    }

    /** Zeigt oben im Panel, worüber gerade gesprochen wird. */
    async _updatePlaceLabel() {
        const cam = this.worldViewer.getCameraPosition();
        if (!cam) return;

        const selected = this.ui.selectedObject;
        if (selected) {
            this._el.place.textContent = `📍 ${selected.name}`;
            return;
        }
        this._el.place.textContent =
            `📍 ${cam.latitude.toFixed(2)}°, ${cam.longitude.toFixed(2)}°`;

        // Ortsname nachladen (kann einen Moment dauern)
        const { reverseGeocode } = await import("./locationContext.js");
        const place = await reverseGeocode(cam.latitude, cam.longitude, cam.height);
        if (place && this.isOpen) {
            // Nur die ersten beiden Bestandteile zeigen, sonst wird es zu lang
            const short = place.split(",").slice(0, 2).join(",").trim();
            this._el.place.textContent = `📍 ${short}`;
        }
    }

    /* ─────────── Chat ─────────── */

    _clearChat() {
        this.voiceOut.cancel();
        this.history = [];
        this._el.messages.innerHTML = "";
        this._addMessage("system",
            "Chat geleert. Frag mich etwas über den Ort, den du gerade betrachtest.");
    }

    /**
     * Fügt eine Nachricht in die Anzeige ein.
     * @returns {HTMLElement} das Textelement (für Streaming-Updates)
     */
    _addMessage(role, text) {
        const wrapper = document.createElement("div");
        wrapper.className = `ai-msg ai-msg-${role}`;

        const bubble = document.createElement("div");
        bubble.className = "ai-bubble";
        bubble.textContent = text;

        wrapper.appendChild(bubble);
        this._el.messages.appendChild(wrapper);
        this._el.messages.scrollTop = this._el.messages.scrollHeight;
        return bubble;
    }

    /** Sehr einfache Markdown-Darstellung (fett, Listen, Absätze). */
    _renderMarkdown(element, text) {
        const escaped = text
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        const html = escaped
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/\*(.+?)\*/g, "<em>$1</em>")
            .replace(/^[-•]\s+(.+)$/gm, "<li>$1</li>")
            .replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>")
            .replace(/\n{2,}/g, "</p><p>")
            .replace(/\n/g, "<br>");

        element.innerHTML = `<p>${html}</p>`;
    }

    async _submit() {
        const text = this._el.input.value.trim();
        if (!text || this.busy) return;
        if (!this.client.isConfigured() && !(await this._checkConfiguration())) return;

        this._el.input.value = "";
        this._el.input.style.height = "auto";
        this._el.suggestions.classList.add("hidden");

        this._addMessage("user", text);
        this.history.push({ role: "user", content: text });

        this.busy = true;
        this._el.send.classList.add("hidden");
        this._el.stop.classList.remove("hidden");

        const bubble = this._addMessage("assistant", "");
        bubble.classList.add("ai-typing");
        bubble.textContent = "…";

        let answer = "";

        try {
            // Kontext frisch aufbauen – der Nutzer hat evtl. gerade woanders hingeflogen
            const context = await buildContext(
                this.worldViewer, this.layerManager, this.ui.selectedObject);
            const system = `${SYSTEM_PROMPT_BASE}\n\n${context}`;

            answer = await this.client.send({
                system,
                messages: this.history,
                onDelta: (chunk) => {
                    if (!answer) {
                        bubble.classList.remove("ai-typing");
                        bubble.textContent = "";
                    }
                    answer += chunk;
                    this._renderMarkdown(bubble, answer);
                    // Satzweise vorlesen, sobald ein Satz vollständig ist
                    this.voiceOut.feed(chunk);
                    this._el.messages.scrollTop = this._el.messages.scrollHeight;
                }
            });

            if (answer) {
                this.history.push({ role: "assistant", content: answer });
                this.voiceOut.flush();          // letzten Satz nachreichen
                this._maybeListenAgain();
            } else {
                bubble.classList.remove("ai-typing");
                bubble.textContent = "(keine Antwort erhalten)";
            }
        } catch (err) {
            bubble.classList.remove("ai-typing");
            this.voiceOut.cancel();
            if (err.name === "AbortError") {
                // Teilantwort behalten, wenn schon etwas da war
                if (answer) {
                    this.history.push({ role: "assistant", content: answer });
                    bubble.insertAdjacentHTML("beforeend",
                        `<span class="ai-note">(abgebrochen)</span>`);
                } else {
                    bubble.parentElement.remove();
                    this.history.pop();
                }
            } else {
                bubble.classList.add("ai-error");
                bubble.textContent = `⚠️ ${err.message}`;
                // Die fehlgeschlagene Frage nicht im Verlauf behalten
                this.history.pop();
            }
        } finally {
            this.busy = false;
            this._el.send.classList.remove("hidden");
            this._el.stop.classList.add("hidden");
            this._el.messages.scrollTop = this._el.messages.scrollHeight;
        }
    }

    _stop() {
        this.client.cancel();
        this.voiceOut.cancel();
    }

    /**
     * Freisprechen: Wenn die Sprachausgabe fertig ist, wieder zuhören.
     * So entsteht ein echtes Gespräch, ohne dass man klicken muss.
     */
    _maybeListenAgain() {
        if (!this.handsFree || !this.voiceIn.supported || !this.isOpen) return;

        const start = () => {
            // Nur zuhören, wenn nichts mehr gesprochen wird und keine
            // Anfrage läuft – sonst nimmt das Mikrofon uns selbst auf
            if (!this.voiceOut.speaking && !this.busy && this.isOpen) {
                this.voiceIn.start();
            }
        };

        if (this.voiceOut.enabled && this.voiceOut.speaking) {
            // Warten, bis das Vorlesen durch ist
            const check = setInterval(() => {
                if (!this.voiceOut.speaking) { clearInterval(check); start(); }
            }, 400);
            // Sicherheitsnetz, falls onend einmal ausbleibt
            setTimeout(() => clearInterval(check), 60_000);
        } else {
            setTimeout(start, 400);
        }
    }

    /**
     * Wird aufgerufen, wenn der Nutzer ein Objekt auswählt –
     * der Assistent zeigt dann den passenden Ortsbezug an.
     */
    notifySelectionChanged() {
        if (this.isOpen) this._updatePlaceLabel();
    }

    /**
     * Öffnet den Assistenten mit einer vorbereiteten Frage zum Objekt
     * (Button "Claude dazu fragen" im Detailpanel).
     */
    async askAbout(object) {
        this._updatePlaceLabel();

        const question = object
            ? `Erzähl mir mehr über ${object.name}.`
            : "Was ist an diesem Ort interessant?";

        this._el.input.value = question;
        this._el.input.focus();

        // Direkt abschicken, wenn der Assistent einsatzbereit ist
        if (await this._checkConfiguration()) this._submit();
    }
}
