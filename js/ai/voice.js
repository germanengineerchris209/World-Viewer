/**
 * voice.js – Spracheingabe und Sprachausgabe für den KI-Assistenten.
 *
 * Beides läuft über die im Browser eingebaute Web Speech API:
 *   • Eingabe  → SpeechRecognition   (Diktat)
 *   • Ausgabe  → speechSynthesis     (Vorlesen)
 *
 * Damit sind KEIN API-Key und KEINE zusätzlichen Kosten nötig.
 *
 * Unterstützung:
 *   Vorlesen  – alle gängigen Browser
 *   Diktat    – Chrome, Edge und Safari (in Firefox standardmäßig nicht)
 *
 * Wichtig: Für das Mikrofon verlangen Browser eine sichere Herkunft,
 * also HTTPS oder localhost. Auf http://localhost:8000 funktioniert es.
 */

const CFG = () => window.WORLD_VIEWER_CONFIG?.voice ?? {};

/* ═══════════════════════════════════════════════════════════
   Spracheingabe (Diktat)
   ═══════════════════════════════════════════════════════════ */

export class VoiceInput {

    constructor() {
        const Impl = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.supported = !!Impl;
        this.listening = false;

        // Callbacks, die der Assistent setzt
        this.onInterim = null;    // (text) => void   Zwischenergebnis
        this.onResult = null;     // (text) => void   endgültiges Ergebnis
        this.onStateChange = null;// (listening) => void
        this.onError = null;      // (message) => void

        if (!this.supported) return;

        this._recognition = new Impl();
        this._recognition.lang = CFG().language || "de-DE";
        this._recognition.continuous = false;      // eine Frage pro Aufnahme
        this._recognition.interimResults = true;   // Live-Text während des Sprechens
        this._recognition.maxAlternatives = 1;

        this._finalText = "";
        this._bind();
    }

    _bind() {
        const rec = this._recognition;

        rec.onstart = () => {
            this.listening = true;
            this._finalText = "";
            this.onStateChange?.(true);
        };

        rec.onresult = (event) => {
            let interim = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) this._finalText += result[0].transcript;
                else interim += result[0].transcript;
            }
            if (interim) this.onInterim?.((this._finalText + interim).trim());
        };

        rec.onerror = (event) => {
            // "aborted" entsteht beim absichtlichen Stoppen – kein Fehler
            if (event.error === "aborted") return;

            const messages = {
                "no-speech": "Nichts gehört – bitte noch einmal versuchen.",
                "audio-capture": "Kein Mikrofon gefunden.",
                "not-allowed": "Mikrofon-Zugriff wurde abgelehnt. "
                    + "In den Browsereinstellungen für diese Seite erlauben.",
                "service-not-allowed": "Die Spracherkennung ist in diesem Browser gesperrt.",
                "network": "Die Spracherkennung braucht eine Internetverbindung."
            };
            this.onError?.(messages[event.error] ?? `Spracherkennung: ${event.error}`);
        };

        rec.onend = () => {
            this.listening = false;
            this.onStateChange?.(false);

            const text = this._finalText.trim();
            this._finalText = "";
            if (text) this.onResult?.(text);
        };
    }

    /** Aufnahme starten. */
    start() {
        if (!this.supported || this.listening) return false;
        try {
            this._recognition.lang = CFG().language || "de-DE";
            this._recognition.start();
            return true;
        } catch (err) {
            // Kommt vor, wenn start() zu schnell hintereinander aufgerufen wird
            console.debug("[voice] start:", err.message);
            return false;
        }
    }

    /** Aufnahme beenden – ein bereits erkannter Text wird noch geliefert. */
    stop() {
        if (!this.supported || !this.listening) return;
        try { this._recognition.stop(); } catch { /* egal */ }
    }

    /** Aufnahme abbrechen, ohne Ergebnis zu liefern. */
    abort() {
        if (!this.supported) return;
        this._finalText = "";
        try { this._recognition.abort(); } catch { /* egal */ }
    }

    toggle() {
        this.listening ? this.stop() : this.start();
    }
}

/* ═══════════════════════════════════════════════════════════
   Sprachausgabe (Vorlesen)
   ═══════════════════════════════════════════════════════════ */

/**
 * Bereitet Text fürs Vorlesen auf: Markdown, Emoji und Symbole würden
 * sonst mitgesprochen ("Sternchen Sternchen München").
 */
export function textToSpeech(text) {
    return text
        // Markdown entfernen
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/\*(.+?)\*/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/^[-•*]\s+/gm, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        // Symbole, die in dieser App häufig vorkommen, aussprechbar machen
        .replace(/→/g, " nach ")
        .replace(/(\d)\s*°/g, "$1 Grad")
        .replace(/\bkm\/h\b/g, "Kilometer pro Stunde")
        .replace(/\bkn\b/g, "Knoten")
        .replace(/\bm\/s\b/g, "Meter pro Sekunde")
        // Emoji und übrige Piktogramme entfernen
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, "")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

export class VoiceOutput {

