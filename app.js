/* global DOMPurify */

import {
  dirname,
  isRemoteResourceUrl,
  normalizePath,
  resolveRelativePath,
  safeDecodeURIComponent,
  slugifyHeading,
  splitLocalHref,
} from "./lib/paths.js";

import { createBlockModel } from "./lib/blockModel.js";
import { createBlockRenderer } from "./lib/blockRender.js";

import {
  base64ToBytes,
  buildRecoveryKeyFile,
  bytesToBase64,
  createKeyId,
  createLegacyKeyId,
  decryptPayloadWithKey,
  encryptMarkdown,
  encryptedDocumentFormat,
  importMasterKey,
  keyIdDomainLabel,
  masterKeyByteLength,
  parseEncryptedDocument,
  parseRecoveryKeyFile,
  recoveryKeyFormat,
} from "./lib/crypto.js";

const fileInput = document.getElementById("fileInput");
const recoveryKeyInput = document.getElementById("recoveryKeyInput");
const openFileBtn = document.getElementById("openFileBtn");
const folderBtn = document.getElementById("folderBtn");
const createBtn = document.getElementById("createBtn");
const cheatsheetBtn = document.getElementById("cheatsheetBtn");
const editBtn = document.getElementById("editBtn");
const downloadBtn = document.getElementById("downloadBtn");
const saveBtn = document.getElementById("saveBtn");
const saveAsBtn = document.getElementById("saveAsBtn");
const quickSaveBtn = document.getElementById("quickSaveBtn");
const encryptionBtn = document.getElementById("encryptionBtn");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const revealBtn = document.getElementById("revealBtn");
const refreshFileBtn = document.getElementById("refreshFileBtn");
const refreshFolderBtn = document.getElementById("refreshFolderBtn");
const exportBtn = document.getElementById("exportBtn");
const topbarLockBtn = document.getElementById("topbarLockBtn");
const returnTopBtn = document.getElementById("returnTopBtn");
const returnToReadBtn = document.getElementById("returnToReadBtn");
const topbar = document.querySelector(".topbar");
const dropZone = document.getElementById("dropZone");

const emptyState = document.getElementById("emptyState");
const errorState = document.getElementById("errorState");
const errorMessage = document.getElementById("errorMessage");
const reader = document.getElementById("reader");
const editorShell = document.getElementById("editorShell");
const markdownInput = document.getElementById("markdownInput");
const editorPreview = document.getElementById("editorPreview");

const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const statusText = document.getElementById("statusText");
const tocSection = document.getElementById("tocSection");
const tocNav = document.getElementById("tocNav");
const folderSection = document.getElementById("folderSection");
const folderNav = document.getElementById("folderNav");
const editorModeSelect = document.getElementById("editorModeSelect");
const modeMenuLabel = document.getElementById("modeMenuLabel");

/* Declared up here, not beside applyEditorMode further down: the top menu is
   built during start-up and reads this, and a `let` in the temporal dead zone
   throws rather than reading undefined. */
let editorMode = "blocks";
const refreshBtn = document.getElementById("refreshBtn");
const themeSelect = document.getElementById("themeSelect");
const documentStyleSelect = document.getElementById("documentStyleSelect");
const pdfPaperSelect = document.getElementById("pdfPaperSelect");
const voiceSelect = document.getElementById("voiceSelect");
const speakBtn = document.getElementById("speakBtn");
const stopSpeakBtn = document.getElementById("stopSpeakBtn");
const imagePreview = document.getElementById("imagePreview");
const imagePreviewStage = document.getElementById("imagePreviewStage");
const imagePreviewImg = document.getElementById("imagePreviewImg");
const imagePreviewClose = document.getElementById("imagePreviewClose");
const cheatsheetDialog = document.getElementById("cheatsheetDialog");
const cheatsheetBackdrop = document.getElementById("cheatsheetBackdrop");
const cheatsheetClose = document.getElementById("cheatsheetClose");
const cheatsheetContent = document.getElementById("cheatsheetContent");
const remoteContentNotice = document.getElementById("remoteContentNotice");
const remoteContentNoticeText = document.getElementById("remoteContentNoticeText");
const remoteContentLoadBtn = document.getElementById("remoteContentLoadBtn");
const remoteContentAllowBtn = document.getElementById("remoteContentAllowBtn");
const confirmDialog = document.getElementById("confirmDialog");
const confirmDialogBackdrop = document.getElementById("confirmDialogBackdrop");
const confirmDialogTitle = document.getElementById("confirmDialogTitle");
const confirmDialogMessage = document.getElementById("confirmDialogMessage");
const confirmDialogPrimary = document.getElementById("confirmDialogPrimary");
const confirmDialogSecondary = document.getElementById("confirmDialogSecondary");
const confirmDialogCancel = document.getElementById("confirmDialogCancel");
const availableThemes = new Set(["dark", "light", "brown"]);
const availableDocumentStyles = new Set([
  "signature",
  "standard",
  "studio",
  "editorial",
  "refined",
  "graphite",
]);
const availablePdfPaperSizes = new Set(["browser", "a4", "letter"]);
const markdownFilePattern = /\.(md|markdown|txt)$/i;
const imageFilePattern = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const externalUrlPattern = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;
const recoveryKeyFileName = "LightMDReader-recovery-key.json";
const encryptionKeyFileName = "lightmdreader-key-v1.json";
const googleDriveAppDataScope = "https://www.googleapis.com/auth/drive.appdata";
const googleIdentityScope = "openid profile email";
const googleScopes = `${googleIdentityScope} ${googleDriveAppDataScope}`;
const googleClientId = window.LightMDReaderConfig?.googleClientId || "";

// Documented limits. They exist so that an oversized or hostile input fails
// with a message instead of freezing the tab, and they are deliberately far
// above anything a hand-written document needs.
const maxDocumentBytes = 8 * 1024 * 1024;
const maxFolderEntries = 5000;
const maxFolderDepth = 12;
const maxHydratedImages = 300;

let folderFiles = new Map();
let markdownFiles = [];
let objectUrls = [];
let currentFile = null;
let currentFileHandle = null;
let currentDirectoryHandle = null;
let currentFolderPath = "";
let currentMode = "empty";
let currentMarkdownText = "";
let currentDownloadName = "document.md";
let currentRenderContext = null;
let editorPreviewTimer = null;
let editorScrollTimer = null;
let suppressPreviewCursorSyncUntil = 0;
let readingSnapshot = null;
// The last content and encryption intent known to be on disk. Everything that
// could replace the open document compares against these.
let savedMarkdownText = "";
let savedEncryptionEnabled = false;
let activeSaveOperation = null;
// Increment before an async open/render and re-check afterwards so a slow
// operation cannot overwrite the result of a newer one.
let documentOpenGeneration = 0;
let readerRenderGeneration = 0;
let previewRenderGeneration = 0;
let pendingServiceWorkerRegistration = null;
let googleTokenClient = null;
let googleIdentityPromise = null;
let googleAccessToken = "";
let googleAccessTokenExpiresAt = 0;
let googleProfile = null;
let masterKeyBytes = null;
let masterCryptoKey = null;
let masterKeyId = "";
// Identifier form used by documents written before key IDs were hashed.
let masterKeyLegacyId = "";
let driveKeyFileId = "";
let encryptedDocumentState = {
  encrypted: false,
  unlocked: false,
  keyId: "",
};
let previewScale = 1;
let previewX = 0;
let previewY = 0;
let previewStartX = 0;
let previewStartY = 0;
let previewStartTranslateX = 0;
let previewStartTranslateY = 0;
let previewStartDistance = 0;
let previewStartScale = 1;
let previewIsDragging = false;
let previewWasDragged = false;
let cheatsheetMarkdownText = "";
let cheatsheetTrigger = null;
// Hosts the reader has permanently allowed, and a one-off unlock for the
// document currently open. Both are consulted before any remote fetch.
const trustedRemoteHostsKey = "lightmdreader-trusted-hosts";
let trustedRemoteHosts = loadTrustedRemoteHosts();
let remoteContentUnlocked = false;
let blockedRemoteHosts = [];
const previewPointers = new Map();

function setStatus(message) {
  statusText.textContent = message;
}

function setEncryptedDocumentState(nextState = {}) {
  encryptedDocumentState = {
    encrypted: false,
    unlocked: false,
    keyId: "",
    ...nextState,
  };
  updateEncryptionControls();
}

function updateEncryptionControls() {
  const hasDocument = currentMode !== "empty";
  const signedIn = Boolean(masterCryptoKey && googleProfile);
  const googleReady = Boolean(googleClientId);

  googleSignInBtn.textContent = googleProfile?.name || googleProfile?.email || "Sign in";
  googleSignInBtn.title = googleReady
    ? signedIn
      ? `Signed in as ${googleProfile.email || googleProfile.name}. Recovery key and sign out.`
      : "Sign in with Google"
    : "Add a Google OAuth Client ID in config.js";
  googleSignInBtn.disabled = !googleReady;

  encryptionBtn.disabled = !hasDocument && signedIn;
  encryptionBtn.classList.toggle("is-active", encryptedDocumentState.encrypted);

  if (!googleReady) {
    encryptionBtn.disabled = true;
    encryptionBtn.setAttribute("aria-label", "Configure Google sign-in to use encryption");
    encryptionBtn.title = "Configure Google sign-in to use encryption";
    return;
  }

  if (!signedIn) {
    encryptionBtn.disabled = false;
    encryptionBtn.setAttribute("aria-label", "Sign in to use encryption");
    encryptionBtn.title = "Sign in to use encryption";
    return;
  }

  if (!hasDocument) {
    encryptionBtn.disabled = true;
    encryptionBtn.setAttribute("aria-label", "Open a document before using encryption");
    encryptionBtn.title = "Open a document before using encryption";
    return;
  }

  if (encryptedDocumentState.encrypted) {
    encryptionBtn.setAttribute("aria-label", "Save decrypted copy");
    encryptionBtn.title = "Encrypted document. Saves stay encrypted. Click to download a decrypted copy.";
    return;
  }

  encryptionBtn.setAttribute("aria-label", "Encrypt document");
  encryptionBtn.title = "Encrypt this document";
}

function getGoogleSignInUnavailableMessage() {
  if (!googleClientId) {
    return "Add your Google OAuth Client ID in config.js to use encryption.";
  }

  if (!window.google?.accounts?.oauth2) {
    return "Google sign-in did not load. Check your connection and reload.";
  }

  return "";
}

function keyIdMatchesActiveKey(keyId) {
  if (!keyId) return true;

  return keyId === masterKeyId || keyId === masterKeyLegacyId;
}

// The only place that promotes a candidate key to the active one.
async function activateMasterKey(bytes) {
  masterKeyBytes = bytes;
  masterCryptoKey = await importMasterKey(bytes);
  masterKeyId = await createKeyId(bytes);
  masterKeyLegacyId = createLegacyKeyId(bytes);
}

async function encryptMarkdownDocument(markdownText) {
  await ensureEncryptionReady();

  return encryptMarkdown(masterCryptoKey, masterKeyId, markdownText);
}

async function decryptMarkdownDocument(payload) {
  await ensureEncryptionReady();

  if (!keyIdMatchesActiveKey(payload.keyId)) {
    const choice = await openConfirmDialog({
      title: "Encrypted with a different key",
      message:
        "This document was encrypted with another LightMDReader key. " +
        "You can import a recovery key file to unlock it. The imported key is checked against " +
        "this document before anything is changed.",
      primaryLabel: "Import recovery key",
      cancelLabel: "Cancel",
    });

    if (choice !== "primary") {
      throw new Error("This document was encrypted with another LightMDReader key.");
    }

    // The candidate must decrypt this very document before it is allowed to
    // become the active key or reach Google Drive.
    await importRecoveryKey({ verifyAgainst: payload });
  }

  try {
    return await decryptPayloadWithKey(masterCryptoKey, payload);
  } catch {
    throw new Error("Could not unlock this document with your current key.");
  }
}

function downloadTextFile(fileName, text, type = "application/json;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadRecoveryKey() {
  if (!masterKeyBytes) return false;

  try {
    downloadTextFile(
      recoveryKeyFileName,
      buildRecoveryKeyFile(masterKeyBytes, masterKeyId, googleProfile?.email || ""),
    );
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

/**
 * A browser can refuse a programmatic download, so the app must not report a
 * backup that may not exist. "Downloaded" and "confirmed saved" are separate
 * states, and the user is the one who confirms the second.
 */
async function downloadRecoveryKeyWithConfirmation() {
  if (!masterKeyBytes) {
    setStatus("There is no key to back up yet.");
    return;
  }

  if (!downloadRecoveryKey()) {
    setStatus("The recovery key download could not be started.");
    return;
  }

  const choice = await openConfirmDialog({
    title: "Save your recovery key",
    message:
      `Your browser was asked to download ${recoveryKeyFileName}. It is the only way to read your ` +
      "encrypted documents if Google Drive access is ever lost. Check that the file actually arrived, " +
      "then store it somewhere safe.",
    primaryLabel: "I have saved it",
    secondaryLabel: "Download again",
    cancelLabel: "Not now",
  });

  if (choice === "secondary") {
    await downloadRecoveryKeyWithConfirmation();
    return;
  }

  if (choice === "primary") {
    // Only the identifier is remembered. Key material never goes to storage.
    localStorage.setItem("lightmdreader-recovery-key-confirmed", masterKeyId);
    setStatus("Recovery key backup confirmed.");
    return;
  }

  setStatus("Recovery key backup not confirmed. Use Signed in ▸ Download recovery key later.");
}

function hasConfirmedRecoveryBackup() {
  return Boolean(masterKeyId) && localStorage.getItem("lightmdreader-recovery-key-confirmed") === masterKeyId;
}

/**
 * Ends the sensitive part of the session: access token, key material, decrypted
 * content, and any object URLs made from it.
 */
async function lockEncryptionSession() {
  if (!(await confirmDiscardUnsavedChanges("Locking and signing out"))) return;

  masterKeyBytes = null;
  masterCryptoKey = null;
  masterKeyId = "";
  masterKeyLegacyId = "";
  driveKeyFileId = "";
  googleAccessToken = "";
  googleAccessTokenExpiresAt = 0;
  googleProfile = null;
  googleTokenClient = null;

  // Decrypted text and any images derived from it must not stay on screen.
  showEmpty();
  updateEncryptionControls();
  setStatus("Locked. Sign in again to use encryption.");
}

async function openAccountMenu() {
  const label = googleProfile?.email || googleProfile?.name || "this account";
  const backupNote = hasConfirmedRecoveryBackup()
    ? "You have confirmed a recovery key backup."
    : "You have not confirmed a recovery key backup yet.";

  const choice = await openConfirmDialog({
    title: `Signed in as ${label}`,
    message: `${backupNote} The recovery key is the only way to read encrypted documents without Drive access.`,
    primaryLabel: "Download recovery key",
    secondaryLabel: "Lock and sign out",
    cancelLabel: "Close",
  });

  if (choice === "primary") {
    await downloadRecoveryKeyWithConfirmation();
    return;
  }

  if (choice === "secondary") {
    await lockEncryptionSession();
  }
}

/**
 * Google Identity Services is fetched the first time encryption is used, not
 * on every page load. Reading a markdown file should not involve Google at all.
 */
function loadGoogleIdentityServices() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (googleIdentityPromise) return googleIdentityPromise;

  googleIdentityPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");

    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;

    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => {
      googleIdentityPromise = null;
      reject(new Error("Google sign-in did not load. Check your connection and try again."));
    });

    document.head.appendChild(script);
  });

  return googleIdentityPromise;
}

function getGoogleTokenClient() {
  if (googleTokenClient) return googleTokenClient;

  const unavailableMessage = getGoogleSignInUnavailableMessage();
  if (unavailableMessage) {
    throw new Error(unavailableMessage);
  }

  googleTokenClient = google.accounts.oauth2.initTokenClient({
    client_id: googleClientId,
    scope: googleScopes,
    callback: () => {},
  });

  return googleTokenClient;
}

async function requestGoogleAccessToken(prompt = "") {
  if (!googleClientId) {
    throw new Error("Add your Google OAuth Client ID in config.js to use encryption.");
  }

  await loadGoogleIdentityServices();

  return new Promise((resolve, reject) => {
    const tokenClient = getGoogleTokenClient();

    tokenClient.callback = (response) => {
      if (response.error) {
        reject(new Error(response.error_description || response.error));
        return;
      }

      googleAccessToken = response.access_token;
      googleAccessTokenExpiresAt = Date.now() + Math.max(0, Number(response.expires_in || 0) - 60) * 1000;
      resolve(googleAccessToken);
    };

    tokenClient.requestAccessToken({ prompt });
  });
}

async function getGoogleAccessToken() {
  if (googleAccessToken && Date.now() < googleAccessTokenExpiresAt) {
    return googleAccessToken;
  }

  return requestGoogleAccessToken(googleAccessToken ? "" : "consent");
}

