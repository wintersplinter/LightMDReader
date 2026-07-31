# LightMDReader

LightMDReader is a lightweight browser app for reading, browsing, editing, and exporting Markdown files. It runs as a static web app, so there is no build step, server framework, account, or upload flow. Markdown files stay local in the browser.

The app is useful for quickly previewing a single Markdown file, opening a folder of linked Markdown notes, checking local images, making quick edits, and exporting the rendered result to PDF through the browser print dialog.

## Main Features

- Open local `.md`, `.markdown`, and `.txt` files.
- Drag and drop a Markdown file into the reader.
- Open a folder of Markdown files in browsers that support the File System Access API.
- Navigate between Markdown files in the opened folder.
- Refresh the current file or folder after editing files elsewhere.
- Create a new Markdown document in the built-in editor.
- Edit the currently loaded document with a live rendered preview.
- Save changes back to the original file when the browser grants write access.
- Save the current Markdown as a new file when the browser supports file saving.
- Download the current Markdown text with a timestamped filename.
- Optionally sign in with Google to encrypt Markdown files with a personal key stored in Google Drive App Data.
- Render Markdown with headings, tables, code blocks, task lists, footnotes, definition lists, highlights, subscript, superscript, typographic replacements, and Markdown attributes.
- Add private Markdown comments with custom `((:comment:))` and `((::hidden comment::))` syntax.
- Sanitize rendered HTML with DOMPurify before inserting it into the page.
- Build a table of contents from the rendered document headings.
- Resolve relative local images and links when using folder mode.
- Preview images in a fullscreen viewer with zoom, pan, double-click zoom, touch pinch zoom, and Escape-to-close.
- Switch between dark, light, and brown themes.
- Switch between the distinctive Signature document style and a compact Standard style.
- Toggle custom list marker styling.
- Lock the top menu while scrolling.
- Return to the top of the page with the floating button.
- Export the rendered Markdown to PDF with browser print.
- Choose the PDF paper size: browser default, A4, or Letter.
- Start every `h1` and `h2` on a new PDF page for cleaner exported documents.
- Install as a PWA when the browser supports it.

## Quick Start

### Serve Locally

```bash
python -m http.server 5173
```

Then open:

```text
http://localhost:5173/
```

Any static file server works for development. For the hosted app, use an HTTPS static host such as Netlify, GitHub Pages, Cloudflare Pages, or similar.

### Open Directly

Open `index.html` in a browser.

Direct file opening is useful for quick previews, but service worker behavior and installable PWA behavior require a secure context such as HTTPS. `localhost` also counts as secure for local development.

## Using The App

1. Choose **Open .md** to open one Markdown file, or drag a Markdown file onto the page.
2. Choose **Open folder** to browse all Markdown files in a folder.
3. Use the sidebar table of contents to jump between headings.
4. Use the folder list to switch documents when a folder is open.
5. Choose **Refresh file** or **Refresh folder** after changing files outside the app.
6. Choose **Edit** to edit the loaded Markdown with a live preview.
7. Choose **Save** twice to overwrite the original file when direct saving is available.
8. Choose **Save as** to write the current Markdown to a new file when supported.
9. Choose **Download** to save a timestamped copy without overwriting the original file.
10. Choose the key button to sign in and encrypt the current document.
11. Choose a theme from the theme menu.
12. Choose a document style from the style menu.
13. Choose a PDF paper size.
14. Choose **Export PDF** to open the browser print dialog and save the rendered document as a PDF.

## PDF Export

PDF export uses the browser print dialog. The app prepares a print-friendly view by hiding the app chrome, sidebar, editor input, floating buttons, and preview overlay. The rendered Markdown is printed with simple white-page styling.

The paper size selector supports:

- **Browser paper**: leave paper size to the browser or operating system print settings.
- **A4**: request A4 paper through print CSS.
- **Letter**: request Letter paper through print CSS.

Every `h1` and `h2` starts on a new page during PDF export. The first heading in the document is exempt so exports do not start with an empty page.

Browser print dialogs can still override paper size, margins, headers, footers, and scaling. For the cleanest PDF, check those settings before saving.

## Local Links And Images

Folder mode can resolve local relative assets:

- Relative image paths such as `./images/example.png` are loaded from the selected folder.
- Relative links to other Markdown files open inside LightMDReader instead of navigating away.
- External `http` and `https` links open in a new tab.

For local assets to resolve correctly, open the folder that contains the Markdown document and its related files.

## Editor, Save, And Download Behavior

The editor is meant for quick local drafting and cleanup. It shows Markdown input beside a live rendered preview on wider screens. The preview follows the cursor by using source-line metadata generated by the Markdown renderer.

The **Save** button overwrites the original file only when the app has a writable file handle. To reduce accidental overwrites, the first click changes the button text to **Overwrite original**. The second click performs the save and the browser may ask for permission.

The **Save as** button writes the current Markdown to a new file when the browser supports `showSaveFilePicker`.

