/**
 * streamPlayer.js – Bettet Kamera-Livebilder direkt in die App ein.
 *
 * Ein Kameraeintrag kann MEHRERE Ansichten haben (z.B. München:
 * Marienplatz, Olympiaturm, Hauptbahnhof, Isar). Dann erscheinen
 * kleine Umschalter über dem Bild.
 *
 * Unterstützte Typen (Feld `type` je Stream):
 *
 *   image    Standbildkamera, die sich selbst aktualisiert. Der häufigste
 *            Fall bei offiziellen Stadt- und Tourismus-Webcams.
 *   hls      .m3u8-Livestream über hls.js (Safari kann es nativ).
 *   youtube  YouTube-Live-Embed, per Video- oder – haltbarer – Kanal-ID.
 *   iframe   Player-Seite des Betreibers als eingebettete Seite.
 *   link     Nicht einbettbar → Hinweis mit Direktlink.
 *
 * PROXY: Viele Betreiber sperren fremde Seiten aus (Hotlink-Schutz oder
 * fehlende CORS-Header). Läuft der mitgelieferte Server, kann das Bild
 * über `/api/camera` geholt werden – der Server setzt dann einen passenden
 * Referer. Die Umschaltung passiert automatisch: erst direkt versuchen,
 * bei einem Fehler über den Proxy nachladen.
 */

const HLS_CDN = "https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js";

const CFG = () => window.WORLD_VIEWER_CONFIG?.cameras ?? {};

let hlsLoader = null;

/** hls.js einmalig nachladen (nur wenn wirklich ein HLS-Stream vorkommt). */
function loadHlsLibrary() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (hlsLoader) return hlsLoader;

    hlsLoader = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = HLS_CDN;
        script.onload = () => resolve(window.Hls);
        script.onerror = () => reject(new Error("hls.js konnte nicht geladen werden"));
        document.head.appendChild(script);
    });
    return hlsLoader;
}

/* ═══════════ Proxy-Verfügbarkeit ═══════════ */

let proxyAvailable = null;      // null = noch nicht geprüft

/** Prüft einmalig, ob der Kamera-Proxy erreichbar ist. */
async function checkProxy() {
    if (proxyAvailable !== null) return proxyAvailable;
    if (CFG().useProxy === false) { proxyAvailable = false; return false; }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(proxyBase() + "/status", { signal: controller.signal });
        clearTimeout(timer);
        proxyAvailable = res.ok;
    } catch {
        proxyAvailable = false;
    }
    return proxyAvailable;
}

function proxyBase() {
    return CFG().proxyUrl || "/api/camera";
}

/** Baut die Proxy-URL für eine Kameraquelle. */
function viaProxy(url, referer) {
    const params = new URLSearchParams({ url });
    if (referer) params.set("referer", referer);
    return `${proxyBase()}?${params.toString()}`;
}

/* ═══════════ Aktiver Player ═══════════ */

let active = { cleanup: null };

export function stopActiveStream() {
    if (active.cleanup) {
        try { active.cleanup(); } catch { /* egal */ }
        active.cleanup = null;
    }
}

/* ═══════════ Einstiegspunkt ═══════════ */

/**
 * Startet die Kameraansicht im angegebenen Container.
 *
 * @param {HTMLElement} container  Zielelement
 * @param {object} camera          normalisiertes Kamera-Objekt
 */
export function playCameraStream(container, camera) {
    stopActiveStream();

    container.innerHTML = "";
    container.classList.add("stream-container");

    const streams = collectStreams(camera);

    if (!streams.length) {
        renderFallback(container, {}, "Für diese Kamera ist kein Livebild hinterlegt.");
        return;
    }
    if (camera.metadata?.status === "offline") {
        renderFallback(container, streams[0], "Diese Kamera ist derzeit offline.");
        return;
    }

    // Bühne für das Bild + optionale Umschalter darüber
    const stage = document.createElement("div");
    stage.className = "stream-stage";
    container.appendChild(stage);

    if (streams.length > 1) {
        container.classList.add("has-switcher");
        container.appendChild(buildSwitcher(streams, stage));
    } else {
        container.classList.remove("has-switcher");
    }

    startStream(stage, streams[0]);
}