async function googleFetch(url, options = {}) {
  const token = await getGoogleAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    googleAccessToken = "";
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Google request failed (${response.status}).`);
  }

  return response;
}

async function loadGoogleProfile() {
  const response = await googleFetch("https://www.googleapis.com/oauth2/v3/userinfo");
  googleProfile = await response.json();
}

/**
 * Returns every matching key file, oldest first. The Drive API does not
 * guarantee an order otherwise, and picking whichever file happened to come
 * back first is how two sessions end up disagreeing about the key.
 */
async function findDriveKeyFiles() {
  const query = encodeURIComponent(`name='${encryptionKeyFileName}' and trashed=false`);
  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}` +
      "&orderBy=createdTime&pageSize=100&fields=files(id,name,createdTime,modifiedTime)",
  );
  const result = await response.json();

  return result.files || [];
}

function describeDuplicateKeyFiles(files) {
  return files.map((file) => `${file.id} (created ${file.createdTime || "unknown"})`).join(", ");
}

async function readDriveKeyFile(fileId) {
  const response = await googleFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return response.json();
}

async function createDriveKeyFile(keyRecord) {
  const metadata = {
    name: encryptionKeyFileName,
    parents: ["appDataFolder"],
    mimeType: "application/json",
  };
  const boundary = `lightmdreader-${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(keyRecord, null, 2),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await googleFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  const createdFile = await response.json();
  driveKeyFileId = createdFile.id || "";
}

async function updateDriveKeyFile(keyRecord) {
  if (!driveKeyFileId) {
    await createDriveKeyFile(keyRecord);
    return;
  }

  await googleFetch(`https://www.googleapis.com/upload/drive/v3/files/${driveKeyFileId}?uploadType=media`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(keyRecord, null, 2),
  });
}

async function chooseRecoveryKeyText() {
  if (window.showOpenFilePicker) {
    const [fileHandle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "LightMDReader recovery key",
          accept: {
            "application/json": [".json"],
          },
        },
      ],
    });
    const file = await fileHandle.getFile();
    return file.text();
  }

  return new Promise((resolve, reject) => {
    recoveryKeyInput.onchange = () => {
      const file = recoveryKeyInput.files?.[0];
      recoveryKeyInput.value = "";

      if (!file) {
        reject(new Error("No recovery key selected."));
        return;
      }

      file.text().then(resolve, reject);
    };
    recoveryKeyInput.click();
  });
}

/**
 * Imports a recovery key in three separate steps: parse, validate, persist.
 *
 * The Drive copy is only replaced after the candidate has proved itself, and
 * the previous key is restored if the upload fails. Importing the wrong file
 * can therefore no longer destroy a working key.
 */
async function importRecoveryKey({ verifyAgainst = null } = {}) {
  const text = await chooseRecoveryKeyText();
  const candidate = await parseRecoveryKeyFile(text);

  if (verifyAgainst) {
    try {
      await decryptPayloadWithKey(candidate.cryptoKey, verifyAgainst);
    } catch {
      throw new Error("That recovery key does not unlock this document. Nothing was changed.");
    }
  }

  const previous = {
    bytes: masterKeyBytes,
    cryptoKey: masterCryptoKey,
    keyId: masterKeyId,
    legacyId: masterKeyLegacyId,
  };

  let persist = true;

  if (previous.bytes) {
    const choice = await openConfirmDialog({
      title: "Replace the key stored in Google Drive?",
      message:
        "The imported key has been verified. Replacing the stored key means documents encrypted " +
        "with the previous key can only be opened by importing that key again.",
      primaryLabel: "Replace stored key",
      secondaryLabel: "Use for this session only",
      cancelLabel: "Cancel",
    });

    if (choice === "cancel") {
      throw new Error("Recovery key import cancelled. Nothing was changed.");
    }

    persist = choice === "primary";
  }

  await activateMasterKey(candidate.bytes);

  if (persist) {
    try {
      await updateDriveKeyFile({
        format: "lightmdreader-key-v1",
        keyId: masterKeyId,
        restoredAt: new Date().toISOString(),
        key: bytesToBase64(masterKeyBytes),
      });
    } catch (error) {
      masterKeyBytes = previous.bytes;
      masterCryptoKey = previous.cryptoKey;
      masterKeyId = previous.keyId;
      masterKeyLegacyId = previous.legacyId;
      updateEncryptionControls();

      throw new Error(`The key was not stored in Google Drive, so your previous key is still active. ${error.message}`);
    }
  }

  updateEncryptionControls();
  setStatus(persist ? "Recovery key imported and stored." : "Recovery key active for this session only.");
}

async function adoptDriveKeyFile(keyFile) {
  driveKeyFileId = keyFile.id;

  const keyRecord = await readDriveKeyFile(keyFile.id);

  if (keyRecord.format !== "lightmdreader-key-v1" || !keyRecord.key) {
    throw new Error("The LightMDReader key in Google Drive App Data is not supported.");
  }

  const bytes = base64ToBytes(keyRecord.key);

  if (bytes.length !== masterKeyByteLength) {
    throw new Error("The LightMDReader key in Google Drive App Data has an unexpected length.");
  }

  // Identifiers are recomputed from the key material rather than trusted from
  // the record, so a hand-edited file cannot mislabel a key.
  await activateMasterKey(bytes);
}

async function loadOrCreateMasterKey() {
  const keyFiles = await findDriveKeyFiles();

  // Multiple keys mean two sessions created one each. Choosing silently would
  // make some documents look corrupt, and deleting one could destroy the key
  // that documents actually need.
  if (keyFiles.length > 1) {
    throw new Error(
      `Google Drive App Data holds ${keyFiles.length} LightMDReader keys: ${describeDuplicateKeyFiles(keyFiles)}. ` +
        "Encryption is disabled until this is resolved, so that no document becomes unreadable.",
    );
  }

  if (keyFiles.length === 1) {
    await adoptDriveKeyFile(keyFiles[0]);
    return;
  }

  const choice = await openConfirmDialog({
    title: "No encryption key found",
    message:
      "Google Drive App Data does not contain a LightMDReader key yet. " +
      "Create a new one, or import a recovery key from an existing setup.",
    primaryLabel: "Create a new key",
    secondaryLabel: "Import a recovery key",
    cancelLabel: "Cancel",
  });

  if (choice === "cancel") {
    throw new Error("Encryption setup cancelled.");
  }

  if (choice === "secondary") {
    await importRecoveryKey();
    return;
  }

  await activateMasterKey(crypto.getRandomValues(new Uint8Array(masterKeyByteLength)));

  await createDriveKeyFile({
    format: "lightmdreader-key-v1",
    keyId: masterKeyId,
    createdAt: new Date().toISOString(),
    key: bytesToBase64(masterKeyBytes),
  });

  // Another tab may have created a key between the lookup and the write.
  const afterCreate = await findDriveKeyFiles();

  if (afterCreate.length > 1) {
    const oldest = afterCreate[0];

    if (oldest.id !== driveKeyFileId) {
      await adoptDriveKeyFile(oldest);
      setStatus(
        "Another session created a key at the same time. The older key is now active; " +
          "the extra key file was left in place for you to review.",
      );
      return;
    }
  }

  setStatus("Encryption key created.");
  await downloadRecoveryKeyWithConfirmation();
}

async function signInForEncryption() {
  setStatus("Signing in...");
  await requestGoogleAccessToken(googleAccessToken ? "" : "consent");
  await loadGoogleProfile();
  await loadOrCreateMasterKey();
  updateEncryptionControls();
  setStatus(`Signed in as ${googleProfile.email || googleProfile.name}`);
}

async function ensureEncryptionReady() {
  if (masterCryptoKey && googleProfile) return;
  await signInForEncryption();
}

/* Line endings.
 *
 * A <textarea> normalises CRLF to LF when its value is read back, always and
 * silently. Everything that compares editor text against document text is
 * therefore comparing LF against CRLF on a Windows file: the side-by-side
 * editor rewrote every line ending the moment you opened it, and block editing
 * committed a "change" for every block you merely clicked on.
 *
 * So the document is held in LF internally, and the file's own ending is put
 * back on the way to disk. Nothing is rewritten that the user did not edit.
 */
let documentLineEnding = "\n";

function normalizeLineEndings(text) {
  documentLineEnding = /\r\n/.test(text) ? "\r\n" : "\n";

  return String(text).replace(/\r\n?/g, "\n");
}

function withDocumentLineEndings(text) {
  if (documentLineEnding === "\n") return text;

  return String(text).replace(/\n/g, documentLineEnding);
}

async function readMarkdownDocumentText(text) {
  const encryptedPayload = parseEncryptedDocument(text);

  if (!encryptedPayload) {
    setEncryptedDocumentState();
    return normalizeLineEndings(text);
  }

  setStatus("Unlocking encrypted document...");
  const markdownText = normalizeLineEndings(await decryptMarkdownDocument(encryptedPayload));

  setEncryptedDocumentState({
    encrypted: true,
    unlocked: true,
    keyId: encryptedPayload.keyId || "",
  });

  return markdownText;
}

async function getCurrentStorageTextForWrite() {
  // The file gets its own line endings back; the in-memory document stays LF,
  // which is what savedMarkdownText and the dirty check compare against.
  const markdownText = withDocumentLineEndings(getCurrentMarkdownForWrite());

  if (!encryptedDocumentState.encrypted) {
    return markdownText;
  }

  return encryptMarkdownDocument(markdownText);
}

function getCurrentWritableHandle() {
  if (currentMode === "folder" && currentFolderPath) {
    const entry = markdownFiles.find((file) => file.path === currentFolderPath);
    return entry?.handle || null;
  }

  return currentFileHandle;
}

function canSaveOriginal() {
  return Boolean(getCurrentWritableHandle()?.createWritable);
}

function getDocumentLabel() {
  return fileNameEl.textContent && fileNameEl.textContent !== "—" ? fileNameEl.textContent : "This document";
}

/**
 * The single source of truth for "would this action lose work?". Both the
 * editor text and the encryption intent count, because switching a document to
 * encrypted is a change that has not reached disk yet either.
 */
function isDocumentDirty() {
  if (currentMode === "empty") return false;
  if (getCurrentMarkdownForWrite() !== savedMarkdownText) return true;

  return encryptedDocumentState.encrypted !== savedEncryptionEnabled;
}

function markDocumentSaved(markdownText) {
  savedMarkdownText = markdownText;
  savedEncryptionEnabled = encryptedDocumentState.encrypted;
  updateDirtyIndicator();
}

function updateDirtyIndicator() {
  const dirty = isDocumentDirty();

  document.body.classList.toggle("has-unsaved-changes", dirty);
  saveBtn.textContent = dirty ? "Save •" : "Save";
  saveBtn.title = dirty ? "Save unsaved changes to the original file" : "Save to the original file";
  saveBtn.setAttribute("aria-label", saveBtn.title);
  quickSaveBtn.title = saveBtn.title;
  quickSaveBtn.setAttribute("aria-label", saveBtn.title);
}

function updateSaveControls() {
  const hasDocument = currentMode !== "empty";

  saveBtn.disabled = !canSaveOriginal();
  saveAsBtn.disabled = !hasDocument || !window.showSaveFilePicker;
  quickSaveBtn.disabled = saveBtn.disabled;
  updateDirtyIndicator();
  updateEncryptionControls();
  updateRevealControl();
}

/**
 * Opens the operating system's file dialog already sitting in the folder the
 * open document came from.
 *
 * This is as close to "show in Explorer" as a web page can get. A page cannot
 * launch Explorer, and the File System Access API deliberately never exposes an
 * absolute path: a handle knows its own name and nothing about the drive or the
 * directories above it. What the API does offer is `startIn`, which accepts a
 * handle and opens the picker there, so one click lands the user in the right
 * folder with the OS's own copy-path and open-location commands to hand.
 *
 * The picker is opened read-only and its result is discarded on purpose. This
 * button navigates; it never changes which document is open.
 */
async function revealCurrentLocation() {
  const startIn = currentDirectoryHandle || currentFileHandle;

  if (!startIn || !window.showOpenFilePicker) return;

  try {
    await window.showOpenFilePicker({ startIn, multiple: false });
    setStatus("Ready");
  } catch (error) {
    // Dismissing the dialog is the normal way to use this button.
    if (error.name === "AbortError") {
      setStatus("Ready");
      return;
    }

    console.error(error);
    setStatus(error.message || "Could not open the folder");
  }
}

function updateRevealControl() {
  const target = currentDirectoryHandle || currentFileHandle;
  const isFolder = Boolean(currentDirectoryHandle);

  revealBtn.disabled = !target || !window.showOpenFilePicker;
  revealBtn.setAttribute("aria-label", isFolder ? "Show folder" : "Show file location");
  revealBtn.title = isFolder ? "Show folder" : "Show file location";
}

/**
 * Every action that would replace the open document routes through here.
 * Returns false when the user chose to keep what they have.
 */
async function confirmDiscardUnsavedChanges(actionDescription) {
  if (!isDocumentDirty()) return true;

  const canSave = canSaveOriginal() || Boolean(window.showSaveFilePicker);
  const choice = await openConfirmDialog({
    title: "Unsaved changes",
    message: `${getDocumentLabel()} has changes that are not saved. ${actionDescription} will discard them.`,
    primaryLabel: canSave ? "Save and continue" : "Continue anyway",
    secondaryLabel: canSave ? "Discard changes" : "",
    cancelLabel: "Cancel",
  });

  if (choice === "cancel") {
    setStatus("Cancelled");
    return false;
  }

  if (choice === "secondary" || !canSave) {
    return true;
  }

  try {
    if (canSaveOriginal()) {
      await saveCurrentMarkdownToOriginal();
    } else {
      await saveCurrentMarkdownAs();
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error(error);
    }

    setStatus(error.name === "AbortError" ? "Save cancelled" : error.message || "Could not save this file");
    return false;
  }

  // A save that silently failed must not be treated as permission to continue.
  return !isDocumentDirty();
}

function applyTheme(theme) {
  const safeTheme = availableThemes.has(theme) ? theme : "dark";
  document.documentElement.setAttribute("data-theme", safeTheme);
  localStorage.setItem("lightmdreader-theme", safeTheme);
  themeSelect.value = safeTheme;
}

const savedTheme = localStorage.getItem("lightmdreader-theme") || "dark";
applyTheme(savedTheme);

function applyDocumentStyle(style) {
  const safeStyle = availableDocumentStyles.has(style) ? style : "signature";
  document.documentElement.setAttribute("data-document-style", safeStyle);
  localStorage.setItem("lightmdreader-document-style", safeStyle);
  documentStyleSelect.value = safeStyle;
}

const savedDocumentStyle =
  localStorage.getItem("lightmdreader-document-style") || "signature";
applyDocumentStyle(savedDocumentStyle);

function setPdfPaperSize(size) {
  const safeSize = availablePdfPaperSizes.has(size) ? size : "browser";
  let printPageStyle = document.getElementById("printPageSizeStyle");

  if (!printPageStyle) {
    printPageStyle = document.createElement("style");
    printPageStyle.id = "printPageSizeStyle";
    document.head.appendChild(printPageStyle);
  }

  printPageStyle.textContent =
    safeSize === "browser"
      ? ""
      : `@media print { @page { size: ${safeSize === "a4" ? "A4" : "Letter"}; } }`;

  localStorage.setItem("lightmdreader-pdf-paper", safeSize);
  pdfPaperSelect.value = safeSize;
}

setPdfPaperSize(localStorage.getItem("lightmdreader-pdf-paper") || "browser");

/**
 * Read aloud.
 *
 * Speech comes from the browser's own SpeechSynthesis engine. Part of what
 * that engine offers are cloud voices ("Google ..." in Chrome, "... Online
 * (Natural)" in Edge). Those upload the text to a server, and because the
 * request is made by the browser and not by this page, the Content-Security-
 * Policy cannot stop it. Only voices reporting localService === true are
 * synthesized on this machine, so those are the only ones listed here, and
 * nothing is ever spoken without one. In particular this never falls back to
 * the system default voice, which is a cloud voice on a stock Chrome install.
 */
const speechSupported =
  "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
const speechVoiceKey = "lightmdreader-voice";
// Chrome truncates long utterances, so the document is spoken in small pieces.
// Short pieces also make Stop take effect immediately.
const maxSpeechChunkChars = 220;
const speechBlockSelector =
  "p, li, h1, h2, h3, h4, h5, h6, blockquote, dt, dd, figcaption, th, td";
let speechVoices = [];
let speechChunks = [];
let speechChunkIndex = 0;
let speechState = "idle";
let speechKeepAliveTimer = null;

function getSelectedVoice() {
  return speechVoices.find((voice) => voice.voiceURI === voiceSelect.value) || null;
}

