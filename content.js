(() => {
  "use strict";

  const CHANNEL = "yt-transcript-copier";
  const HOST_ID = "yt-transcript-copier-root";
  const DEFAULT_SETTINGS = { intervalSeconds: 60, includeVideoInfo: true };
  const pendingRequests = new Map();
  let currentVideoId = null;
  let tracks = [];
  let cachedTranscript = null;
  let mountTimer = null;

  function requestMainWorld(action, extra = {}) {
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve, reject) => {
      const timeoutMs = action === "transcript" ? 60000 : 15000;
      const timeout = setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error("YouTube took too long to provide the transcript."));
      }, timeoutMs);

      pendingRequests.set(requestId, { resolve, reject, timeout });
      window.postMessage({ channel: CHANNEL, direction: "request", requestId, action, ...extra }, "*");
    });
  }

  function cancelPendingRequests() {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("The video changed before the transcript finished loading."));
    }
    pendingRequests.clear();
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || data?.channel !== CHANNEL || data?.direction !== "response") return;

    const pending = pendingRequests.get(data.requestId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    pendingRequests.delete(data.requestId);
    if (data.ok) pending.resolve(data.result);
    else pending.reject(new Error(data.error || "Unable to load the transcript."));
  });

  async function loadSettings() {
    return chrome.storage.local.get(DEFAULT_SETTINGS);
  }

  async function saveSettings(settings) {
    await chrome.storage.local.set(settings);
  }

  function videoIdFromLocation() {
    return location.pathname === "/watch" ? new URL(location.href).searchParams.get("v") : null;
  }

  function canonicalVideoUrl() {
    const id = videoIdFromLocation();
    return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : location.href;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) throw new Error("The browser blocked clipboard access.");
    }
  }

  function targetContainer() {
    return document.querySelector("#secondary-inner")
      || document.querySelector("ytd-watch-flexy #secondary");
  }

  function pageUsesDarkTheme() {
    if (document.documentElement.hasAttribute("dark") || document.querySelector("ytd-app")?.hasAttribute("dark")) {
      return true;
    }
    const background = getComputedStyle(document.documentElement)
      .getPropertyValue("--yt-spec-base-background")
      .match(/\d+/g)
      ?.slice(0, 3)
      .map(Number);
    if (background?.length === 3) {
      return (background[0] * 299 + background[1] * 587 + background[2] * 114) / 1000 < 128;
    }
    return matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function createUi(host) {
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host {
          --tc-bg: #fff; --tc-surface: #f8f8f8; --tc-text: #0f0f0f; --tc-muted: #606060;
          --tc-border: #d9d9d9; --tc-hover: #f2f2f2; --tc-error: #c00;
          display: block; width: 100%; margin: 0 0 12px; font-family: Roboto, Arial, sans-serif; color-scheme: light;
        }
        :host([data-theme="dark"]) {
          --tc-bg: #212121; --tc-surface: #181818; --tc-text: #f1f1f1; --tc-muted: #aaa;
          --tc-border: #3f3f3f; --tc-hover: #303030; --tc-error: #ff6b6b; color-scheme: dark;
        }
        * { box-sizing: border-box; }
        button, select, input { font: inherit; }
        .card {
          overflow: hidden; width: 100%; border: 1px solid var(--tc-border);
          border-radius: 12px; color: var(--tc-text); background: var(--tc-bg);
        }
        .header {
          display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 48px;
          border: 0; padding: 0 14px; cursor: pointer; color: inherit; background: transparent;
          font-size: 14px; font-weight: 600; text-align: left;
        }
        .header:hover { background: var(--tc-hover); }
        .header-title { display: inline-flex; align-items: center; gap: 9px; }
        .icon { width: 20px; height: 20px; color: #065fd4; }
        .chevron { width: 18px; height: 18px; transition: transform 160ms ease; }
        .card.open .chevron { transform: rotate(180deg); }
        .body { display: none; padding: 0 12px 12px; border-top: 1px solid var(--tc-border); }
        .card.open .body { display: block; }
        .controls { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; margin: 10px 0; }
        label { display: block; min-width: 0; color: var(--tc-muted); font-size: 11px; line-height: 16px; }
        select {
          display: block; width: 100%; height: 32px; margin-top: 3px; padding: 0 7px;
          border: 1px solid var(--tc-border); border-radius: 7px;
          color: var(--tc-text); background: var(--tc-surface);
          font-size: 11px;
        }
        .transcript {
          min-height: 150px; max-height: 390px; overflow-y: auto; padding: 10px;
          border: 1px solid var(--tc-border); border-radius: 8px;
          color: var(--tc-text); background: var(--tc-surface);
          font-size: 13px; font-weight: 400; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere;
          scrollbar-width: thin;
        }
        .transcript.placeholder { color: var(--tc-muted); }
        .actions { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 0 6px; }
        .check { display: flex; align-items: center; gap: 6px; margin: 0; color: inherit; font-size: 11px; cursor: pointer; }
        .check input { margin: 0; }
        .copy {
          flex: 0 0 auto; height: 32px; border: 0; border-radius: 16px; padding: 0 14px;
          cursor: pointer; color: #fff; background: #065fd4; font-size: 12px; font-weight: 600;
        }
        .copy:hover { background: #0556bf; }
        .copy:disabled, select:disabled { cursor: wait; opacity: .6; }
        .status { min-height: 16px; margin: 0 0 8px; color: var(--tc-muted); font-size: 11px; line-height: 16px; }
        .status.error { color: var(--tc-error); }
      </style>
      <section class="card" aria-label="Transcript copier">
        <button class="header" type="button" aria-expanded="false" aria-controls="transcript-body">
          <span class="header-title">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6 2h9l5 5v15H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 2H6v16h12V8h-4V4Zm-5 8h6v2H9v-2Zm0 4h6v2H9v-2Z"/></svg>
            <span>Transcript Copier</span>
          </span>
          <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m7.4 8.6 4.6 4.6 4.6-4.6L18 10l-6 6-6-6 1.4-1.4Z"/></svg>
        </button>
        <div class="body" id="transcript-body">
          <div class="controls">
            <label for="track">Language
              <select id="track" disabled><option>Loading...</option></select>
            </label>
            <label for="interval">Timestamps
              <select id="interval">
                <option value="0">Every caption</option>
                <option value="15">Every 15 seconds</option>
                <option value="30">Every 30 seconds</option>
                <option value="60">Every minute</option>
                <option value="120">Every 2 minutes</option>
                <option value="300">Every 5 minutes</option>
              </select>
            </label>
          </div>
          <div class="actions">
            <label class="check"><input id="video-info" type="checkbox" checked> Include title and link</label>
            <button class="copy" type="button" disabled>Copy transcript</button>
          </div>
          <p class="status" role="status" aria-live="polite"></p>
          <div class="transcript placeholder" role="region" aria-label="Transcript preview">Open to load the transcript.</div>
        </div>
      </section>
    `;

    const card = shadow.querySelector(".card");
    const header = shadow.querySelector(".header");
    const trackSelect = shadow.querySelector("#track");
    const intervalSelect = shadow.querySelector("#interval");
    const videoInfo = shadow.querySelector("#video-info");
    const copyButton = shadow.querySelector(".copy");
    const status = shadow.querySelector(".status");
    const transcriptPreview = shadow.querySelector(".transcript");
    let formattedTranscript = "";
    let loadingTranscript = null;

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle("error", isError);
    }

    function renderTranscript() {
      if (!cachedTranscript?.cues?.length) return "";
      formattedTranscript = YTTranscriptFormatter.formatTranscript(cachedTranscript.cues, {
        intervalSeconds: Number(intervalSelect.value),
        includeVideoInfo: videoInfo.checked,
        title: document.title.replace(/\s*-\s*YouTube\s*$/, ""),
        url: canonicalVideoUrl()
      });
      transcriptPreview.textContent = formattedTranscript;
      transcriptPreview.classList.remove("placeholder");
      return formattedTranscript;
    }

    async function loadTracks() {
      trackSelect.disabled = true;
      copyButton.disabled = true;
      trackSelect.innerHTML = "<option>Loading...</option>";
      setStatus("Looking for captions...");

      try {
        const result = await requestMainWorld("tracks");
        tracks = result.tracks;
        trackSelect.textContent = "";
        for (const track of tracks) {
          const option = document.createElement("option");
          option.value = track.id;
          const alreadySaysAutomatic = /auto|gerad|autom[aá]t|generad/i.test(track.label);
          option.textContent = `${track.label}${track.kind === "asr" && !alreadySaysAutomatic ? " (auto-generated)" : ""}`;
          option.selected = track.isDefault;
          trackSelect.appendChild(option);
        }
        trackSelect.disabled = false;
        setStatus(`${tracks.length} caption track${tracks.length === 1 ? "" : "s"} available.`);
        return true;
      } catch (error) {
        trackSelect.innerHTML = "<option>No captions found</option>";
        transcriptPreview.textContent = error.message;
        setStatus(error.message, true);
        return false;
      }
    }

    async function loadSelectedTranscript() {
      if (!trackSelect.value || trackSelect.disabled) return;
      if (cachedTranscript?.trackId === trackSelect.value) {
        renderTranscript();
        copyButton.disabled = false;
        return;
      }
      if (loadingTranscript) return loadingTranscript;

      const requestedTrackId = trackSelect.value;
      copyButton.disabled = true;
      trackSelect.disabled = true;
      transcriptPreview.textContent = "Loading transcript...";
      transcriptPreview.classList.add("placeholder");
      setStatus("YouTube may briefly open its transcript panel.");

      loadingTranscript = requestMainWorld("transcript", { trackId: requestedTrackId })
        .then((result) => {
          cachedTranscript = { trackId: requestedTrackId, cues: result.cues };
          renderTranscript();
          copyButton.disabled = false;
          const stats = YTTranscriptFormatter.getStats(formattedTranscript);
          setStatus(`${stats.wordCount.toLocaleString()} words · ${stats.timestampCount} timestamps`);
        })
        .catch((error) => {
          cachedTranscript = null;
          formattedTranscript = "";
          transcriptPreview.textContent = error.message;
          transcriptPreview.classList.add("placeholder");
          setStatus(error.message, true);
        })
        .finally(() => {
          trackSelect.disabled = tracks.length === 0;
          loadingTranscript = null;
        });
      return loadingTranscript;
    }

    header.addEventListener("click", async () => {
      const willOpen = !card.classList.contains("open");
      card.classList.toggle("open", willOpen);
      header.setAttribute("aria-expanded", String(willOpen));
      if (!willOpen) return;
      if (tracks.length === 0 && !(await loadTracks())) return;
      await loadSelectedTranscript();
    });

    trackSelect.addEventListener("change", async () => {
      cachedTranscript = null;
      formattedTranscript = "";
      await loadSelectedTranscript();
    });

    intervalSelect.addEventListener("change", () => {
      saveSettings({ intervalSeconds: Number(intervalSelect.value) });
      renderTranscript();
    });
    videoInfo.addEventListener("change", () => {
      saveSettings({ includeVideoInfo: videoInfo.checked });
      renderTranscript();
    });

    copyButton.addEventListener("click", async () => {
      copyButton.disabled = true;
      try {
        if (!formattedTranscript) await loadSelectedTranscript();
        if (!formattedTranscript) return;
        await copyText(formattedTranscript);
        const stats = YTTranscriptFormatter.getStats(formattedTranscript);
        setStatus(`Copied ${stats.wordCount.toLocaleString()} words with ${stats.timestampCount} timestamps.`);
      } catch (error) {
        setStatus(error.message, true);
      } finally {
        copyButton.disabled = !formattedTranscript;
      }
    });

    loadSettings().then((settings) => {
      intervalSelect.value = String(settings.intervalSeconds);
      if (!intervalSelect.value) intervalSelect.value = String(DEFAULT_SETTINGS.intervalSeconds);
      videoInfo.checked = settings.includeVideoInfo;
      renderTranscript();
    });
  }

  function mount() {
    const videoId = videoIdFromLocation();
    const existing = document.getElementById(HOST_ID);

    if (!videoId) {
      existing?.remove();
      currentVideoId = null;
      tracks = [];
      cachedTranscript = null;
      cancelPendingRequests();
      return;
    }

    if (videoId !== currentVideoId) {
      existing?.remove();
      currentVideoId = videoId;
      tracks = [];
      cachedTranscript = null;
      cancelPendingRequests();
    }

    const mounted = document.getElementById(HOST_ID);
    if (mounted) {
      mounted.dataset.theme = pageUsesDarkTheme() ? "dark" : "light";
      return;
    }
    const target = targetContainer();
    if (!target) return;

    const host = document.createElement("div");
    host.id = HOST_ID;
    host.dataset.theme = pageUsesDarkTheme() ? "dark" : "light";
    target.prepend(host);
    createUi(host);
  }

  function scheduleMount() {
    clearTimeout(mountTimer);
    mountTimer = setTimeout(mount, 250);
  }

  document.addEventListener("yt-navigate-finish", scheduleMount);
  setInterval(mount, 2000);
  mount();
})();