/** Vereinheitlicht `stream` (einzeln) und `streams` (mehrere). */
function collectStreams(camera) {
    const meta = camera.metadata ?? {};
    const list = [];

    if (Array.isArray(meta.streams)) {
        meta.streams.forEach((s, i) => {
            if (s && s.type) list.push({ label: s.label ?? `Ansicht ${i + 1}`, ...s });
        });
    }
    if (meta.stream && meta.stream.type) {
        list.push({ label: meta.stream.label ?? "Live", ...meta.stream });
    }
    return list;
}

/** Kleine Umschaltleiste für Standorte mit mehreren Kameras. */
function buildSwitcher(streams, stage) {
    const bar = document.createElement("div");
    bar.className = "stream-switcher";

    streams.forEach((stream, index) => {
        const btn = document.createElement("button");
        btn.className = "stream-tab" + (index === 0 ? " active" : "");
        btn.textContent = stream.label;
        btn.title = stream.label;
        btn.addEventListener("click", () => {
            bar.querySelectorAll(".stream-tab")
               .forEach(b => b.classList.toggle("active", b === btn));
            startStream(stage, stream);
        });
        bar.appendChild(btn);
    });
    return bar;
}

/** Startet eine einzelne Ansicht. */
function startStream(stage, stream) {
    stopActiveStream();
    stage.innerHTML = "";

    switch (stream.type) {
        case "image":   return playRefreshingImage(stage, stream);
        case "hls":     return playHls(stage, stream);
        case "youtube": return playYouTube(stage, stream);
        case "iframe":  return playIframe(stage, stream);
        default:        return renderFallback(stage, stream,
                            "Diese Kamera lässt sich nicht direkt einbetten.");
    }
}

/* ═══════════ Standbild, das sich selbst aktualisiert ═══════════ */

/**
 * Der wichtigste Fall: Die meisten offiziellen Webcams (Städte,
 * Tourismusverbände, Feratel & Co.) veröffentlichen ein JPEG, das
 * regelmäßig überschrieben wird.
 *
 * Ablauf: erst direkt laden. Scheitert das – etwa wegen Hotlink-Schutz –
 * wird automatisch über den Server-Proxy nachgeladen.
 */
function playRefreshingImage(stage, stream) {
    const img = document.createElement("img");
    img.className = "stream-frame stream-image";
    img.alt = stream.label ?? "Live-Kamerabild";
    img.referrerPolicy = "no-referrer";
    stage.appendChild(img);

    const badge = document.createElement("span");
    badge.className = "stream-live-badge";
    badge.textContent = "● LIVE";
    stage.appendChild(badge);

    const status = document.createElement("span");
    status.className = "stream-updated";
    stage.appendChild(status);

    let useProxy = stream.viaProxy === true;
    let stopped = false;
    let timer = null;

    const buildSrc = () => {
        const bust = `_t=${Date.now()}`;
        const direct = `${stream.url}${stream.url.includes("?") ? "&" : "?"}${bust}`;
        return useProxy ? viaProxy(direct, stream.referer) : direct;
    };

    const refresh = () => { if (!stopped) img.src = buildSrc(); };

    img.addEventListener("load", () => {
        status.textContent = new Date().toLocaleTimeString("de-DE");
        stage.classList.remove("stream-loading");
    });

    img.addEventListener("error", async () => {
        if (stopped) return;

        // Erster Fehlschlag: über den Proxy erneut versuchen
        if (!useProxy && await checkProxy()) {
            useProxy = true;
            console.info("[camera] Direktzugriff blockiert – lade über den Proxy.");
            refresh();
            return;
        }

        clearInterval(timer);
        renderFallback(stage, stream, useProxy
            ? "Kamerabild aktuell nicht erreichbar."
            : "Kamerabild blockiert. Mit laufendem Server (node server/server.mjs) "
              + "kann es über den Proxy geladen werden.");
    });

    stage.classList.add("stream-loading");
    refresh();
    timer = setInterval(refresh, (stream.refreshSeconds ?? 10) * 1000);

    addOverlayLinks(stage, stream, () => img.src);

    active.cleanup = () => { stopped = true; clearInterval(timer); };
}

