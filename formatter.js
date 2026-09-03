(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.YTTranscriptFormatter = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  function formatTimestamp(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);

    if (hours > 0) {
      return [hours, minutes, seconds].map((part, index) => index === 0 ? String(part) : String(part).padStart(2, "0")).join(":");
    }
    return `${String(totalMinutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function joinCueText(current, next) {
    if (!current) return next;
    if (!next) return current;

    // Auto-captions occasionally repeat a complete adjacent cue.
    if (current === next || current.endsWith(` ${next}`)) return current;
    return `${current} ${next}`.replace(/\s+/g, " ").trim();
  }

  function formatTranscript(cues, options = {}) {
    const intervalSeconds = Number(options.intervalSeconds ?? 60);
    const includeVideoInfo = options.includeVideoInfo !== false;
    const intervalMs = intervalSeconds * 1000;
    const lines = [];

    if (includeVideoInfo) {
      if (options.title) lines.push(options.title.trim());
      if (options.url) lines.push(options.url.trim());
      if (lines.length) lines.push("");
    }

    if (!Array.isArray(cues) || cues.length === 0) {
      return lines.join("\n").trim();
    }

    if (intervalSeconds === 0) {
      for (const cue of cues) {
        lines.push(`[${formatTimestamp(cue.startMs)}] ${cue.text}`);
      }
      return lines.join("\n").trim();
    }

    let blockStart = cues[0].startMs;
    let blockText = "";

    for (const cue of cues) {
      if (blockText && cue.startMs - blockStart >= intervalMs) {
        lines.push(`[${formatTimestamp(blockStart)}] ${blockText}`);
        blockStart = cue.startMs;
        blockText = "";
      }
      blockText = joinCueText(blockText, cue.text);
    }

    if (blockText) {
      lines.push(`[${formatTimestamp(blockStart)}] ${blockText}`);
    }

    return lines.join("\n\n").trim();
  }

  function getStats(text) {
    const timestampCount = (text.match(/^\[\d+(?::\d{2}){1,2}\]/gm) || []).length;
    const lines = text.split("\n");
    const firstTimestamp = lines.findIndex((line) => /^\[\d+(?::\d{2}){1,2}\]/.test(line));
    const body = (firstTimestamp >= 0 ? lines.slice(firstTimestamp) : lines)
      .join(" ")
      .replace(/\[\d+(?::\d{2}){1,2}\]/g, "");
    const wordCount = (body.match(/\S+/g) || []).length;
    return { timestampCount, wordCount };
  }

  return { formatTimestamp, formatTranscript, getStats };
});
