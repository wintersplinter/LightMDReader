# LightMDReader

LightMDReader is a small browser-based Markdown reader for opening local Markdown files, browsing Markdown folders, previewing the rendered document, and exporting the result through the browser print dialog.

It is built as a static web app with no build step. Open `index.html` directly for simple file previews, or serve the folder locally for the most reliable browser and PWA behavior.

## Features

- Open local `.md`, `.markdown`, and `.txt` files.
- Drag and drop a Markdown file into the reader.
- Open a whole folder of Markdown files in Chromium-based browsers.
- Navigate between Markdown files in an opened folder.
- Refresh the current file or folder after editing it elsewhere.
- Render Markdown with `markdown-it` plus footnotes, definition lists, subscript, superscript, mark/highlight, attributes, and task lists.
- Sanitize rendered HTML with DOMPurify before displaying it.
- Build a table of contents from document headings.
- Resolve local images and local Markdown links when using folder mode.
- Preview images in a fullscreen viewer with zoom, pan, double-click zoom, touch pinch zoom, and Escape-to-close.
- Switch between dark, light, and brown themes.
- Toggle custom list marker styling.
- Lock the top menu while scrolling.
- Return to the top of the page with the floating button.
- Export to PDF through the browser print dialog.
- Install as a PWA when the browser supports it.

## Quick Start

### Option 1: serve the folder locally

```bash
python -m http.server 5173
```

Then open:

```text
http://localhost:5173/
```

Any static file server will work. Serving from `localhost` is the best option when testing PWA behavior, service worker caching, and browser file APIs.

### Option 2: open the app directly

Open `index.html` in a browser.

Direct file opening is useful for quick previews, but some browser features work best when the app is served from `localhost`.

## Browser Support

LightMDReader is designed for modern browsers.

- Single-file opening works through the standard file input fallback.
- Folder opening uses the File System Access API and is mainly supported in Chromium-based browsers such as Chrome and Edge.
- PWA installation and service worker caching depend on browser support and the app being served from a supported origin such as `localhost`.
- The renderer and sanitizer are loaded from jsDelivr, so the first load needs network access unless those scripts are already cached by the browser.

## Using The App

1. Choose **Open .md** to open one Markdown file, or drag a Markdown file onto the page.
2. Choose **Open folder** to browse all Markdown files in a folder.
3. Use the sidebar to jump through headings or switch files in folder mode.
4. Use **Refresh file** or **Refresh folder** after changing files outside the reader.
5. Choose a theme from the theme menu.
6. Choose **Export PDF** to open the browser print dialog and save the rendered document as a PDF.

## Local Links And Images

Folder mode can resolve local relative assets:

- Relative image paths such as `./images/example.png` are loaded from the selected folder.
- Relative links to other Markdown files open inside LightMDReader instead of navigating away.
- External `http` and `https` links open in a new tab.

For local assets to resolve correctly, open the folder that contains the Markdown document and its related files.

## Project Structure

```text
.
|-- index.html                  # App shell
|-- app.js                      # File/folder handling, rendering workflow, UI behavior
|-- MDrender.js                 # Markdown renderer setup and markdown-it plugin loading
|-- styles.css                  # App layout, controls, themes, print behavior
|-- customMarkdown.css          # Main rendered Markdown styling
|-- customMarkdown.light.css    # Light theme Markdown overrides
|-- customMarkdown.brown.css    # Brown theme Markdown overrides
|-- sw.js                       # Service worker and app-shell cache
|-- manifest.webmanifest        # PWA manifest
`-- icons/                      # PWA icons
```

## Development

There is no package install or build step. Edit the static files and reload the browser.

When changing cached app assets, update the cache name in `sw.js` so installed or cached copies pick up the new files.

## Security Notes

LightMDReader renders Markdown locally in the browser. User-provided Markdown is passed through DOMPurify before it is inserted into the page.

The renderer is configured with Markdown HTML support, so keeping DOMPurify enabled is important.
