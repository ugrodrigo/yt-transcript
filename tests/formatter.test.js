const assert = require("node:assert/strict");
const test = require("node:test");
const { formatTimestamp, formatTranscript, getStats } = require("../formatter.js");
const { parseCaptionPayload, parseTranscriptPanel } = require("../caption-parser.js");

test("formats timestamps below and above one hour", () => {
  assert.equal(formatTimestamp(0), "00:00");
  assert.equal(formatTimestamp(65_999), "01:05");
  assert.equal(formatTimestamp(3_661_000), "1:01:01");
});

test("parses JSON3 and WebVTT caption fallbacks", () => {
  const json = parseCaptionPayload('{"events":[{"tStartMs":1200,"dDurationMs":800,"segs":[{"utf8":"Hello JSON"}]}]}', "json3");
  assert.deepEqual(json, [{ startMs: 1200, durationMs: 800, text: "Hello JSON" }]);

  const vtt = parseCaptionPayload("WEBVTT\n\n00:00:03.000 --> 00:00:04.500\nHello VTT", "vtt");
  assert.deepEqual(vtt, [{ startMs: 3000, durationMs: 1500, text: "Hello VTT" }]);
});

test("parses YouTube transcript-panel segments", () => {
  const cues = parseTranscriptPanel({ actions: [{ initialSegments: [{
    transcriptSegmentRenderer: {
      startMs: "4000",
      endMs: "5500",
      snippet: { runs: [{ text: "Hello panel" }] },
      startTimeText: { simpleText: "0:04" }
    }
  }] }] });
  assert.deepEqual(cues, [{ startMs: 4000, durationMs: 1500, text: "Hello panel" }]);
});

test("groups cues at the requested timestamp interval", () => {
  const text = formatTranscript([
    { startMs: 0, text: "Hello" },
    { startMs: 10_000, text: "world." },
    { startMs: 61_000, text: "Next minute." }
  ], { intervalSeconds: 60, includeVideoInfo: false });

  assert.equal(text, "[00:00] Hello world.\n\n[01:01] Next minute.");
});

test("supports timestamps on every caption and video information", () => {
  const text = formatTranscript([
    { startMs: 5000, text: "First cue." },
    { startMs: 9000, text: "Second cue." }
  ], {
    intervalSeconds: 0,
    includeVideoInfo: true,
    title: "Example",
    url: "https://www.youtube.com/watch?v=abc"
  });

  assert.equal(text, "Example\nhttps://www.youtube.com/watch?v=abc\n\n[00:05] First cue.\n[00:09] Second cue.");
  assert.deepEqual(getStats(text), { timestampCount: 2, wordCount: 4 });
});