The **Download** button stays non-destructive. It saves the current Markdown text, including editor changes, as a new timestamped file. In encrypted document mode, it saves an encrypted copy by default.

The **Return to read** button discards unsaved editor changes and restores the previous reading view.

## Optional Encryption

LightMDReader can encrypt Markdown files when Google sign-in is configured. The app still works without signing in; login is only needed when the user chooses the key button or opens an encrypted LightMDReader document.

Encryption is designed to stop casual reading of loose Markdown files, for example files copied to a USB stick, backup folder, or synced drive. It is not intended to turn LightMDReader into a high-security document vault. Anyone with access to the signed-in Google account and the app can unlock the same encrypted files.

The encryption model is:

- Google OAuth confirms the user and gives LightMDReader access to its private Google Drive App Data folder.
- LightMDReader creates one random personal AES-GCM key in the browser.
- That key is stored in Google Drive App Data as `lightmdreader-key-v1.json`.
- Markdown content is encrypted and decrypted locally in the browser.
- The encrypted file contains only encrypted content and metadata, not the secret key.
- When the key is created, LightMDReader downloads `LightMDReader-recovery-key.json`. Keep this file somewhere safe.

If Google Drive App Data is deleted, encrypted files can only be recovered with the recovery key. If both the Google-stored key and the recovery key are lost, encrypted files cannot be restored.

To enable Google sign-in, create an OAuth 2.0 Client ID for a browser web app in Google Cloud Console and add it to `config.js`:

```js
window.LightMDReaderConfig = {
  googleClientId: "YOUR_CLIENT_ID.apps.googleusercontent.com",
};
```

Add every app origin you use, such as `http://localhost:5173` and the hosted HTTPS origin, to the OAuth client's authorized JavaScript origins.

When a readable document is encrypted, LightMDReader enters encrypted document mode. **Save**, **Save as**, and **Download** then write encrypted content by default. The key button can also download a decrypted copy when the current document is already encrypted.

## Browser Support

LightMDReader is designed for modern browsers.

- Single-file opening works through the standard file input fallback.
- Folder opening uses the File System Access API and is mainly supported in Chromium-based browsers such as Chrome and Edge.
- Direct Save and Save as use the File System Access API and are mainly supported in Chromium-based browsers.
- Encryption uses the browser Web Crypto API and Google OAuth/Drive APIs, so it requires HTTPS or localhost and a configured Google OAuth Client ID.
- PWA installation and service worker caching depend on browser support and a secure context such as HTTPS. `localhost` also works for local development.
- The renderer, renderer plugins, sanitizer, and optional Google sign-in script are loaded from CDNs, so the first load needs network access unless those scripts are already cached by the browser.
- PDF output depends on the browser print engine, so exact pagination can vary slightly between browsers.

## Private Markdown Comments

LightMDReader supports two custom comment syntaxes for local notes and review comments:

```markdown
((:This comment becomes a red dot with a tooltip:))
```

This creates a small red dot in the rendered document. The comment text is hidden until the user hovers over the dot or focuses it with the keyboard.

```markdown
((::This comment is fully hidden::))
```

This removes the comment entirely from the rendered document. It remains visible only in the Markdown source.

Both comment types can span multiple lines:

```markdown
((:
This is a longer review note.
It can use multiple lines.
:))
```

Visible comment dots are hidden during PDF export, so private notes do not appear in exported PDFs.

Comment delimiters are intentionally simple. Visible comments cannot contain `:))`, and fully hidden comments cannot contain `::))`, because those sequences mark the end of the comment.

## Project Structure

```text
.
|-- index.html                  # App shell and toolbar/sidebar markup
|-- config.js                   # Optional Google OAuth Client ID configuration
|-- app.js                      # File handling, folder browsing, rendering workflow, editor, UI behavior
|-- MDrender.js                 # markdown-it setup and plugin loading
|-- styles.css                  # App layout, controls, themes, responsive behavior, print behavior
|-- customMarkdown.css          # Main rendered Markdown styling
|-- customMarkdown.light.css    # Light theme Markdown overrides
|-- customMarkdown.brown.css    # Brown theme Markdown overrides
|-- customMarkdown.standard.css # Compact Standard document style overrides
|-- sw.js                       # Service worker and app-shell cache
|-- manifest.webmanifest        # PWA manifest
|-- icons/                      # PWA icons
|-- serve.py                    # Optional helper server
`-- chatGPTinstructions.md      # Local project notes placeholder
```

## Development

There is no package install or build step. Edit the static files and reload the browser.

When changing cached app assets, update the cache name in `sw.js` so installed or cached copies pick up the new files. The cache name currently follows the GitHub release version and is set to `lightmdreader-v3-3-0`.

The app loads Markdown dependencies from CDNs in `MDrender.js`. If offline-first rendering is required, those scripts should be vendored locally and added to the service worker asset list.

## Security Notes

LightMDReader renders Markdown locally in the browser. User-provided Markdown is passed through DOMPurify before it is inserted into the page.

The renderer is configured with Markdown HTML support, so keeping DOMPurify enabled is important.
