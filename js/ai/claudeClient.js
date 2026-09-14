/**
 * claudeClient.js – Anbindung an die Claude API (Anthropic).
 *
 * Zwei Betriebsarten (in config.js einstellbar):
 *
 *  1. mode: "proxy"  (EMPFOHLEN, Standard)
 *     Der Browser spricht mit einem kleinen eigenen Server
 *     (server/claude-proxy.mjs), der den API-Key kennt.
 *     Der Key verlässt niemals den Server → sicher, auch im Internet.
 *
 *  2. mode: "direct"
 *     Der Browser spricht DIREKT mit api.anthropic.com. Anthropic
 *     erlaubt das über den Header `anthropic-dangerous-direct-browser-access`.
 *     Bequem zum lokalen Testen – aber der API-Key steht dann im
 *     Browser und ist für jeden sichtbar, der die Seite aufruft.
 *     Deshalb NUR lokal verwenden, niemals öffentlich hosten.
 *
 * Die Antwort wird gestreamt (Server-Sent Events), damit der Text
 * wie in einem Chat nach und nach erscheint.
 */

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export class ClaudeClient {

    constructor() {
        this._abort = null;
        // "proxy" | "direct" | "none" – wird von resolveMode() ermittelt
        this.resolvedMode = null;
        this.statusText = "";
    }

    get config() {
        return window.WORLD_VIEWER_CONFIG?.ai ?? {};
    }

    /**
     * Ermittelt, wie (und ob) Claude erreichbar ist.
     * Im Proxy-Modus wird der Server tatsächlich angefragt – so merkt der
     * Nutzer sofort, wenn der Proxy nicht läuft, statt erst beim Absenden.
     *
     * @returns {Promise<"proxy"|"direct"|"none">}
     */
    async resolveMode() {
        const cfg = this.config;

        if (cfg.mode === "direct") {
            if (this.getApiKey()) {
                this.statusText = "Direktzugriff aus dem Browser";
                this.resolvedMode = "direct";
            } else {
                this.statusText = "Modus: direkt – es fehlt noch ein API-Key";
                this.resolvedMode = "none";
            }
            return this.resolvedMode;
        }

        // Proxy-Modus: Server wirklich prüfen
        const health = await this.probeProxy();

        if (health.reachable && health.keyConfigured) {
            this.statusText = "Verbunden über den lokalen Proxy";
            this.resolvedMode = "proxy";
        } else if (this.getApiKey()) {
            // Proxy nicht nutzbar, aber ein Key liegt im Browser → direkt weiter
            this.statusText = "Proxy nicht verfügbar – nutze Direktzugriff";
            this.resolvedMode = "direct";
        } else {
            this.statusText = health.reachable
                ? "Proxy läuft, aber ohne ANTHROPIC_API_KEY"
                : "Proxy nicht erreichbar (server/claude-proxy.mjs nicht gestartet)";
            this.resolvedMode = "none";
        }
        return this.resolvedMode;
    }

    /** Fragt den Health-Endpunkt des Proxys ab. */
    async probeProxy() {
        const chatUrl = this.config.proxyUrl || "/api/chat";
        const healthUrl = chatUrl.replace(/\/chat$/, "/health");

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2500);
            const res = await fetch(healthUrl, { signal: controller.signal });
            clearTimeout(timer);
            if (!res.ok) return { reachable: false, keyConfigured: false };
            const data = await res.json();
            return { reachable: true, keyConfigured: !!data.keyConfigured };
        } catch {
            return { reachable: false, keyConfigured: false };
        }
    }

    /** Ist der Assistent einsatzbereit? (nach resolveMode) */
    isConfigured() {
        return this.resolvedMode === "proxy" || this.resolvedMode === "direct";
    }

    /**
     * API-Key ermitteln: bevorzugt aus config.js, alternativ aus dem
     * Browser-Speicher (der Nutzer kann ihn im UI eintragen, ohne
     * eine Datei zu bearbeiten).
     */
    getApiKey() {
        const fromConfig = this.config.apiKey;
        if (fromConfig) return fromConfig;
        try {
            return localStorage.getItem("worldviewer.anthropicKey") || "";
        } catch {
            return "";
        }
    }

    /** Key im Browser speichern (nur lokal auf diesem Gerät). */
    setApiKey(key) {
        try {
            if (key) localStorage.setItem("worldviewer.anthropicKey", key);
            else localStorage.removeItem("worldviewer.anthropicKey");
        } catch (err) {
            console.warn("[claude] Key konnte nicht gespeichert werden:", err);
        }
    }

    /** Laufende Anfrage abbrechen. */
    cancel() {
        if (this._abort) {
            this._abort.abort();
            this._abort = null;
        }
    }

    /**
     * Nachricht an Claude senden – mit Streaming.
     *
     * @param {object} params
     * @param {string} params.system         System-Prompt (Kontext zum Ort)
     * @param {Array}  params.messages       [{role:"user"|"assistant", content:"…"}]
     * @param {(chunk:string)=>void} params.onDelta  wird pro Textstück aufgerufen
     * @returns {Promise<string>} vollständiger Antworttext
     */
    async send({ system, messages, onDelta }) {
        const cfg = this.config;
        this.cancel();
        this._abort = new AbortController();

        const body = {
            model: cfg.model || "claude-sonnet-5",
            max_tokens: cfg.maxTokens ?? 1024,
            system,
            messages,
            stream: true
        };

        // Modus notfalls jetzt bestimmen (falls resolveMode noch nicht lief)
        if (!this.resolvedMode) await this.resolveMode();

        let url, headers;

        if (this.resolvedMode === "direct") {
            const key = this.getApiKey();
            if (!key) throw new Error("Kein Anthropic-API-Key hinterlegt.");
            url = API_URL;
            headers = {
                "content-type": "application/json",
                "x-api-key": key,
                "anthropic-version": API_VERSION,
                // Erlaubt den direkten Aufruf aus dem Browser (CORS)
                "anthropic-dangerous-direct-browser-access": "true"
            };
        } else {
            url = cfg.proxyUrl || "/api/chat";
            headers = { "content-type": "application/json" };
        }

        let response;
        try {
            response = await fetch(url, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: this._abort.signal
            });
        } catch (err) {
            if (err.name === "AbortError") throw err;
            throw new Error(
                this.resolvedMode === "direct"
                    ? "Verbindung zur Claude API fehlgeschlagen. Internetverbindung prüfen."
                    : `Proxy nicht erreichbar (${url}). Läuft der Server? (node server/claude-proxy.mjs)`
            );
        }

        if (!response.ok) {
            throw new Error(await this._describeError(response));
        }

        return this._readStream(response, onDelta);
    }

    /** Aussagekräftige Fehlermeldung aus der API-Antwort bauen. */
    async _describeError(response) {
        let detail = "";
        try {
            const data = await response.json();
            detail = data?.error?.message ?? "";
        } catch { /* kein JSON */ }

        switch (response.status) {
            case 401: return "API-Key ungültig oder fehlt (401).";
            case 403: return "Zugriff verweigert (403). Key-Berechtigungen prüfen.";
            case 404: return `Endpunkt nicht gefunden (404). ${detail}`;
            case 429: return "Zu viele Anfragen (429). Kurz warten und erneut versuchen.";
            case 529: return "Claude ist gerade überlastet (529). Bitte erneut versuchen.";
            default:  return `Fehler ${response.status}${detail ? ": " + detail : ""}`;
        }
    }

    /** SSE-Stream lesen und Textstücke durchreichen. */
    async _readStream(response, onDelta) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // SSE-Events sind durch Leerzeilen getrennt
            const events = buffer.split("\n\n");
            buffer = events.pop() ?? "";

            for (const event of events) {
                for (const line of event.split("\n")) {
                    if (!line.startsWith("data:")) continue;
                    const payload = line.slice(5).trim();
                    if (!payload || payload === "[DONE]") continue;

                    try {
                        const data = JSON.parse(payload);
                        if (data.type === "content_block_delta" && data.delta?.text) {
                            full += data.delta.text;
                            onDelta?.(data.delta.text);
                        } else if (data.type === "error") {
                            throw new Error(data.error?.message ?? "Unbekannter API-Fehler");
                        }
                    } catch (err) {
                        if (err instanceof SyntaxError) continue; // unvollständiges JSON
                        throw err;
                    }
                }
            }
        }

        this._abort = null;
        return full;
    }
}
