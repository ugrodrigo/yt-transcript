# YouTube Transcript Copier

A small, local-only extension for Brave, Chrome, Edge, and other Chromium browsers. It adds a compact transcript accordion to YouTube's right sidebar and formats captions with occasional timestamps.

The sidebar card keeps YouTube's standard 12-pixel spacing from the suggested-video controls below it.

## Install in Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode** in the top-right corner.
3. Click **Load unpacked**.
4. Select this project folder (`yt-transcript`).
5. Open or refresh a YouTube video that has captions.

After installing an update, click the extension's **Reload** button on the extensions page and refresh every YouTube tab that was already open.

For Chrome, follow the same steps at `chrome://extensions`.

## Use it

1. Open a regular YouTube video.
2. Open **Transcript Copier** in the right sidebar.
3. Choose a caption language and timestamp spacing while previewing the transcript.
4. Click **Copy transcript**.

The default output includes the video title, canonical link, and approximately one timestamp per minute.

The prompt field is saved locally and copied above the video information and transcript. Its default text is `Resuma este vídeo em 5 bullets.` and it can be edited or left empty.

## Privacy

The extension has no server, analytics, or account system. It reads the caption tracks exposed to the YouTube player and formats them locally. Settings are stored in the browser's extension storage.

## Limitations

- The video must have an available caption track.
- YouTube live streams and some restricted videos may not expose captions in a usable form.
- YouTube can change its internal player data format, which may require an extension update.
- The button is currently shown on standard `/watch` pages, not the Shorts player.

## Troubleshooting

- If the blue button is missing, reload the extension at `brave://extensions`, then fully refresh the YouTube tab.
- If YouTube returns empty captions, the extension automatically falls back to YouTube's transcript-panel API and can open/read both current and legacy versions of YouTube's native transcript panel itself.
- If a proof-token caption URL returns an empty response, the extension retries through YouTube's official mobile player before using a visible-page fallback.
- The temporary native YouTube transcript panel is closed after its contents are transferred into the extension's sidebar.
- While that fallback runs, the native panel is rendered off-screen so it does not flash beside the extension.

## Development

There is no build step and no external dependency. After changing a file, click the extension's reload button on `brave://extensions`, then refresh YouTube.

Run the formatter tests with Node.js 18 or newer:

```powershell
node --test tests/formatter.test.js
```