function populateVoiceSelect() {
  if (!speechSupported) return;

  speechVoices = window.speechSynthesis
    .getVoices()
    .filter((voice) => voice.localService)
    .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));

  const stored = localStorage.getItem(speechVoiceKey);
  const uiLanguage = (navigator.language || "en").slice(0, 2).toLowerCase();
  const preferred =
    speechVoices.find((voice) => voice.voiceURI === stored) ||
    speechVoices.find((voice) => voice.lang.slice(0, 2).toLowerCase() === uiLanguage) ||
    speechVoices[0] ||
    null;

  const options = speechVoices.map((voice) => {
    const option = document.createElement("option");
    option.value = voice.voiceURI;
    option.textContent = `${voice.name} (${voice.lang})`;
    return option;
  });

  if (!options.length) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = "No offline voice";
    options.push(empty);
  }

  voiceSelect.replaceChildren(...options);

  // The voice menu is a view onto this select, so it is rebuilt with it.
  buildMenuChoices("voiceChoices", "voiceSelect");
  syncMenuChoices();
  voiceSelect.disabled = !speechVoices.length;

  if (preferred) {
    voiceSelect.value = preferred.voiceURI;
  }

  updateSpeechControls();
}

// Sentences first, words only when a single sentence is longer than the limit.
function splitIntoSpeechChunks(text) {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) || [text];
  const chunks = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  sentences.forEach((sentence) => {
    if (sentence.length > maxSpeechChunkChars) {
      flush();
      sentence.split(/\s+/).forEach((word) => {
        if (current && `${current} ${word}`.length > maxSpeechChunkChars) flush();
        current = current ? `${current} ${word}` : word;
      });
      return;
    }

    if (current && (current + sentence).length > maxSpeechChunkChars) flush();
    current += sentence;
  });

  flush();

  return chunks;
}

function collectSpeechChunks() {
  const blocks = [...reader.querySelectorAll(speechBlockSelector)].filter(
    (block) =>
      // Reading code punctuation aloud helps nobody.
      !block.closest("pre") &&
      // Containers whose text a nested block already covers.
      !block.querySelector(speechBlockSelector),
  );

  const chunks = [];

  blocks.forEach((block) => {
    const clone = block.cloneNode(true);
    clone.querySelectorAll(".md-comment, pre").forEach((node) => node.remove());
    const text = clone.textContent.replace(/\s+/g, " ").trim();

    if (text) chunks.push(...splitIntoSpeechChunks(text));
  });

  return chunks;
}

// Chrome stops speaking after roughly fifteen seconds unless it is nudged.
function startSpeechKeepAlive() {
  stopSpeechKeepAlive();
  speechKeepAliveTimer = window.setInterval(() => {
    if (speechState !== "speaking") return;
    window.speechSynthesis.resume();
  }, 8000);
}

function stopSpeechKeepAlive() {
  window.clearInterval(speechKeepAliveTimer);
  speechKeepAliveTimer = null;
}

function speakNextChunk() {
  const voice = getSelectedVoice();

  if (!voice || speechChunkIndex >= speechChunks.length) {
    const finished = Boolean(voice);
    stopReading();

    if (finished) setStatus("Finished reading");

    return;
  }

  const utterance = new SpeechSynthesisUtterance(speechChunks[speechChunkIndex]);

  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.onend = () => {
    if (speechState === "idle") return;

    speechChunkIndex += 1;
    speakNextChunk();
  };
  utterance.onerror = (event) => {
    if (event.error === "interrupted" || event.error === "canceled") return;

    stopReading();
    setStatus("Reading aloud failed");
  };

  window.speechSynthesis.speak(utterance);
}

function startReading() {
  if (!speechSupported) return;

  const voice = getSelectedVoice();

  if (!voice) {
    setStatus("No offline voice is installed, so nothing was read aloud.");
    return;
  }

  speechChunks = collectSpeechChunks();

  if (!speechChunks.length) {
    setStatus("There is nothing to read aloud.");
    return;
  }

  window.speechSynthesis.cancel();
  speechChunkIndex = 0;
  speechState = "speaking";
  startSpeechKeepAlive();
  updateSpeechControls();
  setStatus(`Reading aloud with ${voice.name}`);
  speakNextChunk();
}

function pauseReading() {
  if (speechState !== "speaking") return;

  window.speechSynthesis.pause();
  speechState = "paused";
  stopSpeechKeepAlive();
  updateSpeechControls();
  setStatus("Reading paused");
}

function resumeReading() {
  if (speechState !== "paused") return;

  window.speechSynthesis.resume();
  speechState = "speaking";
  startSpeechKeepAlive();
  updateSpeechControls();
  setStatus("Reading aloud");
}

function stopReading() {
  if (!speechSupported) return;

  const wasReading = speechState !== "idle";

  speechState = "idle";
  speechChunks = [];
  speechChunkIndex = 0;
  stopSpeechKeepAlive();
  window.speechSynthesis.cancel();
  updateSpeechControls();

  if (wasReading) setStatus("Reading stopped");
}

function updateSpeechControls() {
  if (!speechSupported) {
    voiceSelect.hidden = true;
    speakBtn.hidden = true;
    stopSpeakBtn.hidden = true;
    return;
  }

  const readable =
    !reader.hidden && Boolean(reader.textContent.trim()) && speechVoices.length > 0;

  speakBtn.disabled = speechState === "idle" && !readable;

  // The label is an icon now, so the state has to be carried by the title.
  const speakLabel =
    speechState === "speaking" ? "Pause reading" : speechState === "paused" ? "Resume reading" : "Read aloud";

  speakBtn.innerHTML =
    speechState === "speaking" ? "&#x23F8;&#xFE0E;" : "&#x25B7;&#x266A;";
  speakBtn.title = speakLabel;
  speakBtn.setAttribute("aria-label", speakLabel);
  speakBtn.classList.toggle("is-active", speechState !== "idle");
  stopSpeakBtn.hidden = speechState === "idle";
  voiceSelect.title = speechVoices.length
    ? "Offline voices only. Cloud voices are never listed."
    : "No offline voice is installed on this system.";

  syncMenuChoices();
}

speakBtn.addEventListener("click", () => {
  if (speechState === "speaking") {
    pauseReading();
    return;
  }

  if (speechState === "paused") {
    resumeReading();
    return;
  }

  startReading();
});

stopSpeakBtn.addEventListener("click", stopReading);

voiceSelect.addEventListener("change", () => {
  localStorage.setItem(speechVoiceKey, voiceSelect.value);
  stopReading();
});

if (speechSupported) {
  populateVoiceSelect();
  window.speechSynthesis.addEventListener("voiceschanged", populateVoiceSelect);
  // Some browsers keep speaking after the page is gone.
  window.addEventListener("pagehide", stopReading);
} else {
  updateSpeechControls();
}


/* ==========================================================================
   Top menu

   The menus are a view onto the hidden <select> elements, not a replacement
   for them. Choosing an item sets the select and fires its change event, so
   every existing listener — and every place that writes a saved preference
   back into a select — keeps working untouched.
   ========================================================================== */

const menus = [...document.querySelectorAll("[data-menu]")].map((root) => ({
  root,
  trigger: root.querySelector(".menu-trigger"),
  panel: root.querySelector(".menu-panel"),
}));

function closeMenus(except = null) {
  menus.forEach((menu) => {
    if (menu === except) return;

    menu.panel.hidden = true;
    menu.trigger.setAttribute("aria-expanded", "false");
  });
}

function openMenu(menu) {
  closeMenus(menu);
  syncMenuChoices();
  menu.panel.hidden = false;
  menu.trigger.setAttribute("aria-expanded", "true");

  const first = menu.panel.querySelector(".menu-item:not(:disabled)");
  if (first) first.focus();
}

menus.forEach((menu) => {
  menu.trigger.addEventListener("click", (event) => {
    event.stopPropagation();

    if (menu.panel.hidden) openMenu(menu);
    else closeMenus();
  });

  // Any command inside a menu closes it. The command's own listener still
  // runs: this is a bubble-phase listener on the panel, not a replacement.
  menu.panel.addEventListener("click", (event) => {
    if (event.target.closest(".menu-item")) closeMenus();
  });

  menu.panel.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    event.preventDefault();

    const items = [...menu.panel.querySelectorAll(".menu-item:not(:disabled)")];
    const at = items.indexOf(document.activeElement);
    const next = event.key === "ArrowDown" ? at + 1 : at - 1;

    items[(next + items.length) % items.length]?.focus();
  });
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-menu]")) closeMenus();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  const open = menus.find((menu) => !menu.panel.hidden);
  if (!open) return;

  closeMenus();
  open.trigger.focus();
});

/** Fill a menu group with one radio item per option of a hidden select. */
function buildMenuChoices(containerId, selectId, labelFor = (option) => option.textContent) {
  const container = document.getElementById(containerId);
  const select = document.getElementById(selectId);
  if (!container || !select) return;

  container.replaceChildren(
    ...[...select.options].map((option) => {
      const item = document.createElement("button");

      item.type = "button";
      item.className = "menu-item menu-choice";
      item.setAttribute("role", "menuitemradio");
      item.dataset.select = selectId;
      item.dataset.value = option.value;
      item.textContent = labelFor(option);
      item.disabled = select.disabled;

      return item;
    }),
  );
}

/** Move the dot to whatever the selects currently say. */
function syncMenuChoices() {
  document.querySelectorAll(".menu-choice").forEach((item) => {
    const select = document.getElementById(item.dataset.select);
    if (!select) return;

    // The mode is the one exception: changing it is asynchronous and can be
    // refused (an unsaved side-by-side edit prompts first). Marking the
    // select's value would show the choice as taken while the confirmation is
    // still on screen, and leave it wrong if the user backs out. The applied
    // mode is the honest thing to show.
    const current = select === editorModeSelect ? editorMode : select.value;

    item.setAttribute("aria-checked", current === item.dataset.value ? "true" : "false");
    item.disabled = select.disabled;
  });

  if (modeMenuLabel) {
    const chosen = [...editorModeSelect.options].find((option) => option.value === editorMode);
    modeMenuLabel.textContent = chosen ? chosen.textContent : "Block editing";
  }
}

// Delegated so items rebuilt later (the voice list) need no rewiring.
document.addEventListener("click", (event) => {
  const item = event.target.closest(".menu-choice");
  if (!item) return;

  const select = document.getElementById(item.dataset.select);
  if (!select || select.value === item.dataset.value) return;

  select.value = item.dataset.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  syncMenuChoices();
});

buildMenuChoices("styleChoices", "documentStyleSelect");
buildMenuChoices("themeChoices", "themeSelect");
buildMenuChoices("paperChoices", "pdfPaperSelect");
buildMenuChoices("voiceChoices", "voiceSelect");
syncMenuChoices();

/* One refresh button standing in for two.
 *
 * Which of them it means is already decided by what is open, and their enabled
 * states are set from a dozen places. Watching those two rather than editing
 * every one of them keeps this to one place. */
function syncRefreshButton() {
  refreshBtn.disabled = refreshFileBtn.disabled && refreshFolderBtn.disabled;
  refreshBtn.title = refreshFolderBtn.disabled ? "Refresh this file" : "Refresh the folder";
  refreshBtn.setAttribute("aria-label", refreshBtn.title);
}

new MutationObserver(syncRefreshButton).observe(refreshFileBtn, {
  attributes: true,
  attributeFilter: ["disabled"],
});
new MutationObserver(syncRefreshButton).observe(refreshFolderBtn, {
  attributes: true,
  attributeFilter: ["disabled"],
});
syncRefreshButton();

refreshBtn.addEventListener("click", () => {
  // A folder refresh also re-reads the open file, so it is the better answer
  // whenever a folder is open at all.
  if (!refreshFolderBtn.disabled) refreshCurrentFolder();
  else if (!refreshFileBtn.disabled) refreshCurrentFile();
});

function updateTopbarOffset() {
  document.documentElement.style.setProperty("--topbar-height", `${topbar.offsetHeight}px`);
}

function setTopbarLocked(isLocked) {
  updateTopbarOffset();
  document.body.classList.toggle("topbar-locked", isLocked);
  localStorage.setItem("lightmdreader-topbar-locked", isLocked ? "true" : "false");
  topbarLockBtn.innerHTML = isLocked ? "&#x1F512;&#xFE0E;" : "&#x1F513;&#xFE0E;";
  topbarLockBtn.setAttribute("aria-pressed", String(isLocked));
  topbarLockBtn.setAttribute("aria-label", isLocked ? "Unlock top menu" : "Lock top menu");
  topbarLockBtn.title = isLocked ? "Unlock top menu" : "Lock top menu";
}

setTopbarLocked(localStorage.getItem("lightmdreader-topbar-locked") === "true");

window.addEventListener("resize", updateTopbarOffset);
window.addEventListener("load", updateTopbarOffset);
/**
 * A new service worker version activating reloads the page, which would throw
 * away whatever is in the editor. Updates therefore wait until the document is
 * clean, and are applied on the next successful save.
 */
function handleServiceWorkerUpdate(registration) {
  pendingServiceWorkerRegistration = registration;
  applyPendingServiceWorkerUpdate();
}

function applyPendingServiceWorkerUpdate() {
  const worker = pendingServiceWorkerRegistration?.waiting;

  if (!worker) return;

  if (isDocumentDirty()) {
    setStatus("An update is ready. It will be applied after you save.");
    return;
  }

  pendingServiceWorkerRegistration = null;
  worker.postMessage({ type: "SKIP_WAITING" });
}

// Only warn when there is genuinely something to lose. A prompt on every clean
// reload trains people to dismiss it.
window.addEventListener("beforeunload", (event) => {
  if (!isDocumentDirty()) return;

  event.preventDefault();
  event.returnValue = "";
});

updateEncryptionControls();

themeSelect.addEventListener("change", (e) => {
  applyTheme(e.target.value);
});

documentStyleSelect.addEventListener("change", (e) => {
  applyDocumentStyle(e.target.value);
});

pdfPaperSelect.addEventListener("change", (e) => {
  setPdfPaperSize(e.target.value);
});

// Checked before reading, so an oversized file never reaches memory. The open
// document is left untouched when a candidate is rejected.
function enforceDocumentSizeLimit(file) {
  if (!file || file.size <= maxDocumentBytes) return true;

  setStatus(`${file.name} is ${formatBytes(file.size)}, larger than the ${formatBytes(maxDocumentBytes)} limit`);
  return false;
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  );

  return `${(bytes / Math.pow(k, index)).toFixed(index === 0 ? 0 : 1)} ${sizes[index]}`;
}

function clearObjectUrls() {
  closeImagePreview();
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
}

function waitForMarkdownRenderer() {
  if (window.LightMDRenderer?.ready) {
    return window.LightMDRenderer.ready;
  }

  if (window.markdownReady) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(new Error("The markdown renderer did not finish loading."));
    }, 15000);

    window.addEventListener(
      "markdown-ready",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );

    window.addEventListener(
      "markdown-error",
      (event) => {
        window.clearTimeout(timeout);
        reject(event.detail?.error || new Error("The markdown renderer failed."));
      },
      { once: true },
    );
  });
}

function showEmpty() {
  clearObjectUrls();
  clearTableOfContents();
  document.body.classList.remove("editor-active");
  readingSnapshot = null;
  currentFile = null;
  currentFileHandle = null;
  currentMode = "empty";
  currentMarkdownText = "";
  currentDownloadName = "document.md";
  currentRenderContext = null;
  setEncryptedDocumentState();
  resetRemoteContentPolicy();
  emptyState.hidden = false;
  errorState.hidden = true;
  reader.hidden = true;
  editorShell.hidden = true;
  stopReading();
  exportBtn.disabled = true;
  downloadBtn.disabled = true;
  editBtn.disabled = true;
  returnToReadBtn.hidden = true;
  refreshFileBtn.disabled = true;
  updateSaveControls();
}

function showError(message) {
  clearObjectUrls();
  clearTableOfContents();
  document.body.classList.remove("editor-active");
  errorMessage.textContent = message;
  emptyState.hidden = true;
  errorState.hidden = false;
  reader.hidden = true;
  editorShell.hidden = true;
  stopReading();
  exportBtn.disabled = true;
  returnToReadBtn.hidden = true;
  downloadBtn.disabled = true;
  editBtn.disabled = true;
  refreshFileBtn.disabled = true;
  updateSaveControls();
  saveBtn.disabled = true;
  saveAsBtn.disabled = true;
  quickSaveBtn.disabled = true;
  updateEncryptionControls();
}

function showReader(content) {
  document.body.classList.remove("editor-active");
  stopReading();
  reader.replaceChildren(content);
  buildTableOfContents();
  reader.hidden = false;
  editorShell.hidden = true;
  emptyState.hidden = true;
  errorState.hidden = true;
  exportBtn.disabled = false;
  downloadBtn.disabled = false;
  editBtn.disabled = false;
  returnToReadBtn.hidden = true;
  refreshFileBtn.disabled = currentMode === "empty";
  updateSpeechControls();
  updateSaveControls();
}