/* ═══════════ HLS (.m3u8) ═══════════ */

function playHls(stage, stream) {
    const video = document.createElement("video");
    video.className = "stream-frame";
    video.autoplay = true;
    video.muted = true;        // ohne mute blockieren Browser den Autostart
    video.playsInline = true;
    video.controls = true;
    stage.appendChild(video);

    let hls = null;
    let stopped = false;

    const start = async (useProxy) => {
        const src = useProxy ? viaProxy(stream.url, stream.referer) : stream.url;

        // Safari & iOS können HLS direkt
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = src;
            video.addEventListener("error", async () => {
                if (stopped) return;
                if (!useProxy && await checkProxy()) return start(true);
                renderFallback(stage, stream, "Stream nicht erreichbar.");
            }, { once: true });
            return;
        }

        try {
            const Hls = await loadHlsLibrary();
            if (!Hls || !Hls.isSupported()) {
                renderFallback(stage, stream, "Dein Browser unterstützt diesen Stream nicht.");
                return;
            }
            hls = new Hls({ lowLatencyMode: true, liveDurationInfinity: true });
            hls.loadSource(src);
            hls.attachMedia(video);
            hls.on(Hls.Events.ERROR, async (_e, data) => {
                if (!data.fatal || stopped) return;
                hls.destroy();
                hls = null;
                if (!useProxy && await checkProxy()) return start(true);
                renderFallback(stage, stream, "Stream aktuell nicht erreichbar.");
            });
        } catch {
            renderFallback(stage, stream, "Player konnte nicht geladen werden.");
        }
    };

    start(stream.viaProxy === true);
    addOverlayLinks(stage, stream);

    active.cleanup = () => {
        stopped = true;
        if (hls) hls.destroy();
    };
}

/* ═══════════ YouTube ═══════════ */

function playYouTube(stage, stream) {
    // Kanal-Embed ist stabiler als eine feste Video-ID
    const src = stream.channelId
        ? `https://www.youtube.com/embed/live_stream?channel=${stream.channelId}&autoplay=1&mute=1`
        : `https://www.youtube.com/embed/${stream.videoId}?autoplay=1&mute=1&playsinline=1`;

    const iframe = document.createElement("iframe");
    iframe.className = "stream-frame";
    iframe.src = src;
    iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
    iframe.allowFullscreen = true;
    iframe.loading = "lazy";
    iframe.referrerPolicy = "origin";
    stage.appendChild(iframe);

    addOverlayLinks(stage, {
        ...stream,
        pageUrl: stream.pageUrl
            || (stream.videoId ? `https://www.youtube.com/watch?v=${stream.videoId}` : "")
    });

    active.cleanup = () => { iframe.src = "about:blank"; iframe.remove(); };
}

/* ═══════════ Player-Seite des Betreibers ═══════════ */

function playIframe(stage, stream) {
    const iframe = document.createElement("iframe");
    iframe.className = "stream-frame";
    iframe.src = stream.url;
    iframe.allow = "autoplay; fullscreen";
    iframe.allowFullscreen = true;
    iframe.loading = "lazy";
    stage.appendChild(iframe);

    // Wird das Einbetten verboten (X-Frame-Options), bleibt der Rahmen leer.
    // Nach kurzer Zeit einen Hinweis einblenden, ohne das iframe zu entfernen –
    // funktioniert es doch, sieht der Nutzer weiterhin das Bild.
    const note = document.createElement("div");
    note.className = "stream-iframe-note";
    note.innerHTML = `Lädt … falls nichts erscheint, erlaubt der Betreiber
        keine Einbettung.`;
    stage.appendChild(note);
    const timer = setTimeout(() => note.remove(), 6000);

    addOverlayLinks(stage, stream);

    active.cleanup = () => {
        clearTimeout(timer);
        iframe.src = "about:blank";
        iframe.remove();
    };
}

