# YouTube Transcript Copier

A small, local-only extension for Brave, Chrome, Edge, and other Chromium browsers. It adds a **Copy transcript** button to YouTube video pages and formats captions with occasional timestamps.

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
2. Click **Copy transcript** alongside YouTube's video action buttons.
3. Choose a caption language and timestamp spacing.
4. Click **Copy to clipboard**.

The default output includes the video title, canonical link, and approximately one timestamp per minute.

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

## Development

There is no build step and no external dependency. After changing a file, click the extension's reload button on `brave://extensions`, then refresh YouTube.

Run the formatter tests with Node.js 18 or newer:

```powershell
node --test tests/formatter.test.js
```