function showEditor(markdownText) {
  clearObjectUrls();
  clearTableOfContents();
  document.body.classList.add("editor-active");
  markdownInput.value = markdownText;
  reader.hidden = true;
  editorShell.hidden = false;
  stopReading();
  emptyState.hidden = true;
  errorState.hidden = true;
  exportBtn.disabled = false;
  downloadBtn.disabled = false;
  editBtn.disabled = true;
  returnToReadBtn.hidden = false;
  updateFileSize(markdownText);
  updateSaveControls();
}

function clearTableOfContents() {
  tocNav.innerHTML = "";
  tocSection.hidden = true;
}

function getVisibleHeadingText(heading) {
  const clone = heading.cloneNode(true);
  clone.querySelectorAll(".md-comment").forEach((comment) => comment.remove());

  return clone.textContent.trim();
}

function buildTableOfContents() {
  clearTableOfContents();

  const headings = [...reader.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter(
    (heading) => getVisibleHeadingText(heading),
  );

  if (!headings.length) return;

  const usedIds = new Map();

  headings.forEach((heading, index) => {
    const level = Number(heading.tagName.slice(1));
    const text = getVisibleHeadingText(heading);
    const baseId = heading.id || slugifyHeading(text) || `heading-${index + 1}`;
    const currentCount = usedIds.get(baseId) || 0;
    const nextCount = currentCount + 1;
    const headingId = currentCount ? `${baseId}-${nextCount}` : baseId;

    usedIds.set(baseId, nextCount);
    heading.id = headingId;

    const link = document.createElement("a");
    link.className = `toc-item toc-level-${Math.min(level, 6)}`;
    link.href = `#${headingId}`;
    link.textContent = text;
    link.addEventListener("click", (event) => {
      event.preventDefault();
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${headingId}`);
    });

    tocNav.appendChild(link);
  });

  tocSection.hidden = false;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setPreviewTransform() {
  imagePreviewImg.style.transform = `translate(${previewX}px, ${previewY}px) scale(${previewScale})`;
}

function resetImagePreview() {
  previewScale = 1;
  previewX = 0;
  previewY = 0;
  previewIsDragging = false;
  previewWasDragged = false;
  previewPointers.clear();
  imagePreviewStage.classList.remove("is-dragging");
  setPreviewTransform();
}

function openImagePreview(image) {
  const src = image.currentSrc || image.src;
  if (!src) return;

  imagePreviewImg.src = src;
  imagePreviewImg.alt = image.alt || "";
  resetImagePreview();
  imagePreview.hidden = false;
  document.body.classList.add("preview-open");
  imagePreviewClose.focus();
}

function closeImagePreview() {
  if (imagePreview.hidden) return;

  imagePreview.hidden = true;
  document.body.classList.remove("preview-open");
  imagePreviewImg.removeAttribute("src");
  resetImagePreview();
}

const focusableSelector =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function trapDialogFocus(dialog, event) {
  if (event.key !== "Tab") return;

  const focusable = [...dialog.querySelectorAll(focusableSelector)].filter(
    (element) => !element.hidden && element.offsetParent !== null,
  );

  if (!focusable.length) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
    return;
  }

  if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

let resolveConfirmDialog = null;

function closeConfirmDialog(result) {
  if (confirmDialog.hidden) return;

  const resolve = resolveConfirmDialog;
  const trigger = confirmDialog.dataset.returnFocusTo;

  resolveConfirmDialog = null;
  confirmDialog.hidden = true;
  document.body.classList.remove("confirm-open");
  delete confirmDialog.dataset.returnFocusTo;

  const returnTarget = trigger ? document.getElementById(trigger) : null;

  if (returnTarget && !returnTarget.disabled) {
    returnTarget.focus();
  }

  resolve?.(result);
}

/**
 * Destructive actions get a real decision point instead of a second click on
 * the same control. Resolves with "primary", "secondary", or "cancel".
 */
function openConfirmDialog({
  title,
  message,
  primaryLabel = "Confirm",
  secondaryLabel = "",
  cancelLabel = "Cancel",
  danger = false,
}) {
  closeConfirmDialog("cancel");

  const activeElement = document.activeElement;

  if (activeElement?.id) {
    confirmDialog.dataset.returnFocusTo = activeElement.id;
  }

  confirmDialogTitle.textContent = title;
  confirmDialogMessage.textContent = message;
  confirmDialogPrimary.textContent = primaryLabel;
  confirmDialogPrimary.classList.toggle("danger", danger);
  confirmDialogSecondary.textContent = secondaryLabel;
  confirmDialogSecondary.hidden = !secondaryLabel;
  confirmDialogCancel.textContent = cancelLabel;

  confirmDialog.hidden = false;
  document.body.classList.add("confirm-open");

  // Cancel takes initial focus so that a stray Enter or Space cannot confirm.
  confirmDialogCancel.focus();

  return new Promise((resolve) => {
    resolveConfirmDialog = resolve;
  });
}

function closeCheatsheet() {
  if (cheatsheetDialog.hidden) return;

  cheatsheetDialog.hidden = true;
  document.body.classList.remove("cheatsheet-open");
  hideMarkdownComments(cheatsheetContent);

  if (cheatsheetTrigger && document.contains(cheatsheetTrigger)) {
    cheatsheetTrigger.focus();
  }
}

async function loadCheatsheetMarkdown() {
  if (cheatsheetMarkdownText) return cheatsheetMarkdownText;

  const response = await fetch("./cheatsheet.md");

  if (!response.ok) {
    throw new Error("Could not load the markdown cheatsheet.");
  }

  cheatsheetMarkdownText = await response.text();
  return cheatsheetMarkdownText;
}

async function openCheatsheet() {
  cheatsheetTrigger = document.activeElement;
  cheatsheetDialog.hidden = false;
  document.body.classList.add("cheatsheet-open");
  cheatsheetContent.innerHTML = "<p>Loading cheatsheet...</p>";
  cheatsheetClose.focus();

  try {
    await waitForMarkdownRenderer();
    const markdownText = await loadCheatsheetMarkdown();
    const rawHtml = window.renderMarkdown(markdownText);
    const safeHtml = sanitizeHtml(rawHtml);

    cheatsheetContent.innerHTML = safeHtml || "<p>No cheatsheet content found.</p>";
    wireImagePreview(cheatsheetContent);
    wireMarkdownComments(cheatsheetContent);
  } catch (error) {
    console.error(error);
    const message = document.createElement("p");
    message.textContent = error.message || "Could not load the cheatsheet.";
    cheatsheetContent.replaceChildren(message);
  }
}

function zoomImagePreview(nextScale) {
  const previousScale = previewScale;
  previewScale = clamp(nextScale, 1, 8);

  if (previewScale === 1) {
    previewX = 0;
    previewY = 0;
  } else if (previousScale !== previewScale) {
    const ratio = previewScale / previousScale;
    previewX *= ratio;
    previewY *= ratio;
  }

  setPreviewTransform();
}

function getPointerDistance() {
  const points = [...previewPointers.values()];
  if (points.length < 2) return 0;

  return Math.hypot(points[0].clientX - points[1].clientX, points[0].clientY - points[1].clientY);
}

function wireImagePreview(root = reader) {
  [...root.querySelectorAll("img[src]")].forEach((image) => {
    image.tabIndex = 0;
    image.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openImagePreview(image);
    });
    image.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;

      event.preventDefault();
      event.stopPropagation();
      openImagePreview(image);
    });
  });
}

function positionMarkdownComment(comment) {
  const tooltip = comment.querySelector(".md-comment-tooltip");
  if (!tooltip) return;

  comment.classList.add("is-visible");
  comment.classList.remove("is-below");

  const margin = 12;
  const gap = 10;
  const commentRect = comment.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const halfTooltipWidth = tooltipRect.width / 2;
  const minX = margin + halfTooltipWidth;
  const maxX = window.innerWidth - margin - halfTooltipWidth;
  const unclampedX = commentRect.left + commentRect.width / 2;
  const nextX = clamp(unclampedX, minX, Math.max(minX, maxX));
  let nextY = commentRect.top - gap;

  if (nextY - tooltipRect.height < margin) {
    comment.classList.add("is-below");
    nextY = commentRect.bottom + gap;
  }

  comment.style.setProperty("--md-comment-tooltip-x", `${nextX}px`);
  comment.style.setProperty("--md-comment-tooltip-y", `${nextY}px`);
}

function hideMarkdownComment(comment) {
  comment.classList.remove("is-visible", "is-below");
}

function hideMarkdownComments(root = document) {
  root.querySelectorAll(".md-comment.is-visible").forEach((comment) => {
    hideMarkdownComment(comment);
  });
}

function wireMarkdownComments(root = reader) {
  [...root.querySelectorAll(".md-comment")].forEach((comment) => {
    comment.addEventListener("mouseenter", () => positionMarkdownComment(comment));
    comment.addEventListener("focusin", () => positionMarkdownComment(comment));
    comment.addEventListener("touchstart", () => positionMarkdownComment(comment), { passive: true });
    comment.addEventListener("mouseleave", () => hideMarkdownComment(comment));
    comment.addEventListener("focusout", () => hideMarkdownComment(comment));
  });
}

// Document markup must never be able to restyle, cover, or impersonate the
// application. Task-list checkboxes are the only form control markdown itself
// produces; everything else in that family is dropped.
const forbiddenContentTags = [
  "base",
  "button",
  "embed",
  "form",
  "link",
  "meta",
  "object",
  "optgroup",
  "option",
  "select",
  "style",
  "textarea",
];

// "style" removes document-supplied CSS. The rest are attributes that fetch or
// submit on their own without the reader asking for it.
const forbiddenContentAttributes = [
  "style",
  "srcset",
  "background",
  "form",
  "formaction",
  "ping",
  "autofocus",
];

let sanitizerHooksInstalled = false;

function installSanitizerHooks() {
  if (sanitizerHooksInstalled || !window.DOMPurify) return;

  DOMPurify.addHook("afterSanitizeElements", (node) => {
    if (node.nodeName !== "INPUT") return;

    if (node.getAttribute("type")?.toLowerCase() !== "checkbox") {
      node.remove();
      return;
    }

    // Keep "checked" so "- [x]" still renders, but make the control inert.
    node.setAttribute("disabled", "");
    ["name", "value", "required", "pattern", "list"].forEach((attribute) => {
      node.removeAttribute(attribute);
    });
  });

  sanitizerHooksInstalled = true;
}

function sanitizeHtml(html) {
  if (!window.DOMPurify) {
    throw new Error("The sanitizer did not load.");
  }

  installSanitizerHooks();

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "data-source-line", "tabindex", "aria-label", "aria-hidden"],
    FORBID_TAGS: forbiddenContentTags,
    FORBID_ATTR: forbiddenContentAttributes,
  });
}

// Parsing into a template keeps the tree inert: no image or media request is
// issued until the nodes are attached to the live document, which gives
// hydrateLocalImages a chance to swap local paths for blob URLs first.
function createInertFragment(safeHtml) {
  const template = document.createElement("template");
  template.innerHTML = safeHtml;

  return template.content;
}

function loadTrustedRemoteHosts() {
  try {
    const stored = JSON.parse(localStorage.getItem(trustedRemoteHostsKey) || "[]");

    return new Set(Array.isArray(stored) ? stored.filter((host) => typeof host === "string") : []);
  } catch {
    return new Set();
  }
}

function remoteResourceHost(value) {
  try {
    return new URL(String(value).trim(), window.location.href).host;
  } catch {
    return "";
  }
}

function isTrustedRemoteHost(value) {
  const host = remoteResourceHost(value);

  return Boolean(host) && trustedRemoteHosts.has(host);
}

function createRemoteImagePlaceholder(src, alt) {
  const host = remoteResourceHost(src) || "an unknown host";
  const placeholder = document.createElement("span");

  placeholder.className = "remote-blocked";
  placeholder.setAttribute("role", "img");
  placeholder.setAttribute("aria-label", `Blocked remote image from ${host}${alt ? `: ${alt}` : ""}`);

  const icon = document.createElement("span");
  icon.className = "remote-blocked-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "\u25a8";

  const label = document.createElement("span");
  label.className = "remote-blocked-label";
  label.textContent = alt ? `${alt} \u2014 blocked, ${host}` : `Remote image blocked \u2014 ${host}`;

  placeholder.append(icon, label);

  return placeholder;
}

/**
 * Fetching a remote image tells that server your IP address and the time, the
 * same way a tracking pixel in an email does. So nothing remote is fetched
 * until the host is known-good: either permanently allowed, or unlocked for
 * this one document. This runs on the inert fragment, before it is attached,
 * so a blocked reference never gets the chance to fire.
 */
function blockRemoteResources(root) {
  const hosts = new Set();

  [...root.querySelectorAll("img[src]")].forEach((image) => {
    const src = image.getAttribute("src");

    if (!isRemoteResourceUrl(src) || isTrustedRemoteHost(src)) return;

    if (remoteContentUnlocked) {
      hosts.add(remoteResourceHost(src));
      return;
    }

    hosts.add(remoteResourceHost(src));
    image.replaceWith(createRemoteImagePlaceholder(src, image.getAttribute("alt")));
  });

  // Anything else that reaches out on its own simply loses the reference.
  // There is no placeholder to offer, so trust does not apply here. Images are
  // excluded: the loop above already decided about them, and matching them here
  // would strip the src straight back off the ones it just allowed.
  [...root.querySelectorAll("[src]:not(img), [poster]")].forEach((element) => {
    ["src", "poster"].forEach((attribute) => {
      const value = element.getAttribute(attribute);

      if (!value || !isRemoteResourceUrl(value)) return;

      hosts.add(remoteResourceHost(value));
      element.removeAttribute(attribute);
    });
  });

  return {
    blocked: root.querySelectorAll(".remote-blocked").length,
    hosts: [...hosts].filter(Boolean),
  };
}

function applyRemoteContentNotice({ blocked, hosts }) {
  blockedRemoteHosts = hosts;

  if (!blocked) {
    remoteContentNotice.hidden = true;
    return;
  }

  const shown = hosts.slice(0, 3).join(", ");
  const extra = hosts.length > 3 ? ` and ${hosts.length - 3} more` : "";

  remoteContentNoticeText.textContent =
    `${blocked} remote ${blocked === 1 ? "image is" : "images are"} blocked in this document ` +
    `(${shown}${extra}). Loading them tells ${hosts.length === 1 ? "that host" : "those hosts"} ` +
    `your IP address and the time you opened it.`;
  remoteContentAllowBtn.textContent =
    hosts.length === 1 ? `Always allow ${hosts[0]}` : "Always allow these hosts";
  remoteContentAllowBtn.hidden = hosts.length === 0;
  remoteContentNotice.hidden = false;
}

function trustRemoteHosts(hosts) {
  hosts.filter(Boolean).forEach((host) => trustedRemoteHosts.add(host));

  try {
    localStorage.setItem(trustedRemoteHostsKey, JSON.stringify([...trustedRemoteHosts]));
  } catch {
    // A full or disabled storage costs the reader the memory, not the feature.
    setStatus("Allowed for this session only, could not be saved");
  }
}

// The unlock is per document: opening another one starts from blocked again.
function resetRemoteContentPolicy() {
  remoteContentUnlocked = false;
  blockedRemoteHosts = [];
  remoteContentNotice.hidden = true;
}

async function hydrateLocalImages(root, context) {
  if (!context?.path || !folderFiles.size) return;

  const images = [...root.querySelectorAll("img[src]")];

  if (images.length > maxHydratedImages) {
    setStatus(`Only the first ${maxHydratedImages} local images in this document are loaded`);
  }

  await Promise.all(
    images.slice(0, maxHydratedImages).map(async (image) => {
      const src = image.getAttribute("src");

      if (!src || externalUrlPattern.test(src)) return;

      const imagePath = resolveRelativePath(context.path, src);
      const handle = folderFiles.get(imagePath);

      if (!handle || !imageFilePattern.test(imagePath)) return;

      try {
        const file = await handle.getFile();
        const objectUrl = URL.createObjectURL(file);
        objectUrls.push(objectUrl);
        image.setAttribute("src", objectUrl);
      } catch (error) {
        console.warn(`Could not load local image: ${imagePath}`, error);
      }
    }),
  );
}

/**
 * Waits until every image under `root` has finished loading.
 *
 * hydrateLocalImages only sets the src attribute, and the fragment it works on
 * is an inert <template> - that is deliberate, it stops the document issuing
 * requests before the local paths are swapped for blob URLs. The consequence is
 * that the browser does not start fetching an image until the fragment is
 * attached to the live document, so immediately after a render every image is
 * still at complete === false and naturalWidth === 0.
 *
 * window.print() snapshots the page synchronously, so printing at that moment
 * puts an empty box on the page where the image should be. It shows up on
 * screen a moment later, which is why the image is visible in the preview but
 * missing from the PDF.
 *
 * Broken images resolve too: a missing file must not hold the export back.
 */
function awaitImages(root, timeoutMs = 5000) {
  const pending = [...root.querySelectorAll("img")].filter((image) => !image.complete);

  if (!pending.length) return Promise.resolve();

  const loaded = Promise.all(
    pending.map(
      (image) =>
        new Promise((resolve) => {
          image.addEventListener("load", resolve, { once: true });
          image.addEventListener("error", resolve, { once: true });
        }),
    ),
  );

  const timeout = new Promise((resolve) => window.setTimeout(resolve, timeoutMs));

  return Promise.race([loaded, timeout]);
}

/* ----------------------------------------------------------
   Title pages for PDF export

   Every h1 becomes a book-style title page: the heading, plus any run of
   h3..h6 directly after it, centred on a page of its own. h2 already starts a
   new page, and body text always begins on the page after the title.

   The grouping has to be a real element, because markdown produces a flat list
   of siblings and CSS cannot box two of them together. Doing that permanently
   would change the DOM the rest of the app reads: `.markdown-body > *:first-child`
   and every `h1 + p` rule are written against headings being direct children.
   So the wrapping happens on beforeprint and is undone on afterprint, which
   covers the Export button and Ctrl+P alike and leaves the screen untouched.
   ---------------------------------------------------------- */

const titlePageClass = "pdf-title-page";
const titlePageSubheadings = new Set(["H3", "H4", "H5", "H6"]);

function buildTitlePages(root) {
  [...root.querySelectorAll("h1")].forEach((heading) => {
    const parent = heading.parentElement;

    // A heading nested in a blockquote or list item is not a document title.
    if (!parent || !parent.classList.contains("markdown-body")) return;

    // Whitespace between the headings is moved along with them. Skipping it
    // would leave those text nodes behind, and unwrapping afterwards would
    // then put the headings back in a different place relative to them - the
    // DOM would render the same but no longer be the document that was
    // rendered, and repeated exports would keep shifting it.
    const group = [heading];
    const whitespace = [];
    let node = heading.nextSibling;

    while (node) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
        whitespace.push(node);
        node = node.nextSibling;
        continue;
      }

      if (node.nodeType !== Node.ELEMENT_NODE || !titlePageSubheadings.has(node.tagName)) break;

      group.push(...whitespace, node);
      whitespace.length = 0;
      node = node.nextSibling;
    }

    const wrapper = document.createElement("div");

    wrapper.className = titlePageClass;
    parent.insertBefore(wrapper, heading);
    wrapper.append(...group);
  });
}

function clearTitlePages(root) {
  [...root.querySelectorAll(`.${titlePageClass}`)].forEach((wrapper) => {
    wrapper.replaceWith(...wrapper.childNodes);
  });
}

function activePrintRoot() {
  return editorShell.hidden ? reader : editorPreview;
}

window.addEventListener("beforeprint", () => {
  // Clearing first keeps this idempotent: some browsers fire beforeprint more
  // than once for a single dialog, and wrapping a wrapper would nest pages.
  const root = activePrintRoot();

  clearTitlePages(root);
  buildTitlePages(root);
});

// Always runs, including when the print dialog is cancelled. Clearing both
// roots is deliberate: the mode can change while the dialog is open, and a
// leftover wrapper would be visible on screen.
window.addEventListener("afterprint", () => {
  clearTitlePages(reader);
  clearTitlePages(editorPreview);
});

function wireLocalMarkdownLinks(context, root = reader) {
  if (!context?.path || !markdownFiles.length) return;

  [...root.querySelectorAll("a[href]")].forEach((link) => {
    const href = link.getAttribute("href");

    if (!href || externalUrlPattern.test(href)) return;

    const targetPath = resolveRelativePath(context.path, href);
    const targetExists = markdownFiles.some((entry) => entry.path === targetPath);

    if (!targetExists) return;

    const { fragment } = splitLocalHref(href);

    link.addEventListener("click", (event) => {
      event.preventDefault();
      openFolderMarkdown(targetPath, { fragment });
    });
  });
}

function scrollToDocumentFragment(fragment) {
  if (!fragment) return;

  const decoded = safeDecodeURIComponent(fragment);
  const slug = slugifyHeading(decoded);
  const candidates = [...reader.querySelectorAll("[id]")];
  const target =
    candidates.find((element) => element.id === decoded) ||
    candidates.find((element) => element.id === slug);

  if (!target) {
    setStatus(`Opened, but section "${decoded}" was not found`);
    return;
  }

  target.scrollIntoView({ behavior: "auto", block: "start" });
  history.replaceState(null, "", `#${encodeURIComponent(target.id)}`);
}

/* ==========================================================================
   Block editing (experimental, off by default)

   Enable with ?blocks=1 in the URL. Read-only for now: the document renders as
   blocks, but nothing is editable yet.

   The rendered DOM is deliberately identical to the reader's — the same
   elements, in the same order, as siblings — with a data-block attribute
   tagging which block each element belongs to. That is what lets all six
   document styles, PDF export, the table of contents and read-aloud keep
   working untouched: `h1 + p` and `.markdown-body > *:first-child` still match,
   which they would not if each block were wrapped in a div.
   ========================================================================== */

/* Which editor the reader gets, remembered across sessions like the theme and
   the document style. `?blocks=1` and `?blocks=0` override it for one visit,
   which is how the two can be compared without changing the stored setting. */
const editorModeKey = "lightmdreader-editor-mode";
const blockModeOverride = new URLSearchParams(window.location.search).get("blocks");

const editorModes = new Set(["blocks", "read", "split"]);

/* Three ways to work:
 *   blocks — click any block to edit it in place (the default)
 *   read   — no editing at all; the document is only a document
 *   split  — the old side-by-side editor and preview
 * `blockModeEnabled` stays as the derived flag the editing code reads. */
let blockModeEnabled = true;

function applyEditorMode(mode, { remember = true } = {}) {
  editorMode = editorModes.has(mode) ? mode : "blocks";
  blockModeEnabled = editorMode === "blocks";

  if (remember) localStorage.setItem(editorModeKey, editorMode);

  editorModeSelect.value = editorMode;

  // Everything blockedit.css adds is scoped to this class, so reading, a PDF
  // export and the side-by-side editor never see any of it.
  document.body.classList.toggle("block-mode", blockModeEnabled);

  // The Edit button only makes sense in the mode it opens. Block editing
  // replaces it; read only has nothing for it to do.
  editBtn.hidden = editorMode !== "split";

  syncMenuChoices();
}

const storedEditorMode = localStorage.getItem(editorModeKey);
const requestedEditorMode = new URLSearchParams(window.location.search).get("mode");

applyEditorMode(
  editorModes.has(requestedEditorMode)
    ? requestedEditorMode
    : blockModeOverride !== null
      ? (blockModeOverride === "0" ? "split" : "blocks")
      : (editorModes.has(storedEditorMode) ? storedEditorMode : "blocks"),
  { remember: false },
);

async function changeEditorMode(mode) {
  if (mode === editorMode) return;

  // A block open for editing holds text that is not in the document yet.
  await closeBlockEditor();

  // The side-by-side editor has its own unsaved text and its own way out.
  if (!editorShell.hidden) {
    await returnToRead();

    if (!editorShell.hidden) {
      // The user cancelled the discard prompt, so the mode change is off too.
      editorModeSelect.value = editorMode;
      syncMenuChoices();
      return;
    }
  }

  applyEditorMode(mode);
  clearBlockHistory();

  if (currentMode === "empty") {
    setStatus(editorModeSelect.selectedOptions[0]?.textContent || "Ready");
    return;
  }

  // The reader is rebuilt first either way. Side-by-side takes its snapshot
  // from the reader, and that snapshot is what "Return to read" comes back to.
  await renderDocument(currentMarkdownText, currentRenderContext);

  // The mode is named after an editor, so choosing it should put you in it
  // rather than just revealing the button that would. editCurrentDocument
  // sets its own status.
  if (editorMode === "split") {
    await editCurrentDocument();
    return;
  }

  setStatus(editorModeSelect.selectedOptions[0]?.textContent || "Ready");
}

editorModeSelect.addEventListener("change", (event) => {
  changeEditorMode(event.target.value).catch((error) => {
    console.error(error);
    setStatus(error.message || "Could not switch editing mode");
  });
});

// The document as the block model sees it, and the block currently open for
// editing. `blockEditing` holds the detached nodes it replaced, so leaving a
// block without changing it can put the very same nodes back.
let blockDocument = null;
let blockTools = null;
let blockEditing = null;
let blockBusy = false;

/* Undo for block editing.
 *
 * Every commit produces a complete document, because the partition serialises
 * byte-for-byte, so the history is simply a ring of whole documents. No inverse
 * operations, nothing to replay, nothing to get subtly wrong. Ten snapshots of
 * a 100 KB document is about a megabyte.
 *
 * This sits on top of the browser's own undo, which still handles typing inside
 * the open block. See onBlockUndoKeydown for how the two stay unambiguous. */
const blockHistoryLimit = 10;
let blockUndoHistory = [];
let blockRedoHistory = [];

function getBlockTools() {
  if (!blockTools) {
    const md = window.LightMDRenderer?.md;

    if (!md) {
      throw new Error("The markdown renderer did not expose its parser.");
    }

    const model = createBlockModel(md);
    blockTools = { model, renderer: createBlockRenderer(md, model) };
  }

  return blockTools;
}

// textContent, never innerHTML: a definition block is raw source and must not
// be interpreted as markup on its way to the page.
function buildSourceBlock(source) {
  const element = document.createElement("pre");

  element.className = "raw-source";
  element.textContent = source;

  return element;
}

function buildFootnoteTail(rendered) {
  // No label of its own: the footnote list is part of the document as the
  // reader sees it, and a note explaining where it came from would be text the
  // author never wrote. Clicking an entry jumps to its definition, which is a
  // better way to learn what it is.
  const wrapper = document.createElement("div");
  wrapper.className = "footnote-tail";

  wrapper.appendChild(createInertFragment(sanitizeHtml(rendered.tail)));

  // Each entry keeps the label that produced it, so it can be traced back to
  // its definition block once editing is on.
  [...wrapper.querySelectorAll("li.footnote-item")].forEach((item, order) => {
    const label = rendered.labels[order];
    if (label != null) item.dataset.label = label;
  });

  return wrapper;
}

// Snapshot before appending: appendChild moves the node, which would mutate
// the live child list underneath the loop.
function buildBlockNodes(entry) {
  return entry.kind === "source"
    ? [buildSourceBlock(entry.source)]
    : [...createInertFragment(sanitizeHtml(entry.html)).childNodes];
}

/* The key a block's DOM is reused on.
 *
 * It is the rendered content with every position stripped out of it. Two
 * things move without a word changing: the block index, and data-source-line,
 * which shifts on every block after an insertion. Keying on either would mean
 * nothing below an edit could ever be reused, which is exactly the case this
 * is for. Positions are stamped back on afterwards as plain attribute writes. */
const sourceLineAttribute = / data-source-line="\d+"/g;

function blockGroupKey(entry) {
  return entry.kind === "source"
    ? `s:${entry.hidden ? "h" : "-"}:${entry.source}`
    : `h:${entry.hidden ? "h" : "-"}:${entry.html.replace(sourceLineAttribute, "")}`;
}

// The footnote list carries line numbers of its own, and it sits at the end of
// the document where the tail match starts. Leaving them in meant a single
// insertion anywhere rebuilt everything below it.
function tailGroupKey(tail) {
  return `t:${tail.replace(sourceLineAttribute, "")}`;
}

function stampBlockNodes(nodes, index, entry, startLine = null) {
  let first = true;

  nodes.forEach((node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    node.setAttribute("data-block", String(index));
    node.classList.toggle(
      "has-hidden-comment",
      Boolean(entry.hidden) && entry.kind !== "source",
    );

    // Kept in step for the block's own element. Elements nested inside a
    // reused block keep the line they were rendered with, which is stale after
    // an insertion above them. Nothing reads those today; if anything ever
    // does, it has to be stamped here too rather than trusted.
    if (first && startLine != null) {
      node.setAttribute("data-source-line", String(startLine + 1));
      first = false;
    }
  });
}

function buildBlockFragment(markdownText) {
  // Whatever was open referred to nodes that are about to be replaced.
  blockEditing = null;

  const { model, renderer } = getBlockTools();
  const doc = model.parseDoc(markdownText);
  const rendered = renderer.renderBlocks(doc);

  if (rendered.unmapped?.length) {
    console.warn("Block rendering could not place source lines:", rendered.unmapped);
  }

  const fragment = document.createDocumentFragment();

  const offsets = model.blockOffsets(doc);

  rendered.blocks.forEach((entry, index) => {
    const nodes = buildBlockNodes(entry);

    stampBlockNodes(nodes, index, entry, offsets[index][0]);
    nodes.forEach((node) => {
      node.__blockKey = blockGroupKey(entry);
      fragment.appendChild(node);
    });
  });

  if (rendered.tail) {
    const tail = buildFootnoteTail(rendered);
    tail.__blockKey = tailGroupKey(rendered.tail);
    fragment.appendChild(tail);
  }

  blockDocument = doc;

  return fragment;
}

/* --------------------------------------------------------------------------
   Block editing

   Two rules carry the whole safety story:

   1. The document is a strict partition of its source lines (lib/blockModel.js),
      so serialising is byte-identical to the file by construction.
   2. Leaving a block compares the text in the editor with the text that went
      in. If they match, nothing is written at all — not even a re-parse — and
      the very same DOM nodes are put back, still holding their blob URLs.
      Navigating through a document therefore cannot change it.
   -------------------------------------------------------------------------- */

// Every node of a block's run, including the whitespace between its elements,
// so putting it back restores the DOM exactly.
function blockRunNodes(index) {
  const elements = [...reader.querySelectorAll(`[data-block="${index}"]`)];
  if (!elements.length) return [];

  const children = [...reader.childNodes];
  const first = children.indexOf(elements[0]);
  const last = children.indexOf(elements[elements.length - 1]);

  if (first === -1 || last === -1) return elements;

  return children.slice(first, last + 1);
}

function autosizeBlockInput(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function buildBlockInput(value) {
  const wrapper = document.createElement("div");
  wrapper.className = "block-editor";

  const textarea = document.createElement("textarea");
  textarea.className = "block-input";
  textarea.spellcheck = false;
  textarea.value = value;
  textarea.setAttribute("aria-label", "Markdown source of this block");

  textarea.addEventListener("input", () => {
    // Marks that the browser now has undo history of its own for this block.
    if (blockEditing) blockEditing.typed = true;
    autosizeBlockInput(textarea);
    updateDirtyIndicator();
  });
  textarea.addEventListener("keydown", onBlockInputKeydown);

  wrapper.appendChild(textarea);

  return { wrapper, textarea };
}

function focusBlockInput(caret) {
  if (!blockEditing) return;

  const { textarea } = blockEditing;

  autosizeBlockInput(textarea);
  textarea.focus({ preventScroll: true });

  const at = caret === "end" || caret == null ? textarea.value.length : caret;
  textarea.setSelectionRange(at, at);
  textarea.scrollIntoView({ block: "nearest" });
}

function openBlockEditor(index, caret = "end") {
  if (blockEditing || !blockDocument) return;
  if (index < 0 || index >= blockDocument.blocks.length) return;

  const { model } = getBlockTools();
  const nodes = blockRunNodes(index);
  if (!nodes.length) return;

  const source = model.blockText(blockDocument, index);
  const { wrapper, textarea } = buildBlockInput(source);

  reader.insertBefore(wrapper, nodes[0]);
  nodes.forEach((node) => node.remove());

  blockEditing = { index, nodes, wrapper, textarea, original: source, isNew: false, typed: false };
  focusBlockInput(caret);
  setStatus("Editing block");
}

function openNewBlockEditor(at) {
  if (blockEditing || !blockDocument) return;

  const { wrapper, textarea } = buildBlockInput("");
  const following = reader.querySelector(`[data-block="${at}"]`)
    || reader.querySelector(".footnote-tail");

  reader.insertBefore(wrapper, following);

  blockEditing = { at, nodes: [], wrapper, textarea, original: "", isNew: true, typed: false };
  focusBlockInput(0);
  setStatus("New block");
}

// Put back exactly what was there. No re-render, no re-parse, no image reload.
// Takes the editing record rather than reading the module-level one, which the
// caller has already cleared by this point.
function restoreBlockNodes(editing) {
  editing.nodes.forEach((node) => reader.insertBefore(node, editing.wrapper));
  editing.wrapper.remove();
}

/**
 * Close the open editor.
 *
 * Returns { shiftFrom, delta } so a caller holding a block index from before
 * the commit can correct it: a commit can split one block into several, or
 * remove it.
 */
async function closeBlockEditor({ commit = true } = {}) {
  if (!blockEditing) return { shiftFrom: 0, delta: 0 };

  const editing = blockEditing;
  const value = editing.textarea.value;
  blockEditing = null;

  if (!commit || (!editing.isNew && value === editing.original)) {
    restoreBlockNodes(editing);
    updateDirtyIndicator();
    setStatus("Rendered");
    return { shiftFrom: 0, delta: 0 };
  }

  if (editing.isNew && !value.trim()) {
    editing.wrapper.remove();
    setStatus("Rendered");
    return { shiftFrom: 0, delta: 0 };
  }

  const { model } = getBlockTools();
  let shift;

  recordBlockHistory(editing.isNew ? editing.at : editing.index);

  if (editing.isNew) {
    const inserted = model.insertBlocks(blockDocument, editing.at, value);
    shift = { shiftFrom: editing.at, delta: inserted };
  } else {
    const produced = model.spliceBlocks(blockDocument, editing.index, 1, value);
    shift = { shiftFrom: editing.index + 1, delta: produced - 1 };
  }

  await commitBlockDocument();

  return shift;
}

function shiftedBlockIndex(index, shift) {
  const moved = shift.delta && index >= shift.shiftFrom ? index + shift.delta : index;

  return Math.max(0, Math.min(blockDocument.blocks.length - 1, moved));
}

async function moveToBlock(index, caret) {
  const shift = await closeBlockEditor();

  if (!blockDocument?.blocks.length) return;

  openBlockEditor(shiftedBlockIndex(index, shift), caret);
}

async function mergeBlocks(from, count, text, caret) {
  const { model } = getBlockTools();

  blockEditing = null;
  recordBlockHistory(from);
  model.spliceBlocks(blockDocument, from, count, text);
  await commitBlockDocument();

  if (blockDocument.blocks.length) openBlockEditor(Math.min(from, blockDocument.blocks.length - 1), caret);
}

function onBlockInputKeydown(event) {
  if (!blockEditing || blockBusy) return;

  const textarea = event.currentTarget;
  const { model } = getBlockTools();
  const value = textarea.value;
  const atStart = textarea.selectionStart === 0 && textarea.selectionEnd === 0;
  const atEnd = textarea.selectionStart === value.length && textarea.selectionEnd === value.length;
  const index = blockEditing.isNew ? blockEditing.at : blockEditing.index;
  const last = blockDocument.blocks.length - 1;

  const run = (work) => {
    event.preventDefault();
    blockBusy = true;
    Promise.resolve(work()).finally(() => {
      blockBusy = false;
    });
  };

  if (event.key === "Escape") {
    run(() => closeBlockEditor({ commit: false }));
    return;
  }

  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    run(async () => {
      const shift = await closeBlockEditor();
      const at = blockEditing === null && blockDocument
        ? Math.max(0, Math.min(blockDocument.blocks.length, index + 1 + (shift.delta || 0)))
        : index + 1;
      openNewBlockEditor(at);
    });
    return;
  }

  if (blockEditing.isNew) return;

  if (event.key === "ArrowUp" && atStart && index > 0) {
    run(() => moveToBlock(index - 1, "end"));
    return;
  }

  if (event.key === "ArrowDown" && atEnd && index < last) {
    run(() => moveToBlock(index + 1, 0));
    return;
  }

  // Backspace at the very start merges into the block above; Delete at the
  // very end pulls the next one up. Both are real edits, so both are guarded
  // by the caret being exactly at the boundary with nothing selected.
  if (event.key === "Backspace" && atStart && index > 0) {
    const previous = model.blockText(blockDocument, index - 1);
    run(() => mergeBlocks(index - 1, 2, `${previous}\n${value}`, previous.length));
    return;
  }

  if (event.key === "Delete" && atEnd && index < last) {
    const next = model.blockText(blockDocument, index + 1);
    run(() => mergeBlocks(index, 2, `${value}\n${next}`, value.length));
  }
}

/* --------------------------------------------------------------------------
   Updating the view after a commit

   Re-rendering the whole document would re-read every image from disk and
   throw away every node, which flickers and loses scroll position on anything
   with pictures in it. Instead the rendered blocks are compared with what is
   already on screen and only the differing ones are rebuilt.

   Invalidation is DERIVED, never predicted: nothing works out which blocks an
   edit "should" have affected. A block that renders to different HTML gets a
   different key and is rebuilt; a block that renders the same keeps its node,
   its blob URLs and its scroll position. A footnote definition three blocks
   away changing every footnote number needs no special case — those blocks
   simply render differently.
   -------------------------------------------------------------------------- */

// What the last in-place update actually reused, for the browser tests.
let lastBlockReconcile = null;

// Runs of nodes on screen, grouped by the key they were built with.
function currentBlockRuns() {
  const runs = [];
  let run = null;

  [...reader.childNodes].forEach((node) => {
    const key = node.__blockKey ?? null;

    if (!run || run.key !== key) {
      run = { key, nodes: [] };
      runs.push(run);
    }

    run.nodes.push(node);
  });

  return runs;
}

/**
 * Update the reader in place. Returns false if it declined, in which case the
 * caller must fall back to a full render.
 */
async function refreshBlocksInPlace() {
  const { renderer } = getBlockTools();
  const rendered = renderer.renderBlocks(blockDocument);

  if (rendered.unmapped?.length) return false;

  const groups = rendered.blocks.map((entry) => ({ key: blockGroupKey(entry), entry }));

  if (rendered.tail) groups.push({ key: tailGroupKey(rendered.tail), tail: rendered });

  const existing = currentBlockRuns();

  // Match the untouched head and tail of the document, and rebuild only what
  // lies between. Without this an inserted block would shift every run after
  // it out of alignment and rebuild the rest of the page.
  const limit = Math.min(groups.length, existing.length);
  let head = 0;
  while (head < limit && groups[head].key === existing[head].key) head += 1;

  let foot = 0;
  while (
    foot < limit - head
    && groups[groups.length - 1 - foot].key === existing[existing.length - 1 - foot].key
  ) {
    foot += 1;
  }

  lastBlockReconcile = {
    groups: groups.length,
    existing: existing.length,
    head,
    foot,
    rebuilt: Math.max(0, groups.length - head - foot),
  };

  const staging = document.createDocumentFragment();
  const runs = [];

  groups.forEach((group, position) => {
    if (position < head) {
      runs.push(existing[position].nodes);
      return;
    }

    if (position >= groups.length - foot) {
      runs.push(existing[existing.length - (groups.length - position)].nodes);
      return;
    }

    const nodes = group.tail ? [buildFootnoteTail(group.tail)] : buildBlockNodes(group.entry);

    nodes.forEach((node) => {
      node.__blockKey = group.key;
      staging.appendChild(node);
    });
    runs.push(nodes);
  });

  if (staging.childNodes.length) {
    await hydrateLocalImages(staging, currentRenderContext);

    // Remote images need the document-wide notice recomputed, which a partial
    // update cannot do honestly. It is rare enough to be worth a full render.
    const remote = blockRemoteResources(staging);
    if (remote.blocked || remote.hosts.length) return false;

    wireLocalMarkdownLinks(currentRenderContext, staging);
    wireImagePreview(staging);
    wireMarkdownComments(staging);
  }

  // The rendered document has changed under it, so any speech in flight is
  // reading a document that no longer exists.
  stopReading();

  const desired = runs.flat();
  let at = 0;

  desired.forEach((node) => {
    const current = reader.childNodes[at];
    if (current !== node) reader.insertBefore(node, current || null);
    at += 1;
  });

  while (reader.childNodes.length > desired.length) {
    reader.removeChild(reader.lastChild);
  }

  // Positions shift even where content did not, so they are stamped every time.
  const offsets = getBlockTools().model.blockOffsets(blockDocument);

  rendered.blocks.forEach((entry, index) =>
    stampBlockNodes(runs[index], index, entry, offsets[index][0]));

  buildTableOfContents();

  return true;
}

/** Apply the current blockDocument to the view, the file size and the dirty state. */
async function commitBlockDocument() {
  const { model } = getBlockTools();
  const text = model.serializeDoc(blockDocument);

  currentMarkdownText = text;
  updateFileSize(text);

  if (!(await refreshBlocksInPlace())) {
    await renderDocument(text, currentRenderContext);
  }

  updateDirtyIndicator();
  setStatus("Rendered");
}

function blockHistoryEntry(focusIndex) {
  const { model } = getBlockTools();

  return { text: model.serializeDoc(blockDocument), focusIndex };
}

function pushBlockHistory(stack, entry) {
  stack.push(entry);
  if (stack.length > blockHistoryLimit) stack.shift();
}

// Called with the document as it stands BEFORE a commit is applied.
function recordBlockHistory(focusIndex) {
  if (!blockDocument) return;

  pushBlockHistory(blockUndoHistory, blockHistoryEntry(focusIndex));
  blockRedoHistory = [];
}

function clearBlockHistory() {
  blockUndoHistory = [];
  blockRedoHistory = [];
}

async function applyBlockHistory(entry) {
  const { model } = getBlockTools();

  blockEditing = null;
  blockDocument = model.parseDoc(entry.text);
  await commitBlockDocument();

  if (entry.focusIndex != null && blockDocument?.blocks.length) {
    openBlockEditor(Math.min(entry.focusIndex, blockDocument.blocks.length - 1), "end");
  }
}

async function stepBlockHistory(from, to, label) {
  if (!from.length) {
    setStatus(`Nothing to ${label}`);
    return;
  }

  const focusIndex = blockEditing && !blockEditing.isNew ? blockEditing.index : null;

  pushBlockHistory(to, blockHistoryEntry(focusIndex));
  await applyBlockHistory(from.pop());
  setStatus(label === "undo" ? "Undone" : "Redone");
}

/**
 * Two levels of undo, and the rule that keeps them apart.
 *
 * Inside a block that has actually been typed in, Ctrl+Z belongs to the
 * browser: character-level undo is what anyone expects while typing. Anywhere
 * else — between blocks, or in a block just opened and not yet touched — it
 * undoes the last commit. Without the "not yet typed in" case, clicking into a
 * block would make Ctrl+Z appear dead, because a fresh textarea has no history
 * of its own.
 */
function onBlockUndoKeydown(event) {
  if (!blockModeEnabled) return;
  if (!(event.ctrlKey || event.metaKey)) return;

  const key = event.key.toLowerCase();
  if (key !== "z" && key !== "y") return;

  // The side-by-side editor keeps its own undo.
  if (event.target === markdownInput) return;
  if (blockEditing && blockEditing.typed) return;
  if (blockBusy) return;

  const redo = key === "y" || (key === "z" && event.shiftKey);
  event.preventDefault();
  blockBusy = true;

  const work = redo
    ? stepBlockHistory(blockRedoHistory, blockUndoHistory, "redo")
    : stepBlockHistory(blockUndoHistory, blockRedoHistory, "undo");

  work.catch((error) => console.error(error)).finally(() => {
    blockBusy = false;
  });
}

async function handleBlockClick(event) {
  if (!blockModeEnabled || blockBusy) return;
  if (event.target.closest("textarea")) return;
  if (event.target.closest("a[href]")) return;
  if (event.target.closest(".md-comment")) return;

  // An entry in the generated footnote list traces back to the definition
  // block that produced it.
  const item = event.target.closest("li.footnote-item[data-label]");

  if (item) {
    const { renderer } = getBlockTools();
    blockBusy = true;

    try {
      const shift = await closeBlockEditor();
      const target = renderer.definitionBlockFor(blockDocument, item.dataset.label);
      if (target >= 0) openBlockEditor(shiftedBlockIndex(target, shift), "end");
    } finally {
      blockBusy = false;
    }

    return;
  }

  if (event.target.closest(".footnote-tail")) return;

  const element = event.target.closest("[data-block]");
  if (!element) return;

  const index = Number(element.getAttribute("data-block"));
  blockBusy = true;

  try {
    const shift = await closeBlockEditor();
    openBlockEditor(shiftedBlockIndex(index, shift), "end");
  } finally {
    blockBusy = false;
  }
}

async function handleBlockPointerDownOutside(event) {
  if (!blockModeEnabled || !blockEditing || blockBusy) return;
  if (event.target.closest(".block-editor")) return;
  if (event.target.closest("[data-block]")) return;
  if (event.target.closest("li.footnote-item[data-label]")) return;

  blockBusy = true;

  try {
    await closeBlockEditor();
  } finally {
    blockBusy = false;
  }
}

// A block is a run of elements, not a box, so the hover cue is applied to all
// of them at once.
let hoveredBlockIndex = null;

function setHoveredBlock(index) {
  if (index === hoveredBlockIndex) return;

  reader.querySelectorAll("[data-block].is-hovered")
    .forEach((node) => node.classList.remove("is-hovered"));

  hoveredBlockIndex = index;

  if (index == null) return;

  reader.querySelectorAll(`[data-block="${index}"]`)
    .forEach((node) => node.classList.add("is-hovered"));
}

{
  // A read-only view of the block state, for debugging and for the browser
  // tests. It exposes no way to change anything.
  window.__blockDebug = () => ({
    blocks: blockDocument ? blockDocument.blocks.length : 0,
    editing: blockEditing
      ? { index: blockEditing.index ?? blockEditing.at, isNew: blockEditing.isNew }
      : null,
    text: getCurrentMarkdownForWrite(),
    committed: blockDocument ? getBlockTools().model.serializeDoc(blockDocument) : "",
    undo: blockUndoHistory.length,
    redo: blockRedoHistory.length,
    reconcile: lastBlockReconcile,
  });

  // Bound once and gated at event time, because the mode is switchable.
  document.addEventListener("keydown", onBlockUndoKeydown);

  reader.addEventListener("click", (event) => {
    handleBlockClick(event).catch((error) => console.error(error));
  });

  document.addEventListener("pointerdown", (event) => {
    handleBlockPointerDownOutside(event).catch((error) => console.error(error));
  });

  // A touch screen fires a single synthetic mousemove on tap, so binding this
  // there would mark a block hovered and never unmark it.
  if (window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) {
    reader.addEventListener("mousemove", (event) => {
      if (!blockModeEnabled) return;

      const element = event.target.closest("[data-block]");
      setHoveredBlock(element ? element.getAttribute("data-block") : null);
    });

    reader.addEventListener("mouseleave", () => setHoveredBlock(null));
  }
}

async function renderDocument(markdownText, context = null) {
  const generation = ++readerRenderGeneration;

  currentMarkdownText = markdownText;
  currentRenderContext = context;
  setStatus("Loading renderer...");
  await waitForMarkdownRenderer();

  if (generation !== readerRenderGeneration) return;

  setStatus("Rendering...");

  clearObjectUrls();

  // Both paths go through createInertFragment and hydrateLocalImages, so no
  // image request is issued until local paths have been swapped for blob URLs
  // and remote hosts have been checked.
  const fragment = blockModeEnabled
    ? buildBlockFragment(markdownText)
    : createInertFragment(sanitizeHtml(window.renderMarkdown(markdownText)));

  await hydrateLocalImages(fragment, context);

  // Image reads are async, so a newer render may have started meanwhile. Its
  // clearObjectUrls() already revoked the URLs this pass created.
  if (generation !== readerRenderGeneration) return;

  const remote = blockRemoteResources(fragment);

  showReader(fragment);
  applyRemoteContentNotice(remote);
  wireLocalMarkdownLinks(context);
  wireImagePreview();
  wireMarkdownComments();
  setStatus("Rendered");
}

async function renderEditorPreview() {
  const generation = ++previewRenderGeneration;
  const markdownText = markdownInput.value;

  currentMarkdownText = markdownText;
  updateFileSize(markdownText);
  setStatus("Rendering preview...");
  await waitForMarkdownRenderer();

  if (generation !== previewRenderGeneration) return;

  const rawHtml = window.renderMarkdown(markdownText);
  const safeHtml = sanitizeHtml(rawHtml);

  clearObjectUrls();
  const fragment = createInertFragment(safeHtml || "<p></p>");
  await hydrateLocalImages(fragment, currentRenderContext);

  if (generation !== previewRenderGeneration) return;

  const remote = blockRemoteResources(fragment);

  editorPreview.replaceChildren(fragment);
  applyRemoteContentNotice(remote);
  wireLocalMarkdownLinks(currentRenderContext, editorPreview);
  wireImagePreview(editorPreview);
  wireMarkdownComments(editorPreview);
  syncPreviewToCursor();
  setStatus("Editing");
}

// A failed preview must not take the editor away with it: the text in the
// textarea is usually unsaved, and hiding the editor makes it unreachable.
function showPreviewError(message) {
  const notice = document.createElement("p");

  notice.className = "preview-error";
  notice.textContent = message;
  editorPreview.replaceChildren(notice);
  setStatus(message);
}

function scheduleEditorPreview() {
  window.clearTimeout(editorPreviewTimer);
  editorPreviewTimer = window.setTimeout(() => {
    renderEditorPreview().catch((error) => {
      console.error(error);
      showPreviewError(error.message || "Could not render the preview.");
    });
  }, 120);
}

function getCursorLine() {
  return markdownInput.value.slice(0, markdownInput.selectionStart).split("\n").length;
}

function getLineStartIndex(lineNumber) {
  if (lineNumber <= 1) return 0;

  let currentLine = 1;

  for (let index = 0; index < markdownInput.value.length; index += 1) {
    if (markdownInput.value[index] !== "\n") continue;

    currentLine += 1;

    if (currentLine === lineNumber) {
      return index + 1;
    }
  }

  return markdownInput.value.length;
}

function findPreviewElementForLine(lineNumber) {
  const mappedElements = [...editorPreview.querySelectorAll("[data-source-line]")];

  if (!mappedElements.length) return editorPreview.firstElementChild;

  let bestElement = mappedElements[0];
  let bestLine = Number(bestElement.dataset.sourceLine) || 1;

  for (const element of mappedElements) {
    const elementLine = Number(element.dataset.sourceLine) || 1;

    if (elementLine > lineNumber) break;

    bestElement = element;
    bestLine = elementLine;
  }

  const nextElement = mappedElements.find((element) => {
    const elementLine = Number(element.dataset.sourceLine) || 1;
    return elementLine >= lineNumber;
  });

  if (nextElement && lineNumber - bestLine > Number(nextElement.dataset.sourceLine) - lineNumber) {
    return nextElement;
  }

  return bestElement;
}

function syncPreviewToCursor() {
  if (editorShell.hidden) return;

  const target = findPreviewElementForLine(getCursorLine());
  if (!target) return;

  const previewRect = editorPreview.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const nextTop = editorPreview.scrollTop + targetRect.top - previewRect.top - editorPreview.clientHeight * 0.15;

  editorPreview.scrollTo({
    top: Math.max(0, nextTop),
    behavior: "auto",
  });
}

function schedulePreviewCursorSync() {
  if (performance.now() < suppressPreviewCursorSyncUntil) return;

  window.clearTimeout(editorScrollTimer);
  editorScrollTimer = window.setTimeout(syncPreviewToCursor, 0);
}

function moveEditorCursorToLine(lineNumber, { syncPreview = true } = {}) {
  const cursorIndex = getLineStartIndex(lineNumber);

  markdownInput.focus({ preventScroll: true });
  markdownInput.setSelectionRange(cursorIndex, cursorIndex);
  scrollEditorToLine(lineNumber, cursorIndex);

  if (syncPreview) {
    schedulePreviewCursorSync();
  } else {
    window.clearTimeout(editorScrollTimer);
  }
}

function getEditorLineHeight() {
  const computedStyle = window.getComputedStyle(markdownInput);
  const lineHeight = Number.parseFloat(computedStyle.lineHeight);

  if (Number.isFinite(lineHeight)) {
    return lineHeight;
  }

  const fontSize = Number.parseFloat(computedStyle.fontSize) || 15;
  return fontSize * 1.55;
}

function getEditorCursorTop(cursorIndex) {
  const computedStyle = window.getComputedStyle(markdownInput);
  const mirror = document.createElement("div");
  const caretMarker = document.createElement("span");
  const mirroredProperties = [
    "borderBottomWidth",
    "borderLeftWidth",
    "borderRightWidth",
    "borderTopWidth",
    "boxSizing",
    "fontFamily",
    "fontSize",
    "fontStyle",
    "fontVariant",
    "fontWeight",
    "letterSpacing",
    "lineHeight",
    "paddingBottom",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "tabSize",
    "textIndent",
    "textTransform",
    "whiteSpace",
    "wordBreak",
    "wordSpacing",
  ];

  mirroredProperties.forEach((property) => {
    mirror.style[property] = computedStyle[property];
  });

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.overflow = "hidden";
  mirror.style.overflowWrap = "break-word";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.width = `${markdownInput.offsetWidth}px`;

  mirror.textContent = markdownInput.value.slice(0, cursorIndex);
  caretMarker.textContent = "\u200b";
  mirror.append(caretMarker);
  document.body.append(mirror);

  const cursorTop = caretMarker.offsetTop;
  mirror.remove();

  return cursorTop;
}

function scrollEditorToLine(lineNumber, cursorIndex = getLineStartIndex(lineNumber)) {
  const computedStyle = window.getComputedStyle(markdownInput);
  const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
  const measuredTop = getEditorCursorTop(cursorIndex);
  const lineTop = Number.isFinite(measuredTop)
    ? measuredTop
    : paddingTop + (Math.max(1, lineNumber) - 1) * getEditorLineHeight();
  const nextTop = lineTop - markdownInput.clientHeight * 0.15;

  markdownInput.scrollTop = Math.max(0, nextTop);
}

function getPreviewSourceLineFromClick(target) {
  const sourceElement = target.closest("[data-source-line]");
  const sourceLine = Number(sourceElement?.dataset.sourceLine);

  return sourceLine || null;
}

function moveEditorCursorToPreviewTarget(target) {
  const sourceLine = getPreviewSourceLineFromClick(target);

  if (!sourceLine) return;

  suppressPreviewCursorSyncUntil = performance.now() + 150;
  moveEditorCursorToLine(sourceLine, { syncPreview: false });
}

function placeEditorCursorAtStart() {
  markdownInput.focus();
  markdownInput.setSelectionRange(0, 0);
  markdownInput.scrollTop = 0;
  editorPreview.scrollTop = 0;
  schedulePreviewCursorSync();
}

function updateFileSize(markdownText) {
  fileSizeEl.textContent = formatBytes(new Blob([markdownText]).size);
}

function captureReadingSnapshot() {
  if (!reader.hidden && currentMode !== "empty") {
    readingSnapshot = {
      markdownText: currentMarkdownText,
      renderContext: currentRenderContext,
      mode: currentMode,
      downloadName: currentDownloadName,
      fileName: fileNameEl.textContent,
      fileSize: fileSizeEl.textContent,
      file: currentFile,
      fileHandle: currentFileHandle,
      directoryHandle: currentDirectoryHandle,
      folderPath: currentFolderPath,
      encryptedDocumentState: { ...encryptedDocumentState },
      scrollY: window.scrollY,
    };
    return;
  }

  if (!readingSnapshot) {
    readingSnapshot = {
      mode: "empty",
      scrollY: 0,
    };
  }
}

async function returnToRead() {
  if (!(await confirmDiscardUnsavedChanges("Returning to reading"))) return;

  const snapshot = readingSnapshot;

  if (!snapshot || snapshot.mode === "empty") {
    showEmpty();
    setStatus("Ready");
    window.scrollTo({ top: 0, behavior: "auto" });
    return;
  }

  currentMode = snapshot.mode;
  currentDownloadName = snapshot.downloadName;
  currentFile = snapshot.file || null;
  currentFileHandle = snapshot.fileHandle || null;
  currentDirectoryHandle = snapshot.directoryHandle || currentDirectoryHandle;
  currentFolderPath = snapshot.folderPath || "";
  setEncryptedDocumentState(snapshot.encryptedDocumentState || {});
  fileNameEl.textContent = snapshot.fileName;
  fileSizeEl.textContent = snapshot.fileSize;
  setActiveFolderItem(currentFolderPath);

  await renderDocument(snapshot.markdownText, snapshot.renderContext);
  // The snapshot represents what is on disk, so returning to it is clean.
  markDocumentSaved(snapshot.markdownText);
  updateSaveControls();
  window.scrollTo({ top: snapshot.scrollY, behavior: "auto" });
}

async function createDocument() {
  if (!(await confirmDiscardUnsavedChanges("Creating a new document"))) return;

  captureReadingSnapshot();
  currentFile = null;
  currentFileHandle = null;
  currentMode = "create";
  currentRenderContext = null;
  currentDownloadName = "untitled.md";
  currentMarkdownText = "# Untitled\n\n";
  setEncryptedDocumentState();
  resetRemoteContentPolicy();
  fileNameEl.textContent = "Untitled";
  refreshFileBtn.disabled = true;
  // A brand new document has nothing on disk yet, but the untouched template
  // is not work worth protecting either.
  markDocumentSaved(currentMarkdownText);
  showEditor(currentMarkdownText);
  await renderEditorPreview();
  placeEditorCursorAtStart();
}

async function editCurrentDocument() {
  if (currentMode === "empty") return;

  captureReadingSnapshot();
  showEditor(currentMarkdownText);
  await renderEditorPreview();
  placeEditorCursorAtStart();
}

async function handleEncryptionAction() {
  if (currentMode === "empty") {
    await ensureEncryptionReady();
    return;
  }

  if (!encryptedDocumentState.encrypted) {
    await ensureEncryptionReady();
    setEncryptedDocumentState({
      encrypted: true,
      unlocked: true,
      keyId: masterKeyId,
    });
    updateDirtyIndicator();
    setStatus("Encryption on. Save or download to write encrypted content.");
    return;
  }

  const markdownText = withDocumentLineEndings(getCurrentMarkdownForWrite());
  const name = getDownloadFileName().replace(/(-\d{8}-\d{6})?(\.(?:md|markdown|txt))$/i, "-decrypted$2");

  downloadTextFile(name, markdownText, "text/markdown;charset=utf-8");
  setStatus("Downloaded decrypted copy");
}

function formatDownloadTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function getDownloadFileName() {
  const fallback = "document.md";
  const name = currentDownloadName || fileNameEl.textContent || fallback;
  const timestamp = formatDownloadTimestamp();
  const extensionMatch = name.match(/(\.(?:md|markdown|txt))$/i);

  if (extensionMatch) {
    const extension = extensionMatch[1];
    const baseName = name.slice(0, -extension.length);
    return `${baseName}-${timestamp}${extension}`;
  }

  return `${name}-${timestamp}.md`;
}

function downloadCurrentMarkdown() {
  getCurrentStorageTextForWrite()
    .then((documentText) => {
      if (!documentText && currentMode === "empty") return;

      downloadTextFile(getDownloadFileName(), documentText, "text/markdown;charset=utf-8");
      setStatus(encryptedDocumentState.encrypted ? "Downloaded encrypted copy" : "Downloaded");
    })
    .catch((error) => {
      console.error(error);
      setStatus(error.message || "Could not download this file");
    });
}

function getCurrentMarkdownForWrite() {
  // A block open for editing holds text that has not been committed yet.
  // Saving, downloading, exporting or checking for unsaved changes must see
  // it, or the edit is silently dropped.
  if (blockEditing) return blockTextWithPendingEdit();

  return editorShell.hidden ? currentMarkdownText : markdownInput.value;
}

function blockTextWithPendingEdit() {
  const { model } = getBlockTools();
  const preview = { blocks: blockDocument.blocks.slice(), seps: blockDocument.seps.slice() };
  const value = blockEditing.textarea.value;

  if (blockEditing.isNew) {
    if (value.trim()) model.insertBlocks(preview, blockEditing.at, value);
  } else {
    model.spliceBlocks(preview, blockEditing.index, 1, value);
  }

  return model.serializeDoc(preview);
}

async function ensureWritablePermission(fileHandle) {
  if (!fileHandle) return false;

  const options = { mode: "readwrite" };

  if (fileHandle.queryPermission && (await fileHandle.queryPermission(options)) === "granted") {
    return true;
  }

  if (!fileHandle.requestPermission) {
    return true;
  }

  return (await fileHandle.requestPermission(options)) === "granted";
}

async function writeMarkdownToHandle(fileHandle, markdownText) {
  if (!(await ensureWritablePermission(fileHandle))) {
    throw new Error("Write permission was not granted.");
  }

  const writable = await fileHandle.createWritable();
  await writable.write(markdownText);
  await writable.close();
}

function syncSavedDocumentState(markdownText, file = null, fileHandle = null) {
  currentMarkdownText = markdownText;
  updateFileSize(markdownText);

  if (file) {
    currentFile = file;
    currentDownloadName = file.name;
    fileSizeEl.textContent = formatBytes(file.size);

    if (currentMode !== "folder") {
      fileNameEl.textContent = file.name;
    }
  }

  if (fileHandle && currentMode !== "folder") {
    currentFileHandle = fileHandle;
    currentMode = "file";
  }

  if (readingSnapshot && readingSnapshot.mode !== "empty") {
    readingSnapshot.mode = currentMode;
    readingSnapshot.markdownText = markdownText;
    readingSnapshot.renderContext = currentRenderContext;
    readingSnapshot.fileName = fileNameEl.textContent;
    readingSnapshot.fileSize = fileSizeEl.textContent;
    readingSnapshot.file = currentFile;
    readingSnapshot.fileHandle = currentFileHandle;
    readingSnapshot.directoryHandle = currentDirectoryHandle;
    readingSnapshot.folderPath = currentFolderPath;
    readingSnapshot.downloadName = currentDownloadName;
    // Without this the snapshot keeps the encryption state from before the
    // save, and returning to reading would quietly turn encryption back off.
    readingSnapshot.encryptedDocumentState = { ...encryptedDocumentState };
  }

  markDocumentSaved(markdownText);
}

async function saveCurrentMarkdownToOriginal() {
  // Only one write may be in flight per document.
  if (activeSaveOperation) return activeSaveOperation;

  const fileHandle = getCurrentWritableHandle();

  if (!fileHandle?.createWritable || currentMode === "empty") {
    setStatus("Original save unavailable");
    return undefined;
  }

  activeSaveOperation = (async () => {
    const markdownText = getCurrentMarkdownForWrite();

    setStatus("Saving...");
    const storageText = await getCurrentStorageTextForWrite();
    await writeMarkdownToHandle(fileHandle, storageText);

    const file = fileHandle.getFile ? await fileHandle.getFile() : null;
    syncSavedDocumentState(markdownText, file);
    updateSaveControls();
    setStatus("Saved to original file");
    applyPendingServiceWorkerUpdate();
  })();

  try {
    return await activeSaveOperation;
  } finally {
    activeSaveOperation = null;
  }
}

async function saveCurrentMarkdownAs() {
  if (!window.showSaveFilePicker || currentMode === "empty") {
    setStatus("Save as unavailable");
    return;
  }

  const markdownText = getCurrentMarkdownForWrite();
  const storageText = await getCurrentStorageTextForWrite();
  const suggestedName = currentDownloadName || fileNameEl.textContent || "document.md";

  setStatus("Choosing save location...");

  const fileHandle = await window.showSaveFilePicker({
    suggestedName,
    types: [
      {
        description: "Markdown and text files",
        accept: {
          "text/markdown": [".md", ".markdown"],
          "text/plain": [".txt"],
        },
      },
    ],
  });

  setStatus("Saving...");
  await writeMarkdownToHandle(fileHandle, storageText);

  const file = fileHandle.getFile ? await fileHandle.getFile() : null;
  clearFolderMode();
  currentMode = "file";
  currentRenderContext = null;
  syncSavedDocumentState(markdownText, file, fileHandle);
  refreshFileBtn.disabled = false;
  updateSaveControls();
  setStatus("Saved as new file");
  applyPendingServiceWorkerUpdate();
}

function clearFolderMode() {
  currentDirectoryHandle = null;
  currentFolderPath = "";
  folderFiles = new Map();
  markdownFiles = [];
  folderNav.innerHTML = "";
  folderSection.hidden = true;
  refreshFolderBtn.disabled = true;
  updateRevealControl();
}

function setSingleFileMode(file, fileHandle = null) {
  clearFolderMode();
  currentFile = file;
  currentFileHandle = fileHandle;
  currentMode = "file";
  currentDownloadName = file.name;
  setEncryptedDocumentState();
  resetRemoteContentPolicy();
}

async function openMarkdownFile(file, fileHandle = null, { alreadyGuarded = false } = {}) {
  if (!file) return;

  if (!markdownFilePattern.test(file.name)) {
    showError("Choose a markdown or plain text file.");
    setStatus("Unsupported file");
    return;
  }

  if (!alreadyGuarded && !(await confirmDiscardUnsavedChanges(`Opening ${file.name}`))) {
    fileInput.value = "";
    return;
  }

  if (!enforceDocumentSizeLimit(file)) {
    fileInput.value = "";
    return;
  }

  const generation = ++documentOpenGeneration;

  clearBlockHistory();

  setSingleFileMode(file, fileHandle);
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  setStatus("Reading...");

  try {
    const text = await file.text();
    const markdownText = await readMarkdownDocumentText(text);

    // A slower open that started earlier must not replace a newer document.
    if (generation !== documentOpenGeneration) return;

    markDocumentSaved(markdownText);
    await renderDocument(markdownText);
    updateSaveControls();
  } catch (error) {
    if (generation !== documentOpenGeneration) return;

    console.error(error);
    showError(error.message || "Something went wrong while reading the file.");
    setStatus("Error");
  } finally {
    fileInput.value = "";
  }
}

async function openFile() {
  if (!(await confirmDiscardUnsavedChanges("Opening another file"))) return;

  if (!window.showOpenFilePicker) {
    fileInput.click();
    return;
  }

  setStatus("Choosing file...");

  try {
    const [fileHandle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: "Markdown and text files",
          accept: {
            "text/markdown": [".md", ".markdown"],
            "text/plain": [".txt"],
          },
        },
      ],
    });

    const file = await fileHandle.getFile();
    await openMarkdownFile(file, fileHandle, { alreadyGuarded: true });
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Ready");
      return;
    }

    console.error(error);
    showError(error.message || "Could not open this file.");
    setStatus("Error");
  }
}

async function scanDirectory(directoryHandle, basePath = "", depth = 0) {
  if (depth > maxFolderDepth) {
    console.warn(`Skipping "${basePath}": deeper than ${maxFolderDepth} levels.`);
    return;
  }

  for await (const [name, handle] of directoryHandle.entries()) {
    if (folderFiles.size >= maxFolderEntries) {
      setStatus(`Folder listing stopped at ${maxFolderEntries} files`);
      return;
    }

    const path = basePath ? `${basePath}/${name}` : name;

    if (handle.kind === "directory") {
      await scanDirectory(handle, path, depth + 1);
      continue;
    }

    if (handle.kind !== "file") continue;

    const normalizedPath = normalizePath(path);
    folderFiles.set(normalizedPath, handle);

    if (markdownFilePattern.test(name)) {
      markdownFiles.push({ name, path: normalizedPath, handle });
    }
  }
}

function renderFolderNav() {
  folderNav.innerHTML = "";

  markdownFiles.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "folder-item";
    button.textContent = entry.path;
    button.dataset.path = entry.path;
    button.addEventListener("click", () => openFolderMarkdown(entry.path));
    folderNav.appendChild(button);
  });

  folderSection.hidden = markdownFiles.length === 0;
}