/* ═══════════ Internetradio ═══════════ */

/**
 * Startet einen Radiosender im angegebenen Container.
 * Analog zu playCameraStream(), aber mit einem schlichten HTML5-
 * `<audio>`-Element statt Bild/Video.
 *
 * @param {HTMLElement} container  Zielelement
 * @param {object} station         normalisiertes Radio-Objekt
 */
export function playRadioStream(container, station) {
    stopActiveStream();

    container.innerHTML = "";
    container.classList.remove("has-switcher");
    container.classList.add("stream-container");

    const meta = station.metadata ?? {};
    if (!meta.streamUrl) {
        renderFallback(container, {}, "Für diesen Sender ist kein Stream hinterlegt.");
        return;
    }

    const stage = document.createElement("div");
    stage.className = "radio-player";
    container.appendChild(stage);

    if (meta.favicon) {
        const art = document.createElement("img");
        art.className = "radio-art";
        art.src = meta.favicon;
        art.alt = "";
        art.referrerPolicy = "no-referrer";
        art.onerror = () => art.remove();
        stage.appendChild(art);
    } else {
        const placeholder = document.createElement("div");
        placeholder.className = "radio-art radio-art-placeholder";
        placeholder.textContent = "📻";
        stage.appendChild(placeholder);
    }

    const audio = document.createElement("audio");
    audio.className = "radio-audio";
    audio.controls = true;
    audio.autoplay = true;
    audio.src = meta.streamUrl;

    let stopped = false;
    audio.addEventListener("error", () => {
        if (stopped) return;
        renderFallback(stage, { pageUrl: meta.homepage || meta.streamUrl },
            "Stream aktuell nicht erreichbar.");
    });

    stage.appendChild(audio);

    const badge = document.createElement("span");
    badge.className = "stream-live-badge";
    badge.textContent = "● LIVE";
    stage.appendChild(badge);

    addOverlayLinks(stage, { pageUrl: meta.homepage });

    // Höflichkeitsklick beim Radio-Browser-Betreiber registrieren
    // (zählt zur Popularität des Senders) – Ergebnis wird nicht ausgewertet.
    if (meta.stationuuid) {
        const base = window.WORLD_VIEWER_CONFIG?.radio?.apiUrl
            || "https://all.api.radio-browser.info/json/stations/search";
        const clickBase = base.replace(/\/stations\/search$/, "/url");
        fetch(`${clickBase}/${meta.stationuuid}`, { mode: "cors" }).catch(() => {});
    }

    active.cleanup = () => {
        stopped = true;
        audio.pause();
        audio.src = "";
    };
}

/* ═══════════ Hinweise und Bedienelemente ═══════════ */

function renderFallback(stage, stream, message) {
    const page = stream.pageUrl || stream.url || "";
    stage.innerHTML = `
        <div class="stream-fallback">
            <div class="stream-fallback-icon">📡</div>
            <p>${message}</p>
            ${page ? `<a class="tool-btn stream-open" href="${page}" target="_blank"
                        rel="noopener">Auf der Originalseite öffnen ↗</a>` : ""}
        </div>`;
}

/** Link zur Originalseite und Vollbild-Knopf über das Bild legen. */
function addOverlayLinks(stage, stream, currentSrc) {
    const bar = document.createElement("div");
    bar.className = "stream-actions";

    if (stream.pageUrl) {
        const a = document.createElement("a");
        a.href = stream.pageUrl;
        a.target = "_blank";
        a.rel = "noopener";
        a.title = "Originalseite der Kamera öffnen";
        a.textContent = "↗";
        bar.appendChild(a);
    }

    const full = document.createElement("button");
    full.title = "Vollbild";
    full.textContent = "⛶";
    full.addEventListener("click", () => {
        const target = stage.querySelector("video, iframe, img") ?? stage;
        if (document.fullscreenElement) document.exitFullscreen();
        else (target.requestFullscreen?.() ?? Promise.resolve()).catch(() => {});
    });
    bar.appendChild(full);

    stage.appendChild(bar);
}
