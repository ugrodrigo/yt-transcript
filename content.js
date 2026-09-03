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
  let cleanupCurrentUi = null;

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
    return document.querySelector("ytd-watch-metadata #top-row #actions")
      || document.querySelector("ytd-watch-metadata #top-row")
      || document.querySelector("#above-the-fold #top-row");
  }

  function createUi(host) {
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { display: inline-flex; align-items: center; position: relative; margin-left: 8px; font-family: Roboto, Arial, sans-serif; }
        * { box-sizing: border-box; }
        button, select, input { font: inherit; }
        .trigger {
          min-height: 36px; border: 0; border-radius: 18px; padding: 0 16px; cursor: pointer;
          color: #fff; background: #065fd4;
          font-size: 14px; font-weight: 500; white-space: nowrap;
        }
        .trigger:hover { background: #0556bf; }
        .panel {
          display: none; position: absolute; z-index: 2200; top: 44px; right: 0; width: 310px; padding: 16px;
          border: 1px solid var(--yt-spec-10-percent-layer, rgba(0,0,0,.1)); border-radius: 12px;
          color: var(--yt-spec-text-primary, #0f0f0f); background: var(--yt-spec-menu-background, #fff);
          box-shadow: 0 6px 24px rgba(0,0,0,.22);
        }
        .panel.open { display: block; }
        .heading { margin: 0 0 14px; font-size: 16px; font-weight: 600; }
        label { display: block; margin: 12px 0 6px; color: var(--yt-spec-text-secondary, #606060); font-size: 12px; }
        select {
          width: 100%; height: 36px; padding: 0 9px; border: 1px solid var(--yt-spec-10-percent-layer, #ccc); border-radius: 7px;
          color: inherit; background: var(--yt-spec-general-background-a, #fff);
        }
        .check { display: flex; align-items: center; gap: 8px; margin: 12px 0; color: inherit; font-size: 13px; cursor: pointer; }
        .check input { margin: 0; }
        .copy {
          width: 100%; height: 38px; border: 0; border-radius: 19px; cursor: pointer; color: #fff; background: #065fd4;
          font-size: 14px; font-weight: 600;
        }
        .copy:hover { background: #0556bf; }
        .copy:disabled, select:disabled { cursor: wait; opacity: .6; }
        .status { min-height: 18px; margin: 10px 0 0; color: var(--yt-spec-text-secondary, #606060); font-size: 12px; line-height: 18px; }
        .status.error { color: #c00; }
        @media (prefers-color-scheme: dark) {
          .panel { background: var(--yt-spec-menu-background, #212121); color: var(--yt-spec-text-primary, #f1f1f1); }
          select { background: var(--yt-spec-general-background-a, #212121); }
        }
      </style>
      <button class="trigger" type="button" aria-expanded="false">Copy transcript</button>
      <section class="panel" aria-label="Transcript copier">
        <p class="heading">Copy transcript</p>
        <label for="track">Caption language</label>
        <select id="track" disabled><option>Loading…</option></select>
        <label for="interval">Add a timestamp</label>
        <select id="interval">
          <option value="0">For every caption</option>
          <option value="15">About every 15 seconds</option>
          <option value="30">About every 30 seconds</option>
          <option value="60">About every minute</option>
          <option value="120">About every 2 minutes</option>
          <option value="300">About every 5 minutes</option>
        </select>
        <label class="check"><input id="video-info" type="checkbox" checked> Include video title and link</label>
        <button class="copy" type="button" disabled>Copy to clipboard</button>
        <p class="status" role="status" aria-live="polite"></p>
      </section>
    `;

    const trigger = shadow.querySelector(".trigger");
    const panel = shadow.querySelector(".panel");
    const trackSelect = shadow.querySelector("#track");
    const intervalSelect = shadow.querySelector("#interval");
    const videoInfo = shadow.querySelector("#video-info");
    const copyButton = shadow.querySelector(".copy");
    const status = shadow.querySelector(".status");

    function setStatus(message, isError = false) {
      status.textContent = message;
      status.classList.toggle("error", isError);
    }

    async function loadTracks() {
      trackSelect.disabled = true;
      copyButton.disabled = true;
      trackSelect.innerHTML = "<option>Loading…</option>";
      setStatus("Looking for captions…");

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
        copyButton.disabled = false;
        setStatus(`${tracks.length} caption track${tracks.length === 1 ? "" : "s"} available.`);
      } catch (error) {
        trackSelect.innerHTML = "<option>No captions found</option>";
        setStatus(error.message, true);
      }
    }

    trigger.addEventListener("click", async () => {
      const willOpen = !panel.classList.contains("open");
      panel.classList.toggle("open", willOpen);
      trigger.setAttribute("aria-expanded", String(willOpen));
      if (willOpen && tracks.length === 0) await loadTracks();
    });

    const closeOnOutsideClick = (event) => {
      if (!host.contains(event.target) && panel.classList.contains("open")) {
        panel.classList.remove("open");
        trigger.setAttribute("aria-expanded", "false");
      }
    };
    document.addEventListener("click", closeOnOutsideClick, true);
    cleanupCurrentUi = () => document.removeEventListener("click", closeOnOutsideClick, true);

    trackSelect.addEventListener("change", () => {
      cachedTranscript = null;
      setStatus("");
    });

    intervalSelect.addEventListener("change", () => saveSettings({ intervalSeconds: Number(intervalSelect.value) }));
    videoInfo.addEventListener("change", () => saveSettings({ includeVideoInfo: videoInfo.checked }));

    copyButton.addEventListener("click", async () => {
      copyButton.disabled = true;
      setStatus("Preparing transcript…");
      try {
        if (!cachedTranscript || cachedTranscript.trackId !== trackSelect.value) {
          const result = await requestMainWorld("transcript", { trackId: trackSelect.value });
          cachedTranscript = { trackId: trackSelect.value, cues: result.cues };
        }

        const transcript = YTTranscriptFormatter.formatTranscript(cachedTranscript.cues, {
          intervalSeconds: Number(intervalSelect.value),
          includeVideoInfo: videoInfo.checked,
          title: document.title.replace(/\s*-\s*YouTube\s*$/, ""),
          url: canonicalVideoUrl()
        });
        await copyText(transcript);
        const stats = YTTranscriptFormatter.getStats(transcript);
        setStatus(`Copied ${stats.wordCount.toLocaleString()} words with ${stats.timestampCount} timestamps.`);
      } catch (error) {
        cachedTranscript = null;
        setStatus(error.message, true);
      } finally {
        copyButton.disabled = tracks.length === 0;
      }
    });

    loadSettings().then((settings) => {
      intervalSelect.value = String(settings.intervalSeconds);
      if (!intervalSelect.value) intervalSelect.value = String(DEFAULT_SETTINGS.intervalSeconds);
      videoInfo.checked = settings.includeVideoInfo;
    });
  }

  function mount() {
    const videoId = videoIdFromLocation();
    const existing = document.getElementById(HOST_ID);

    if (!videoId) {
      cleanupCurrentUi?.();
      cleanupCurrentUi = null;
      existing?.remove();
      currentVideoId = null;
      tracks = [];
      cachedTranscript = null;
      cancelPendingRequests();
      return;
    }

    if (videoId !== currentVideoId) {
      cleanupCurrentUi?.();
      cleanupCurrentUi = null;
      existing?.remove();
      currentVideoId = videoId;
      tracks = [];
      cachedTranscript = null;
      cancelPendingRequests();
    }

    if (document.getElementById(HOST_ID)) return;
    const target = targetContainer();
    if (!target) return;

    cleanupCurrentUi?.();
    const host = document.createElement("span");
    host.id = HOST_ID;
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