function setActiveFolderItem(path) {
  [...folderNav.querySelectorAll(".folder-item")].forEach((button) => {
    button.classList.toggle("is-active", button.dataset.path === path);
  });
}

async function openFolderMarkdown(path, { fragment = "", alreadyGuarded = false } = {}) {
  const entry = markdownFiles.find((file) => file.path === path);
  if (!entry) return;

  if (!alreadyGuarded && !(await confirmDiscardUnsavedChanges(`Opening ${entry.name}`))) return;

  const generation = ++documentOpenGeneration;

  clearBlockHistory();

  currentFile = null;
  currentFileHandle = null;
  currentFolderPath = path;
  currentMode = "folder";
  currentDownloadName = entry.name;
  setEncryptedDocumentState();
  resetRemoteContentPolicy();
  setActiveFolderItem(path);
  setStatus("Reading...");

  try {
    const file = await entry.handle.getFile();

    if (!enforceDocumentSizeLimit(file)) return;

    const text = await file.text();
    const markdownText = await readMarkdownDocumentText(text);

    if (generation !== documentOpenGeneration) return;

    fileNameEl.textContent = entry.path;
    fileSizeEl.textContent = formatBytes(file.size);
    markDocumentSaved(markdownText);
    await renderDocument(markdownText, { path: entry.path });
    updateSaveControls();
    scrollToDocumentFragment(fragment);
  } catch (error) {
    if (generation !== documentOpenGeneration) return;

    console.error(error);
    showError(error.message || "Something went wrong while reading the file.");
    setStatus("Error");
  }
}