    constructor() {
        this.supported = typeof window.speechSynthesis !== "undefined";
        this.enabled = false;        // vom Nutzer per Schalter aktiviert
        this.speaking = false;

        this.onStateChange = null;   // (speaking) => void
        this.onUnavailable = null;   // (message) => void – einmalig bei Fehlern
        this._failed = false;

        this._buffer = "";           // noch nicht gesprochener Reststext
        this._queue = 0;             // wie viele Sätze noch anstehen
        this._voice = null;

        if (!this.supported) return;

        // Stimmen stehen in Chrome erst nach einem Ereignis bereit
        this._pickVoice();
        window.speechSynthesis.addEventListener?.(
            "voiceschanged", () => this._pickVoice());
    }

    /** Sucht eine passende Stimme zur eingestellten Sprache. */
    _pickVoice() {
        const voices = window.speechSynthesis.getVoices?.() ?? [];
        if (!voices.length) return;

        const cfg = CFG();
        const lang = (cfg.language || "de-DE").toLowerCase();

        // 1. Ausdrücklich gewünschte Stimme
        if (cfg.voiceName) {
            const exact = voices.find(v => v.name === cfg.voiceName);
            if (exact) { this._voice = exact; return; }
        }
        // 2. Beste Übereinstimmung mit der Sprache, lokale Stimmen bevorzugt
        const matching = voices.filter(v => v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
        this._voice = matching.find(v => v.localService) ?? matching[0] ?? voices[0];
    }

    /** Verfügbare Stimmen (für eine spätere Auswahl im UI). */
    listVoices() {
        return (window.speechSynthesis.getVoices?.() ?? [])
            .map(v => ({ name: v.name, lang: v.lang, local: v.localService }));
    }

    /**
     * Nimmt einen Textabschnitt aus dem laufenden Stream entgegen und
     * spricht ihn SATZWEISE. So beginnt die Ausgabe fast sofort, statt
     * bis zum Ende der Antwort zu warten – und klingt trotzdem natürlich,
     * weil nie mitten im Satz abgesetzt wird.
     */
    feed(chunk) {
        if (!this.supported || !this.enabled) return;
        this._buffer += chunk;

        // Vollständige Sätze aus dem Puffer herausschneiden
        const pattern = /[^.!?:;\n]+[.!?:;\n]+/g;
        let match, consumed = 0;

        while ((match = pattern.exec(this._buffer)) !== null) {
            this._speakSentence(match[0]);
            consumed = match.index + match[0].length;
        }
        if (consumed) this._buffer = this._buffer.slice(consumed);
    }

    /** Rest des Puffers sprechen (am Ende der Antwort aufrufen). */
    flush() {
        if (!this.supported || !this.enabled) return;
        const rest = this._buffer.trim();
        this._buffer = "";
        if (rest) this._speakSentence(rest);
    }

    /**
     * Einen einzelnen Satz in die Warteschlange geben.
     *
     * WICHTIG: Hier darf nichts nach außen dringen. Die Sprachausgabe ist
     * eine Zugabe – wenn der Browser sie verweigert (fehlende Stimme,
     * Autoplay-Sperre, Eigenheiten einzelner Systeme), darf das niemals
     * die laufende Antwort abbrechen. Deshalb ist alles gekapselt.
     */
    _speakSentence(raw) {
        try {
            const text = textToSpeech(raw);
            if (!text || !/[a-zA-ZäöüÄÖÜß0-9]/.test(text)) return;

            const utterance = new SpeechSynthesisUtterance(text);
            const cfg = CFG();
            utterance.lang = cfg.language || "de-DE";
            utterance.rate = cfg.rate ?? 1.05;
            utterance.pitch = cfg.pitch ?? 1.0;
            utterance.volume = cfg.volume ?? 1.0;
            if (this._voice) utterance.voice = this._voice;

            utterance.onstart = () => {
                if (!this.speaking) {
                    this.speaking = true;
                    this.onStateChange?.(true);
                }
            };
            const done = () => {
                this._queue = Math.max(0, this._queue - 1);
                if (this._queue === 0 && this.speaking) {
                    this.speaking = false;
                    this.onStateChange?.(false);
                }
            };
            utterance.onend = done;
            utterance.onerror = done;

            this._queue++;
            window.speechSynthesis.speak(utterance);

        } catch (err) {
            // Einmal melden und die Sprachausgabe stilllegen,
            // statt bei jedem Satz erneut zu scheitern
            this._queue = Math.max(0, this._queue - 1);
            if (!this._failed) {
                this._failed = true;
                console.warn("[voice] Sprachausgabe nicht möglich:", err.message);
                this.enabled = false;
                this.onStateChange?.(false);
                this.onUnavailable?.(err.message);
            }
        }
    }

    /** Kompletten Text am Stück vorlesen (z.B. eine ältere Nachricht). */
    speakAll(text) {
        if (!this.supported || this._failed) return;
        this.cancel();
        const wasEnabled = this.enabled;
        this.enabled = true;
        this.feed(text);
        this.flush();
        this.enabled = wasEnabled;
    }

    /** Sofort verstummen und die Warteschlange leeren. */
    cancel() {
        if (!this.supported) return;
        this._buffer = "";
        this._queue = 0;
        try { window.speechSynthesis.cancel(); } catch { /* egal */ }
        if (this.speaking) {
            this.speaking = false;
            this.onStateChange?.(false);
        }
    }

    setEnabled(on) {
        this.enabled = !!on;
        if (!on) this.cancel();
        return this.enabled;
    }
}
