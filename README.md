# LightMDReader

LightMDReader is a lightweight browser app for reading, browsing, editing, and exporting Markdown files. It runs as a static web app, so there is no build step, server framework, account, or upload flow. Markdown files stay local in the browser and are never uploaded.

The app itself makes no network requests. Every rendering library is vendored in `vendor/`, so LightMDReader starts and renders with no connection at all. Images a document links from other servers are blocked until you allow the host. See [Remote Images](#remote-images) and [Security Notes](#security-notes).

The app is useful for quickly previewing a single Markdown file, opening a folder of linked Markdown notes, checking local images, making quick edits, and exporting the rendered result to PDF through the browser print dialog.

## Main Features

- Open local `.md`, `.markdown`, and `.txt` files.
- Drag and drop a Markdown file into the reader.
- Open a folder of Markdown files in browsers that support the File System Access API.
- Navigate between Markdown files in the opened folder.
- Refresh the current file or folder after editing files elsewhere.
- Create a new Markdown document in the built-in editor.
- Edit the currently loaded document with a live rendered preview.
- Or edit block by block: only the block the cursor is in shows its Markdown, everything else stays rendered. Choose **Block editing** or **Side-by-side editing** in the top menu; the choice is remembered.
- Undo the last ten block edits with `Ctrl`/`Cmd`+`Z`, and redo with `Ctrl`/`Cmd`+`Shift`+`Z`.
- Save changes back to the original file when the browser grants write access.
- Keep a file's own line endings: a document written with Windows line endings is saved back with them.
- Save the current Markdown as a new file when the browser supports file saving.
- Download the current Markdown text with a timestamped filename.
- Optionally sign in with Google to encrypt Markdown files with a personal key stored in Google Drive App Data.
- Render Markdown with headings, tables, code blocks, task lists, footnotes, definition lists, highlights, subscript, superscript, typographic replacements, and Markdown attributes.
- Add private Markdown comments with custom `((:comment:))` and `((::hidden comment::))` syntax.
- Show the comment syntax literally inside code blocks, so documentation of it renders as written.
- Sanitize rendered HTML with DOMPurify before inserting it into the page.
- Build a table of contents from the rendered document headings.
- Read the open document aloud with a speech voice installed on your own machine. Cloud voices are never offered, so the text never leaves the computer.
- Resolve relative local images and links when using folder mode.
- Block remote images until the host is allowed, so opening a document does not announce it.
- Preview images in a fullscreen viewer with zoom, pan, double-click zoom, touch pinch zoom, and Escape-to-close.
- Work in one of three modes: block editing, read only, or the side-by-side editor.
- Switch between dark, light, and brown themes.
- Switch between six document styles: Signature, Refined, Editorial, Studio, Standard, and Graphite.
- Toggle custom list marker styling.
- Lock the top menu while scrolling.
- Keep the sidebar and its table of contents in view on long documents.
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

Any static file server works. For the hosted app, use an HTTPS static host such as Netlify, GitHub Pages, Cloudflare Pages, or similar.

### Open Directly

Opening `index.html` straight off disk no longer works. `app.js` is an ES module and the Content Security Policy is origin-based, and browsers refuse both over `file://`. Serve the folder instead, as above. Service worker and installable PWA behavior also require a secure context; `localhost` counts as secure.

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

## Document Styles

The style menu changes how a document is rendered. It is independent of the dark, light, and brown colour themes: any style works with any theme, and the choice is remembered in `localStorage`.

| Style | Headings | Character | Good for |
| ----- | -------- | --------- | -------- |
| **Signature** | 5em centred, decorative dots, brown ramp | Maximal, unmistakably this app | Personal notes, title pages |
| **Refined** | Centred, brown ramp, light weight, hairline rule | Signature dialled back to readable sizes | Documents that should look like yours but go to someone else |
| **Editorial** | Serif (Constantia, Palatino), short accent rule, italic h4 | A considered written document | Long-form writing, reports, anything to be read start to finish |
| **Studio** | Tight geometric sans (Corbel, Candara), accent bar beside each h2, mono labels | Modern and sleek | Specs, notes with structure, documentation |
| **Standard** | Familiar sans with rules under h1 and h2 | Deliberately plain | Anything that should look like ordinary Markdown |
| **Graphite** | DIN-like grotesque (Bahnschrift), rule *above* h1, uppercase h2 with a gutter mark | Achromatic and technical | Dense or analytical material, where colour would be noise |

All heading faces are system fonts. Nothing is downloaded, so a style looks the same offline as online, and the app makes no font request. On Windows that means Constantia and Corbel; on macOS, Palatino and Avenir Next; elsewhere the stacks fall back to whatever serif or sans is available.

Every style resolves its colours from theme tokens rather than fixed values, so adding a theme does not require touching the styles. Print colours for all six live in `customMarkdown.print.css`.

Graphite is the exception that proves the rule: it resolves only the neutral tokens and never touches `--md-green` or `--md-blue`, so it stays greyscale under every theme and loses nothing when printed. Hierarchy there comes from weight, letter-spacing, hairlines and vertical space instead of from an accent colour.

## PDF Export

PDF export uses the browser print dialog. The app prepares a print-friendly view by hiding the app chrome, sidebar, editor input, floating buttons, and preview overlay. The rendered Markdown is printed with simple white-page styling.

The paper size selector supports:

- **Browser paper**: leave paper size to the browser or operating system print settings.
- **A4**: request A4 paper through print CSS.
- **Letter**: request Letter paper through print CSS.

Every `h1` and `h2` starts on a new page during PDF export. The first heading in the document is exempt so exports do not start with an empty page.

Browser print dialogs can still override paper size, margins, headers, footers, and scaling. For the cleanest PDF, check those settings before saving.

## Read Aloud

The **Read aloud** button speaks the rendered document. It uses the browser's own speech engine, and it will only ever use a voice that runs on your machine.

That distinction matters. Browsers list two kinds of speech voice:

- **Local voices** are synthesized by your operating system. On Windows these are the Microsoft SAPI voices (David, Zira, Frank, Hanna, and any others you have installed). Nothing is transmitted.
- **Cloud voices** send the text to a server to be synthesized there. Chrome ships these as the "Google ..." voices; Edge calls them "... Online (Natural)". They sound better, and they are a network upload of whatever you are reading.

A page's Content-Security-Policy cannot block a cloud voice, because the upload is made by the browser itself and not by the page. The only reliable defence is not to use one. LightMDReader therefore lists only voices reporting `localService === true`, and refuses to speak when no such voice is selected — it never falls back to the system default voice, which on a stock Chrome install is a cloud voice.

The consequence is that read-aloud sounds like your operating system's built-in voices rather than like a modern neural voice. That is the price of the guarantee.

Notes:

- The voice picker lists the offline voices found on this system. Your choice is remembered in `localStorage`. If the list says "No offline voice", install a speech voice through your operating system's language settings.
- Fenced code blocks are skipped, as are hidden Markdown comments.
- The document is spoken in short pieces, which works around a Chrome bug that truncates long utterances and makes **Stop** take effect immediately.
- Reading stops by itself when you open another document, switch to the editor, or leave the page.

## Local Links And Images

Folder mode can resolve local relative assets:

- Relative image paths such as `./images/example.png` are loaded from the selected folder.
- Relative links to other Markdown files open inside LightMDReader instead of navigating away.
- External `http` and `https` links open in a new tab.

For local assets to resolve correctly, open the folder that contains the Markdown document and its related files.

## Editor, Save, And Download Behavior

The editor is meant for quick local drafting and cleanup. It shows Markdown input beside a live rendered preview on wider screens. The preview follows the cursor by using source-line metadata generated by the Markdown renderer.

The **Save** button overwrites the original file when the app has a writable file handle. It writes immediately; the protection that matters is that nothing else can discard the edit before you make it. See [Unsaved Changes](#unsaved-changes).

The **Save as** button writes the current Markdown to a new file when the browser supports `showSaveFilePicker`.

The **Download** button stays non-destructive. It saves the current Markdown text, including editor changes, as a new timestamped file. In encrypted document mode, it saves an encrypted copy by default.

The **Return to read** button discards unsaved editor changes and restores the previous reading view, after asking for confirmation.

### Unsaved Changes

The **Save** button shows a bullet (`Save •`) whenever the document differs from what is on disk. Any action that would replace the open document (Create, Open, drag and drop, choosing another folder document, Refresh, Return to read) asks first and offers **Save and continue**, **Discard changes**, or **Cancel**. The browser leave-page warning appears only when there really are unsaved changes.

A service worker update never reloads the page while the editor has unsaved work. The update is applied after the next successful save.

### Limits

Inputs beyond these limits are refused with a message, leaving the open document untouched:

| Limit | Value |
| ----- | ----- |
| Markdown file size | 8 MB |
| Files scanned per folder | 5000 |
| Folder nesting depth | 12 |
| Local images loaded per document | 300 |

## Remote Images

A Markdown document can point an image at another server. Fetching it tells that server your IP address, the time, and that you opened that particular document, which is how tracking pixels in email work.

LightMDReader blocks remote images on first sight, the way Gmail and Outlook do. Each one becomes a placeholder naming the host, and a bar above the document offers two choices:

- **Load once** shows them for the document currently open. Opening anything else starts blocked again.
- **Always allow `host`** remembers that host and never asks again, so your own documents load without a click.

Allowed hosts are kept in `localStorage` under `lightmdreader-trusted-hosts`. Clear that key to start asking again.

Only images can be allowed. Other remote references, such as `audio`, `video`, and `poster` attributes, always lose their source, and the sanitizer removes remote `style` and `link` elements outright.

Local relative images in folder mode are never affected. They are read from disk and resolved before anything is attached to the page.

## Optional Encryption

LightMDReader can encrypt Markdown files when Google sign-in is configured. The app still works without signing in; login is only needed when the user chooses the key button or opens an encrypted LightMDReader document.

Encryption is designed to stop casual reading of loose Markdown files, for example files copied to a USB stick, backup folder, or synced drive. It is not intended to turn LightMDReader into a high-security document vault. Anyone with access to the signed-in Google account and the app can unlock the same encrypted files.

The encryption model is:

- Google OAuth confirms the user and gives LightMDReader access to its private Google Drive App Data folder.
- LightMDReader creates one random personal AES-GCM key in the browser.
- That key is stored in Google Drive App Data as `lightmdreader-key-v1.json`.
- Markdown content is encrypted and decrypted locally in the browser.
- The encrypted file contains only encrypted content and metadata, not the secret key.
- When the key is created, LightMDReader downloads `LightMDReader-recovery-key.json` and asks you to confirm that the file actually arrived, because a browser can silently block a download. You can download it again at any time from the account button.
- Encrypted files record a key identifier derived by hashing the key, so no part of the key itself appears in an encrypted document.

Once signed in, the account button opens a menu with **Download recovery key** and **Lock and sign out**. Locking clears the access token, the key material, and any decrypted content from the page.

Importing a recovery key parses it, validates its length, and, when unlocking a specific document, checks that it actually decrypts that document, all before anything is stored. Only then does it ask whether to replace the key held in Google Drive, and the previous key is restored if that upload fails. Importing the wrong file cannot destroy a working key.

If Google Drive App Data ever contains more than one key file, LightMDReader refuses to guess which one is correct and reports the duplicates instead, so that no document is made unreadable.

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
|-- lib/paths.js                # Pure path, fragment, and slug helpers
|-- lib/crypto.js               # Encryption envelope, key identifiers, recovery key validation
|-- MDrender.js                 # markdown-it configuration
|-- styles.css                  # App layout, controls, themes, responsive behavior, print behavior
|-- customMarkdown.css          # Main rendered Markdown styling
|-- customMarkdown.light.css    # Light theme Markdown overrides
|-- customMarkdown.brown.css    # Brown theme Markdown overrides
|-- customMarkdown.standard.css # Compact Standard document style overrides
|-- customMarkdown.studio.css   # Studio document style overrides
|-- customMarkdown.editorial.css # Editorial document style overrides
|-- customMarkdown.refined.css  # Refined document style overrides
|-- customMarkdown.graphite.css # Graphite document style overrides
|-- customMarkdown.print.css    # Print colours for every style and theme (loaded last)
|-- vendor/                     # Vendored runtime libraries plus VERSIONS.json
|-- scripts/vendor.mjs          # Refreshes vendor/ from node_modules (run by hand)
|-- vitest.config.js            # Unit test configuration
|-- tests/unit/                 # Unit tests for the pure helpers in lib/
|-- cheatsheet.md               # Markdown syntax cheatsheet shown in the dialog
|-- sw.js                       # Service worker and app-shell cache
|-- manifest.webmanifest        # PWA manifest
`-- icons/                      # PWA icons
```

## Development

The app is plain static files with no build step. Edit, reload, done. There is no CI, no watcher, and nothing to install before you can work on it.

Node is optional and used for exactly two things.

**Updating a rendering library.** The copies in `vendor/` are what actually ship. `package.json` pins the same versions so that `npm audit` and Dependabot can see them. To take a new version, bump it in `package.json` and then:

```bash
npm install
npm run vendor
```

That rewrites `vendor/` and `vendor/VERSIONS.json` from `node_modules`. `node scripts/vendor.mjs --check` reports drift without writing anything. Commit the result and delete `node_modules` again if you like; the app never reads it.

**Running the unit tests.** `npm test` covers the pure helpers in `lib/` — path resolution and the encryption envelope. Those are the two places where a silent bug costs real data, so they are worth the seconds. Everything else is verified by opening the app.

When changing cached app assets, update `VERSION` in `sw.js` so installed copies pick up the new files.

## Security Notes

LightMDReader renders Markdown locally in the browser. The rendering pipeline treats documents as untrusted, which costs nothing and means a file someone sent you cannot impersonate the app.

- **Sanitization.** Rendered HTML passes through DOMPurify with an allowlist that additionally forbids `style`, `form`, `button`, `input`, `textarea`, `select`, `object`, `embed`, `meta`, `base`, and `link` elements, and the `style` attribute. Task-list checkboxes are the one exception and are forced inert. A document therefore cannot restyle the app, cover it with an overlay, or show a convincing fake sign-in form.
- **Content Security Policy.** `index.html` sets a policy limiting scripts to same-origin plus Google Identity Services, with `object-src 'none'` and `form-action 'none'`. `frame-ancestors` cannot be set from a meta tag; send it as a response header from your host if you need clickjacking protection.
- **No CDN trust.** Every rendering library is vendored, so a compromised CDN cannot reach document text, file handles, access tokens, or the encryption key. The app also starts and renders with no network at all.
- **Inert-first rendering.** Sanitized HTML is built inside an inert template, so local images are resolved and remote ones neutralized before anything is attached to the live page.

- **Read aloud is offline.** The read-aloud voice list is filtered to voices the browser reports as local, so document text is never uploaded to a speech service. See [Read Aloud](#read-aloud).
- **Remote images.** Blocked until you allow the host, so opening a document does not disclose your IP address and the time to a server you did not choose. See [Remote Images](#remote-images). The blocking happens on the inert fragment before it is attached to the page, so a blocked reference never gets the chance to fire. Note that the policy only permits `https:` images in the first place, so an `http://` image will not load even once allowed.

Google Identity Services is fetched on first use of encryption, not on page load.

The renderer is configured with Markdown HTML support, so keeping DOMPurify enabled is essential.