async function openFolder() {
  if (!(await confirmDiscardUnsavedChanges("Opening another folder"))) return;

  if (!window.showDirectoryPicker) {
    showError("Folder opening is not supported in this browser. Use a Chromium-based browser, or open a single markdown file.");
    setStatus("Folder unsupported");
    return;
  }

  setStatus("Choosing folder...");

  try {
    const directoryHandle = await window.showDirectoryPicker({ mode: "read" });
    clearObjectUrls();
    currentFile = null;
    currentFileHandle = null;
    currentDirectoryHandle = directoryHandle;
    currentFolderPath = "";
    currentMode = "folder";
    folderFiles = new Map();
    markdownFiles = [];
    refreshFileBtn.disabled = true;
    refreshFolderBtn.disabled = true;
    fileNameEl.textContent = directoryHandle.name;
    fileSizeEl.textContent = "Folder";
    setStatus("Scanning folder...");

    await scanDirectory(directoryHandle);
    markdownFiles.sort((a, b) => a.path.localeCompare(b.path));
    renderFolderNav();
    refreshFolderBtn.disabled = false;
    updateRevealControl();

    if (!markdownFiles.length) {
      currentFolderPath = "";
      refreshFileBtn.disabled = true;
      showError("This folder does not contain markdown files.");
      setStatus("No markdown files");
      return;
    }

    await openFolderMarkdown(markdownFiles[0].path, { alreadyGuarded: true });
  } catch (error) {
    if (error.name === "AbortError") {
      setStatus("Ready");
      return;
    }

    console.error(error);
    showError(error.message || "Could not open this folder.");
    setStatus("Error");
  }
}

