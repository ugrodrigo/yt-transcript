(() => {
  "use strict";

  const CHANNEL = "yt-transcript-copier";

  if (window.__ytTranscriptCopierMainWorldLoaded) {
    return;
  }
  window.__ytTranscriptCopierMainWorldLoaded = true;

  function textFromRuns(value) {
    if (!value) return "";
    if (typeof value.simpleText === "string") return value.simpleText;
    if (Array.isArray(value.runs)) {
      return value.runs.map((run) => run.text || "").join("");
    }
    return "";
  }

  function getPlayerResponse() {
    const player = document.getElementById("movie_player");
    let response = null;

    try {
      response = player?.getPlayerResponse?.() || null;
    } catch (_) {
      // The initial response below is a useful fallback while the player reloads.
    }

    const currentVideoId = new URL(location.href).searchParams.get("v");
    if (response?.videoDetails?.videoId === currentVideoId) {
      return response;
    }

    if (window.ytInitialPlayerResponse?.videoDetails?.videoId === currentVideoId) {
      return window.ytInitialPlayerResponse;
    }

    return response;
  }

  function getCaptionRenderer() {
    return getPlayerResponse()?.captions?.playerCaptionsTracklistRenderer || null;
  }

  function serializeTracks() {
    const renderer = getCaptionRenderer();
    const tracks = renderer?.captionTracks || [];
    const audioTrack = renderer?.audioTracks?.find((track) => track.captionTrackIndices?.length);
    const defaultIndex = audioTrack?.defaultCaptionTrackIndex ?? audioTrack?.captionTrackIndices?.[0] ?? 0;

    return tracks.map((track, index) => ({
      id: String(index),
      languageCode: track.languageCode || "",
      label: textFromRuns(track.name) || track.languageCode || `Track ${index + 1}`,
      kind: track.kind || "manual",
      isDefault: index === defaultIndex,
      baseUrl: track.baseUrl
    }));
  }

  function transcriptParamsFromData(data) {
    const panels = data?.engagementPanels || [];
    for (const panel of panels) {
      const section = panel?.engagementPanelSectionListRenderer;
      if (section?.panelIdentifier !== "engagement-panel-searchable-transcript") continue;
      const params = section?.content?.continuationItemRenderer?.continuationEndpoint?.getTranscriptEndpoint?.params;
      if (params) return params;
    }

    const stack = [data];
    const seen = new WeakSet();
    let inspected = 0;
    while (stack.length && inspected < 50000) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);
      inspected += 1;

      if (value.getTranscriptEndpoint?.params) return value.getTranscriptEndpoint.params;
      for (const child of Object.values(value)) {
        if (child && typeof child === "object") stack.push(child);
      }
    }
    return null;
  }

  function getYouTubeConfig(name) {
    try {
      return window.ytcfg?.get?.(name) || window.ytcfg?.data_?.[name] || null;
    } catch (_) {
      return null;
    }
  }

  async function postInnertube(endpoint, body) {
    const apiKey = getYouTubeConfig("INNERTUBE_API_KEY");
    const context = getYouTubeConfig("INNERTUBE_CONTEXT");
    if (!apiKey || !context) {
      throw new Error("YouTube's page API configuration is unavailable.");
    }

    const headers = { "Content-Type": "application/json" };
    const clientName = getYouTubeConfig("INNERTUBE_CONTEXT_CLIENT_NAME");
    const clientVersion = getYouTubeConfig("INNERTUBE_CONTEXT_CLIENT_VERSION") || context.client?.clientVersion;
    if (clientName) headers["X-YouTube-Client-Name"] = String(clientName);
    if (clientVersion) headers["X-YouTube-Client-Version"] = clientVersion;
    if (context.client?.visitorData) headers["X-Goog-Visitor-Id"] = context.client.visitorData;

    const response = await fetch(`/youtubei/v1/${endpoint}?key=${encodeURIComponent(apiKey)}&prettyPrint=false`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers,
      body: JSON.stringify({ context, ...body })
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}.`);
    if (!text.trim()) throw new Error(`${endpoint} returned an empty response.`);
    return JSON.parse(text);
  }

  async function fetchTranscriptPanel() {
    const videoId = new URL(location.href).searchParams.get("v");
    const watchData = document.querySelector("ytd-watch-flexy")?.data;
    let params = transcriptParamsFromData(watchData);

    if (!params) {
      const nextData = await postInnertube("next", { videoId });
      params = transcriptParamsFromData(nextData);
    }
    if (!params) throw new Error("YouTube did not expose a transcript-panel request.");

    const transcriptData = await postInnertube("get_transcript", { params });
    const cues = YTTranscriptCaptionParser.parseTranscriptPanel(transcriptData);
    if (!cues.length) throw new Error("YouTube's transcript panel returned no segments.");
    return cues;
  }

  const TRANSCRIPT_SEGMENT_SELECTOR = "ytd-transcript-segment-renderer, transcript-segment-view-model, .ytwTranscriptSegmentViewModelHost";

  function transcriptScope() {
    const nodes = [...document.querySelectorAll(TRANSCRIPT_SEGMENT_SELECTOR)];
    const first = nodes.find(elementIsVisible) || nodes[0];
    return first?.closest("ytd-engagement-panel-section-list-renderer") || document;
  }

  function readOpenTranscriptPanel(scope = transcriptScope()) {
    const nodes = [...scope.querySelectorAll(TRANSCRIPT_SEGMENT_SELECTOR)];
    const cues = nodes.map((node) => {
      const renderer = node.data?.transcriptSegmentRenderer || node.data || {};
      const timestamp = node.querySelector(".segment-timestamp, .ytwTranscriptSegmentViewModelTimestamp, [class*='Timestamp']")?.textContent?.trim() || "";
      const parts = timestamp.split(":").map(Number);
      const fallbackStartMs = parts.every(Number.isFinite)
        ? parts.reduce((total, part) => total * 60 + part, 0) * 1000
        : 0;
      const textElement = node.querySelector(
        ".segment-text, .ytAttributedStringHost[role='text'], .ytAttributedStringHost, [class*='AttributedString'][role='text']"
      );
      const fallbackText = (node.textContent || "").replace(timestamp, "").replace(/\s+/g, " ").trim();
      return {
        startMs: Number(renderer.startMs) || fallbackStartMs,
        durationMs: Math.max(0, Number(renderer.endMs) - Number(renderer.startMs)) || 0,
        text: textFromRuns(renderer.snippet) || textElement?.textContent || fallbackText
      };
    }).map((cue) => ({ ...cue, text: cue.text.replace(/\s+/g, " ").trim() }))
      .filter((cue) => cue.text)
      .sort((a, b) => a.startMs - b.startMs);

    return cues.filter((cue, index) => {
      const previous = cues[index - 1];
      return !previous || previous.startMs !== cue.startMs || previous.text !== cue.text;
    });
  }

  function elementIsVisible(element) {
    if (!element) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function findNativeTranscriptButton() {
    const structuralSelectors = [
      "ytd-video-description-transcript-section-renderer button",
      "ytd-video-description-transcript-section-renderer yt-button-shape button",
      "ytd-transcript-section-header-renderer button"
    ];
    for (const selector of structuralSelectors) {
      const button = [...document.querySelectorAll(selector)].find(elementIsVisible);
      if (button) return button;
    }

    const transcriptWords = /transcript|transcri[cç][aã]o|transcripci[oó]n|transcription|transkript/i;
    return [...document.querySelectorAll("button, [role='button']")].find((button) => {
      if (!elementIsVisible(button)) return false;
      const label = `${button.textContent || ""} ${button.getAttribute("aria-label") || ""} ${button.getAttribute("title") || ""}`;
      return transcriptWords.test(label);
    }) || null;
  }

  function waitForTranscriptSegments(timeoutMs) {
    return new Promise((resolve) => {
      const existing = readOpenTranscriptPanel();
      if (existing.length) {
        resolve(existing);
        return;
      }

      const deadline = Date.now() + timeoutMs;
      const timer = setInterval(() => {
        const cues = readOpenTranscriptPanel();
        if (cues.length || Date.now() >= deadline) {
          clearInterval(timer);
          resolve(cues);
        }
      }, 250);
    });
  }

  function findTranscriptScroller(scope) {
    const firstSegment = scope.querySelector(TRANSCRIPT_SEGMENT_SELECTOR);
    const candidates = [];
    let current = firstSegment?.parentElement;
    while (current && current !== scope.parentElement) {
      candidates.push(current);
      if (current === scope) break;
      current = current.parentElement;
    }
    candidates.push(...scope.querySelectorAll(
      ".ytSectionListRendererContents, yt-section-list-renderer, #segments-container, #content, #contents"
    ));

    return candidates.find((element) => {
      const style = getComputedStyle(element);
      return element.clientHeight > 0
        && element.scrollHeight > element.clientHeight + 20
        && /auto|scroll|overlay/.test(style.overflowY);
    }) || candidates.find((element) => (
      element.clientHeight > 0 && element.scrollHeight > element.clientHeight + 20
    )) || null;
  }

  async function collectAllTranscriptSegments() {
    const scope = transcriptScope();
    const collected = new Map();
    const collectVisible = () => {
      for (const cue of readOpenTranscriptPanel(scope)) {
        collected.set(`${cue.startMs}\u0000${cue.text}`, cue);
      }
    };

    collectVisible();
    const scroller = findTranscriptScroller(scope);
    if (!scroller) return [...collected.values()].sort((a, b) => a.startMs - b.startMs);

    const originalScrollTop = scroller.scrollTop;
    let unchangedRounds = 0;
    let previousTop = -1;
    try {
      for (let attempt = 0; attempt < 160 && unchangedRounds < 4; attempt += 1) {
        collectVisible();
        const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const nextTop = Math.min(maximum, scroller.scrollTop + Math.max(300, scroller.clientHeight * 0.8));
        scroller.scrollTop = nextTop;
        scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 120));

        if (Math.abs(scroller.scrollTop - previousTop) < 1 && scroller.scrollTop >= maximum - 1) unchangedRounds += 1;
        else unchangedRounds = 0;
        previousTop = scroller.scrollTop;
      }
      collectVisible();
    } finally {
      scroller.scrollTop = originalScrollTop;
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }

    return [...collected.values()].sort((a, b) => a.startMs - b.startMs);
  }

  async function openAndReadNativeTranscriptPanel() {
    const existing = readOpenTranscriptPanel();
    if (existing.length) return collectAllTranscriptSegments();

    let transcriptButton = findNativeTranscriptButton();
    if (!transcriptButton) {
      const expandButton = [
        "#description-inline-expander #expand",
        "ytd-text-inline-expander #expand",
        "tp-yt-paper-button#expand"
      ].map((selector) => document.querySelector(selector)).find(elementIsVisible);
      expandButton?.click();
      const deadline = Date.now() + 3000;
      while (!transcriptButton && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        transcriptButton = findNativeTranscriptButton();
      }
    }

    if (!transcriptButton) throw new Error("native transcript button not found");
    transcriptButton.click();
    const cues = await waitForTranscriptSegments(10000);
    if (!cues.length) throw new Error("native transcript panel opened without segments");
    return collectAllTranscriptSegments();
  }

  async function fetchTrack(trackId) {
    const tracks = serializeTracks();
    const track = tracks.find((candidate) => candidate.id === String(trackId));
    if (!track?.baseUrl) {
      throw new Error("That caption track is no longer available. Refresh the video and try again.");
    }

    const failures = [];
    const sourceUrl = new URL(track.baseUrl);
    const proofTokenRequired = sourceUrl.searchParams.get("exp") === "xpe" || sourceUrl.searchParams.get("potc") === "1";
    for (const format of proofTokenRequired ? [] : ["json3", "srv3", "vtt"]) {
      try {
        const captionUrl = new URL(track.baseUrl);
        captionUrl.searchParams.set("fmt", format);
        const response = await fetch(captionUrl.toString(), {
          credentials: "include",
          cache: "no-store"
        });
        if (!response.ok) {
          failures.push(`${format}: HTTP ${response.status}`);
          continue;
        }

        const body = await response.text();
        if (!body.trim()) {
          failures.push(`${format}: empty response`);
          continue;
        }

        const cues = YTTranscriptCaptionParser.parseCaptionPayload(body, format);
        if (cues.length) {
          return { track: { ...track, baseUrl: undefined }, cues };
        }
        failures.push(`${format}: no cues`);
      } catch (error) {
        failures.push(`${format}: ${error instanceof Error ? error.message : "unreadable response"}`);
      }
    }

    try {
      const cues = await fetchTranscriptPanel();
      return { track: { ...track, baseUrl: undefined }, cues };
    } catch (error) {
      failures.push(`transcript panel API: ${error instanceof Error ? error.message : "failed"}`);
    }

    try {
      const cues = await openAndReadNativeTranscriptPanel();
      return { track: { ...track, baseUrl: undefined }, cues };
    } catch (error) {
      failures.push(`page panel: ${error instanceof Error ? error.message : "failed"}`);
    }

    console.warn("YouTube Transcript Copier caption attempts failed:", failures);
    const summary = failures.slice(-2).join("; ");
    throw new Error(`YouTube blocked every transcript method (${summary}).`);
  }

  async function handleRequest(data) {
    if (data.action === "tracks") {
      const tracks = serializeTracks();
      if (!tracks.length) {
        throw new Error("No transcript is available for this video.");
      }
      return { tracks };
    }

    if (data.action === "transcript") {
      return fetchTrack(data.trackId);
    }

    throw new Error("Unknown transcript request.");
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.channel !== CHANNEL || event.data?.direction !== "request") {
      return;
    }

    const { requestId } = event.data;
    try {
      const result = await handleRequest(event.data);
      window.postMessage({
        channel: CHANNEL,
        direction: "response",
        requestId,
        ok: true,
        result
      }, "*");
    } catch (error) {
      window.postMessage({
        channel: CHANNEL,
        direction: "response",
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : "Unable to load the transcript."
      }, "*");
    }
  });
})();
