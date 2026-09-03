(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.YTTranscriptCaptionParser = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  function normalizeText(value) {
    return String(value || "")
      .replace(/<[^>]*>/g, "")
      .replace(/\{\\an\d+\}/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function finish(cues) {
    return cues
      .map((cue) => ({
        startMs: Math.max(0, Number(cue.startMs) || 0),
        durationMs: Math.max(0, Number(cue.durationMs) || 0),
        text: normalizeText(cue.text)
      }))
      .filter((cue) => cue.text && cue.text !== "[Music]")
      .sort((a, b) => a.startMs - b.startMs);
  }

  function parseJson3(text) {
    const cleaned = text.replace(/^\uFEFF/, "").replace(/^\)\]\}'\s*/, "");
    const payload = JSON.parse(cleaned);
    return finish((payload.events || [])
      .filter((event) => Array.isArray(event.segs))
      .map((event) => ({
        startMs: event.tStartMs,
        durationMs: event.dDurationMs,
        text: event.segs.map((segment) => segment.utf8 || "").join("")
      })));
  }

  function parseXml(text) {
    if (typeof DOMParser === "undefined") {
      throw new Error("XML parsing is unavailable.");
    }

    const document = new DOMParser().parseFromString(text, "text/xml");
    if (document.querySelector("parsererror")) {
      throw new Error("Invalid XML captions.");
    }

    const paragraphs = [...document.querySelectorAll("p")];
    if (paragraphs.length) {
      return finish(paragraphs.map((node) => ({
        startMs: node.getAttribute("t"),
        durationMs: node.getAttribute("d"),
        text: node.textContent
      })));
    }

    return finish([...document.querySelectorAll("text")].map((node) => ({
      startMs: Number(node.getAttribute("start")) * 1000,
      durationMs: Number(node.getAttribute("dur")) * 1000,
      text: node.textContent
    })));
  }

  function timeToMilliseconds(value) {
    const parts = value.replace(",", ".").split(":").map(Number);
    if (parts.some(Number.isNaN)) return 0;
    if (parts.length === 3) return Math.round(((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000);
    return Math.round((parts[0] * 60 + parts[1]) * 1000);
  }

  function parseVtt(text) {
    const cues = [];
    const blocks = text.replace(/^\uFEFF/, "").replace(/\r/g, "").split(/\n{2,}/);

    for (const block of blocks) {
      const lines = block.split("\n").filter(Boolean);
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) continue;

      const timing = lines[timingIndex].match(/((?:\d+:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d+:)?\d{2}:\d{2}[.,]\d{3})/);
      if (!timing) continue;
      const startMs = timeToMilliseconds(timing[1]);
      const endMs = timeToMilliseconds(timing[2]);
      cues.push({
        startMs,
        durationMs: Math.max(0, endMs - startMs),
        text: lines.slice(timingIndex + 1).join(" ")
      });
    }

    return finish(cues);
  }

  function timestampTextToMilliseconds(value) {
    const parts = String(value || "").trim().split(":").map(Number);
    if (!parts.length || parts.some(Number.isNaN)) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
  }

  function textFromRuns(value) {
    if (!value) return "";
    if (typeof value.simpleText === "string") return value.simpleText;
    if (Array.isArray(value.runs)) return value.runs.map((run) => run.text || "").join("");
    return "";
  }

  function parseTranscriptPanel(payload) {
    const renderers = [];
    const stack = [payload];
    const seen = new WeakSet();

    while (stack.length) {
      const value = stack.pop();
      if (!value || typeof value !== "object" || seen.has(value)) continue;
      seen.add(value);

      if (value.transcriptSegmentRenderer) {
        renderers.push(value.transcriptSegmentRenderer);
        continue;
      }

      for (const child of Object.values(value)) {
        if (child && typeof child === "object") stack.push(child);
      }
    }

    const cues = finish(renderers.map((renderer) => {
      const startMs = Number(renderer.startMs) || timestampTextToMilliseconds(textFromRuns(renderer.startTimeText));
      const endMs = Number(renderer.endMs) || startMs;
      return {
        startMs,
        durationMs: Math.max(0, endMs - startMs),
        text: textFromRuns(renderer.snippet)
      };
    }));

    for (let index = 0; index < cues.length - 1; index += 1) {
      if (!cues[index].durationMs) {
        cues[index].durationMs = Math.max(0, cues[index + 1].startMs - cues[index].startMs);
      }
    }
    return cues;
  }

  function parseCaptionPayload(text, format) {
    if (!text?.trim()) return [];
    if (format === "json3") return parseJson3(text);
    if (format === "srv3" || /^\s*</.test(text)) return parseXml(text);
    if (format === "vtt" || /^\s*WEBVTT/.test(text)) return parseVtt(text);
    return [];
  }

  return { parseCaptionPayload, parseJson3, parseXml, parseVtt, parseTranscriptPanel };
});