async function refreshCurrentFile() {
  if (!(await confirmDiscardUnsavedChanges("Reloading this file from disk"))) return;

  if (currentMode === "folder" && currentFolderPath) {
    await openFolderMarkdown(currentFolderPath, { alreadyGuarded: true });
    return;
  }

  if (currentMode !== "file") return;

  setStatus("Refreshing file...");

  try {
    const file = currentFileHandle ? await currentFileHandle.getFile() : currentFile;
    await openMarkdownFile(file, currentFileHandle, { alreadyGuarded: true });
  } catch (error) {
    console.error(error);
    showError(error.message || "Could not refresh this file.");
    setStatus("Error");
  }
}

async function refreshCurrentFolder() {
  if (!currentDirectoryHandle) return;
  if (!(await confirmDiscardUnsavedChanges("Rescanning the folder"))) return;

  const pathToReopen = currentFolderPath;
  setStatus("Refreshing folder...");

  try {
    clearObjectUrls();
    folderFiles = new Map();
    markdownFiles = [];
    folderNav.innerHTML = "";

    await scanDirectory(currentDirectoryHandle);
    markdownFiles.sort((a, b) => a.path.localeCompare(b.path));
    renderFolderNav();
    refreshFolderBtn.disabled = false;

    if (!markdownFiles.length) {
      currentFolderPath = "";
      refreshFileBtn.disabled = true;
      showError("This folder does not contain markdown files.");
      setStatus("No markdown files");
      return;
    }

    const nextPath = markdownFiles.some((entry) => entry.path === pathToReopen)
      ? pathToReopen
      : markdownFiles[0].path;
    await openFolderMarkdown(nextPath, { alreadyGuarded: true });
  } catch (error) {
    console.error(error);
    showError(error.message || "Could not refresh this folder.");
    setStatus("Error");
  }
}

openFileBtn.addEventListener("click", () => {
  openFile();
});

createBtn.addEventListener("click", () => {
  createDocument().catch((error) => {
    console.error(error);
    showError(error.message || "Could not create a new document.");
    setStatus("Error");
  });
});

cheatsheetBtn.addEventListener("click", () => {
  openCheatsheet();
});

editBtn.addEventListener("click", () => {
  editCurrentDocument().catch((error) => {
    console.error(error);
    showError(error.message || "Could not edit this document.");
    setStatus("Error");
  });
});

downloadBtn.addEventListener("click", () => {
  downloadCurrentMarkdown();
});

encryptionBtn.addEventListener("click", () => {
  handleEncryptionAction().catch((error) => {
    console.error(error);
    setStatus(error.message || "Could not use encryption");
  });
});

googleSignInBtn.addEventListener("click", () => {
  const action = masterCryptoKey && googleProfile ? openAccountMenu() : signInForEncryption();

  action.catch((error) => {
    console.error(error);
    setStatus(error.message || "Could not sign in");
    updateEncryptionControls();
  });
});

function handleSaveClick() {
  if (saveBtn.disabled) return;

  saveCurrentMarkdownToOriginal().catch((error) => {
    if (error.name === "AbortError") {
      setStatus("Save cancelled");
      return;
    }

    console.error(error);
    setStatus(error.message || "Could not save this file");
  });
}

saveBtn.addEventListener("click", handleSaveClick);
quickSaveBtn.addEventListener("click", handleSaveClick);

saveAsBtn.addEventListener("click", () => {
  saveCurrentMarkdownAs().catch((error) => {
    if (error.name === "AbortError") {
      setStatus("Save as cancelled");
      return;
    }

    console.error(error);
    setStatus(error.message || "Could not save this file");
  });
});

returnToReadBtn.addEventListener("click", () => {
  returnToRead().catch((error) => {
    console.error(error);
    showError(error.message || "Could not return to reading.");
    setStatus("Error");
  });
});

["mouseenter", "focus"].forEach((eventName) => {
  returnToReadBtn.addEventListener(eventName, () => {
    returnToReadBtn.textContent = "Discard changes";
  });
});

["mouseleave", "blur"].forEach((eventName) => {
  returnToReadBtn.addEventListener(eventName, () => {
    returnToReadBtn.textContent = "Return to read";
  });
});

markdownInput.addEventListener("input", () => {
  updateDirtyIndicator();
  scheduleEditorPreview();
});

["click", "keyup", "select", "focus"].forEach((eventName) => {
  markdownInput.addEventListener(eventName, schedulePreviewCursorSync);
});

editorPreview.addEventListener("click", (event) => {
  if (event.target.closest("a, img")) return;

  moveEditorCursorToPreviewTarget(event.target);
});

topbarLockBtn.addEventListener("click", () => {
  setTopbarLocked(!document.body.classList.contains("topbar-locked"));
});

revealBtn.addEventListener("click", () => {
  revealCurrentLocation();
});

fileInput.addEventListener("change", (e) => {
  // The picker was opened from openFile(), which already asked about unsaved
  // work, so this path does not ask a second time.
  openMarkdownFile(e.target.files?.[0], null, { alreadyGuarded: true }).catch((error) => {
    console.error(error);
    setStatus(error.message || "Could not open this file");
  });
});

folderBtn.addEventListener("click", () => {
  openFolder();
});

refreshFileBtn.addEventListener("click", () => {
  refreshCurrentFile();
});

refreshFolderBtn.addEventListener("click", () => {
  refreshCurrentFolder();
});

// Loading remote content is a per-document decision, so a re-render is the
// simplest way to keep the reader and the editor preview agreeing about it.
function reRenderAfterRemotePolicyChange() {
  remoteContentNotice.hidden = true;

  const rerender = editorShell.hidden
    ? renderDocument(currentMarkdownText, currentRenderContext)
    : renderEditorPreview();

  rerender.catch((error) => {
    console.error(error);
    setStatus(error.message || "Could not load remote content");
  });
}

remoteContentLoadBtn.addEventListener("click", () => {
  remoteContentUnlocked = true;
  reRenderAfterRemotePolicyChange();
});

remoteContentAllowBtn.addEventListener("click", () => {
  trustRemoteHosts(blockedRemoteHosts);
  reRenderAfterRemotePolicyChange();
});

confirmDialogPrimary.addEventListener("click", () => closeConfirmDialog("primary"));
confirmDialogSecondary.addEventListener("click", () => closeConfirmDialog("secondary"));
confirmDialogCancel.addEventListener("click", () => closeConfirmDialog("cancel"));
confirmDialogBackdrop.addEventListener("click", () => closeConfirmDialog("cancel"));

imagePreviewClose.addEventListener("click", () => {
  closeImagePreview();
});

cheatsheetClose.addEventListener("click", () => {
  closeCheatsheet();
});

cheatsheetBackdrop.addEventListener("click", () => {
  closeCheatsheet();
});

imagePreviewStage.addEventListener("click", (event) => {
  if (event.target === imagePreviewStage && !previewWasDragged) {
    closeImagePreview();
  }
});

imagePreviewStage.addEventListener(
  "wheel",
  (event) => {
    if (imagePreview.hidden) return;

    event.preventDefault();
    const zoomFactor = event.deltaY < 0 ? 1.12 : 0.88;
    zoomImagePreview(previewScale * zoomFactor);
  },
  { passive: false },
);

imagePreviewStage.addEventListener("dblclick", () => {
  zoomImagePreview(previewScale === 1 ? 2 : 1);
});

imagePreviewStage.addEventListener("pointerdown", (event) => {
  if (imagePreview.hidden) return;

  imagePreviewStage.setPointerCapture(event.pointerId);
  previewPointers.set(event.pointerId, event);
  previewWasDragged = false;

  if (previewPointers.size === 1) {
    previewIsDragging = true;
    previewStartX = event.clientX;
    previewStartY = event.clientY;
    previewStartTranslateX = previewX;
    previewStartTranslateY = previewY;
    imagePreviewStage.classList.add("is-dragging");
  }

  if (previewPointers.size === 2) {
    previewStartDistance = getPointerDistance();
    previewStartScale = previewScale;
  }
});

imagePreviewStage.addEventListener("pointermove", (event) => {
  if (!previewPointers.has(event.pointerId)) return;

  previewPointers.set(event.pointerId, event);

  if (previewPointers.size >= 2 && previewStartDistance > 0) {
    zoomImagePreview(previewStartScale * (getPointerDistance() / previewStartDistance));
    previewWasDragged = true;
    return;
  }

  if (!previewIsDragging || previewScale <= 1) return;

  const deltaX = event.clientX - previewStartX;
  const deltaY = event.clientY - previewStartY;
  if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
    previewWasDragged = true;
  }

  previewX = previewStartTranslateX + deltaX;
  previewY = previewStartTranslateY + deltaY;
  setPreviewTransform();
});

["pointerup", "pointercancel", "pointerleave"].forEach((eventName) => {
  imagePreviewStage.addEventListener(eventName, (event) => {
    previewPointers.delete(event.pointerId);

    if (previewPointers.size < 2) {
      previewStartDistance = 0;
    }

    if (previewPointers.size === 0) {
      previewIsDragging = false;
      imagePreviewStage.classList.remove("is-dragging");
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (!confirmDialog.hidden) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeConfirmDialog("cancel");
      return;
    }

    trapDialogFocus(confirmDialog, event);
    return;
  }

  if (!imagePreview.hidden) {
    if (event.key === "Escape") {
      closeImagePreview();
      return;
    }

    trapDialogFocus(imagePreview, event);
    return;
  }

  if (!cheatsheetDialog.hidden) {
    if (event.key === "Escape") {
      closeCheatsheet();
      return;
    }

    trapDialogFocus(cheatsheetDialog, event);
    return;
  }

  if (event.key === "Escape") {
    hideMarkdownComments();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".md-comment")) return;

  hideMarkdownComments();
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("is-dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("is-dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer?.files?.[0];

  if (!file) return;

  openMarkdownFile(file).catch((error) => {
    console.error(error);
    setStatus(error.message || "Could not open the dropped file");
  });
});

if ("launchQueue" in window && "LaunchParams" in window) {
  window.launchQueue.setConsumer((launchParams) => {
    const [fileHandle] = launchParams.files || [];

    if (!fileHandle) return;

    fileHandle
      .getFile()
      .then((file) => openMarkdownFile(file, fileHandle))
      .catch((error) => {
        console.error(error);
        showError(error.message || "Could not open the launched file.");
        setStatus("Error");
      });
  });
}

exportBtn.addEventListener("click", async () => {
  if (reader.hidden && editorShell.hidden) return;

  const isEditing = !editorShell.hidden;

  if (isEditing) {
    window.clearTimeout(editorPreviewTimer);

    try {
      await renderEditorPreview();
    } catch (error) {
      console.error(error);
      showPreviewError(error.message || "Could not prepare the PDF preview.");
      return;
    }
  }

  // Printing before the images have loaded leaves empty boxes in the PDF.
  // This matters most when editing, where the preview is re-rendered on the
  // line above and every image starts loading from scratch, but the reader can
  // hit it too when the export is clicked straight after opening a document.
  const printRoot = isEditing ? editorPreview : reader;

  if ([...printRoot.querySelectorAll("img")].some((image) => !image.complete)) {
    setStatus("Preparing images...");
    await awaitImages(printRoot);
    setStatus(isEditing ? "Editing" : "Rendered");
  }

  window.print();
});

returnTopBtn.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

waitForMarkdownRenderer()
  .then(() => setStatus("Ready"))
  .catch((error) => {
    console.error(error);
    showError(error.message);
    setStatus("Renderer error");
  });

showEmpty();

if ("serviceWorker" in navigator) {
  let refreshing = false;
  // On a first visit the worker activates and calls clients.claim(), which
  // fires controllerchange even though nothing was updated. Reloading there
  // would restart the app every time someone opens it for the first time.
  let hasController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hasController) {
      hasController = true;
      return;
    }

    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        scope: "./",
      });

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;

        if (!installing) return;

        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            handleServiceWorkerUpdate(registration);
          }
        });
      });

      await registration.update();

      if (registration.waiting && navigator.serviceWorker.controller) {
        handleServiceWorkerUpdate(registration);
      }
    } catch (err) {
      console.warn("Service worker registration failed:", err);
    }
  });
}
