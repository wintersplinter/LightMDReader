/* global DOMPurify */

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
const encryptionBtn = document.getElementById("encryptionBtn");
const googleSignInBtn = document.getElementById("googleSignInBtn");
const refreshFileBtn = document.getElementById("refreshFileBtn");
const refreshFolderBtn = document.getElementById("refreshFolderBtn");
const exportBtn = document.getElementById("exportBtn");
const topbarLockBtn = document.getElementById("topbarLockBtn");
const listMarkerBtn = document.getElementById("listMarkerBtn");
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
const themeSelect = document.getElementById("themeSelect");
const pdfPaperSelect = document.getElementById("pdfPaperSelect");
const imagePreview = document.getElementById("imagePreview");
const imagePreviewStage = document.getElementById("imagePreviewStage");
const imagePreviewImg = document.getElementById("imagePreviewImg");
const imagePreviewClose = document.getElementById("imagePreviewClose");
const cheatsheetDialog = document.getElementById("cheatsheetDialog");
const cheatsheetBackdrop = document.getElementById("cheatsheetBackdrop");
const cheatsheetClose = document.getElementById("cheatsheetClose");
const cheatsheetContent = document.getElementById("cheatsheetContent");
const availableThemes = new Set(["dark", "light", "brown"]);
const availablePdfPaperSizes = new Set(["browser", "a4", "letter"]);
const markdownFilePattern = /\.(md|markdown|txt)$/i;
const imageFilePattern = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const externalUrlPattern = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;
const encryptedDocumentFormat = "lightmdreader-encrypted-v1";
const encryptionKeyFileName = "lightmdreader-key-v1.json";
const googleDriveAppDataScope = "https://www.googleapis.com/auth/drive.appdata";
const googleIdentityScope = "openid profile email";
const googleScopes = `${googleIdentityScope} ${googleDriveAppDataScope}`;
const googleClientId = window.LightMDReaderConfig?.googleClientId || "";

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
let saveConfirmPending = false;
let googleTokenClient = null;
let googleAccessToken = "";
let googleAccessTokenExpiresAt = 0;
let googleProfile = null;
let masterKeyBytes = null;
let masterCryptoKey = null;
let masterKeyId = "";
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
      ? `Signed in as ${googleProfile.email || googleProfile.name}`
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

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function createKeyId(bytes) {
  return bytesToBase64(bytes.slice(0, 12)).replace(/[+/=]/g, "");
}

async function importMasterKey(bytes) {
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function parseEncryptedDocument(text) {
  const trimmed = text.trim();

  if (!trimmed.startsWith("{")) return null;

  try {
    const payload = JSON.parse(trimmed);

    if (payload?.format !== encryptedDocumentFormat) return null;
    if (payload.cipher !== "AES-GCM" || !payload.iv || !payload.data) {
      throw new Error("This encrypted document has an unsupported format.");
    }

    return payload;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

async function encryptMarkdownDocument(markdownText) {
  await ensureEncryptionReady();

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(markdownText);
  const encryptedBytes = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, masterCryptoKey, encodedText));

  return `${JSON.stringify(
    {
      format: encryptedDocumentFormat,
      version: 1,
      cipher: "AES-GCM",
      keyId: masterKeyId,
      iv: bytesToBase64(iv),
      data: bytesToBase64(encryptedBytes),
    },
    null,
    2,
  )}\n`;
}

async function decryptMarkdownDocument(payload) {
  await ensureEncryptionReady();

  if (payload.keyId && masterKeyId && payload.keyId !== masterKeyId) {
    const shouldImportRecoveryKey = window.confirm(
      "This document was encrypted with another LightMDReader key. Choose OK to import a recovery key, or Cancel to stop.",
    );

    if (!shouldImportRecoveryKey) {
      throw new Error("This document was encrypted with another LightMDReader key.");
    }

    await importRecoveryKey();
  }

  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.data);

  try {
    const decryptedBytes = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, masterCryptoKey, data);
    return new TextDecoder().decode(decryptedBytes);
  } catch (error) {
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
  if (!masterKeyBytes || !googleProfile) return;

  const recoveryKey = {
    format: "lightmdreader-recovery-key-v1",
    keyId: masterKeyId,
    email: googleProfile.email || "",
    createdAt: new Date().toISOString(),
    key: bytesToBase64(masterKeyBytes),
  };

  downloadTextFile("LightMDReader-recovery-key.json", `${JSON.stringify(recoveryKey, null, 2)}\n`);
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

function requestGoogleAccessToken(prompt = "") {
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

async function findDriveKeyFile() {
  const query = encodeURIComponent(`name='${encryptionKeyFileName}' and trashed=false`);
  const response = await googleFetch(
    `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(id,name,modifiedTime)`,
  );
  const result = await response.json();

  return result.files?.[0] || null;
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

async function importRecoveryKey() {
  const text = await chooseRecoveryKeyText();
  const recoveryKey = JSON.parse(text);

  if (recoveryKey.format !== "lightmdreader-recovery-key-v1" || !recoveryKey.key) {
    throw new Error("This is not a supported LightMDReader recovery key.");
  }

  masterKeyBytes = base64ToBytes(recoveryKey.key);
  masterKeyId = recoveryKey.keyId || createKeyId(masterKeyBytes);
  masterCryptoKey = await importMasterKey(masterKeyBytes);

  await updateDriveKeyFile({
    format: "lightmdreader-key-v1",
    keyId: masterKeyId,
    restoredAt: new Date().toISOString(),
    key: bytesToBase64(masterKeyBytes),
  });

  updateEncryptionControls();
}

async function loadOrCreateMasterKey() {
  const keyFile = await findDriveKeyFile();

  if (keyFile) {
    driveKeyFileId = keyFile.id;
    const keyRecord = await readDriveKeyFile(keyFile.id);

    if (keyRecord.format !== "lightmdreader-key-v1" || !keyRecord.key) {
      throw new Error("The LightMDReader key in Google Drive App Data is not supported.");
    }

    masterKeyBytes = base64ToBytes(keyRecord.key);
    masterKeyId = keyRecord.keyId || createKeyId(masterKeyBytes);
    masterCryptoKey = await importMasterKey(masterKeyBytes);
    return;
  }

  const shouldCreateKey = window.confirm(
    "No LightMDReader encryption key was found in Google Drive App Data. Choose OK to create a new key, or Cancel to import a recovery key.",
  );

  if (!shouldCreateKey) {
    await importRecoveryKey();
    setStatus("Recovery key imported.");
    return;
  }

  masterKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  masterKeyId = createKeyId(masterKeyBytes);
  masterCryptoKey = await importMasterKey(masterKeyBytes);

  await createDriveKeyFile({
    format: "lightmdreader-key-v1",
    keyId: masterKeyId,
    createdAt: new Date().toISOString(),
    key: bytesToBase64(masterKeyBytes),
  });

  downloadRecoveryKey();
  setStatus("Encryption key created. Recovery key downloaded.");
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

async function readMarkdownDocumentText(text) {
  const encryptedPayload = parseEncryptedDocument(text);

  if (!encryptedPayload) {
    setEncryptedDocumentState();
    return text;
  }

  setStatus("Unlocking encrypted document...");
  const markdownText = await decryptMarkdownDocument(encryptedPayload);

  setEncryptedDocumentState({
    encrypted: true,
    unlocked: true,
    keyId: encryptedPayload.keyId || "",
  });

  return markdownText;
}

async function getCurrentStorageTextForWrite() {
  const markdownText = getCurrentMarkdownForWrite();

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

function resetSaveConfirmation() {
  saveConfirmPending = false;
  saveBtn.textContent = "Save";
  saveBtn.classList.remove("is-confirming");
  saveBtn.setAttribute("aria-label", "Save to original file");
  saveBtn.title = "Save to original file";
}

function canSaveOriginal() {
  return Boolean(getCurrentWritableHandle()?.createWritable);
}

function updateSaveControls() {
  resetSaveConfirmation();
  const hasDocument = currentMode !== "empty";

  saveBtn.disabled = !canSaveOriginal();
  saveAsBtn.disabled = !hasDocument || !window.showSaveFilePicker;
  updateEncryptionControls();
}

function applyTheme(theme) {
  const safeTheme = availableThemes.has(theme) ? theme : "dark";
  document.documentElement.setAttribute("data-theme", safeTheme);
  localStorage.setItem("lightmdreader-theme", safeTheme);
  themeSelect.value = safeTheme;
}

const savedTheme = localStorage.getItem("lightmdreader-theme") || "dark";
applyTheme(savedTheme);

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
window.addEventListener("beforeunload", (event) => {
  event.preventDefault();
  event.returnValue = "";
});

function setListMarkersEnabled(isEnabled) {
  document.body.classList.toggle("list-markers-enabled", isEnabled);
  localStorage.setItem("lightmdreader-list-markers", isEnabled ? "true" : "false");
  listMarkerBtn.setAttribute("aria-pressed", String(isEnabled));
  listMarkerBtn.setAttribute("aria-label", isEnabled ? "Hide list markers" : "Show list markers");
  listMarkerBtn.title = isEnabled ? "Hide list markers" : "Show list markers";
}

setListMarkersEnabled(localStorage.getItem("lightmdreader-list-markers") === "true");
updateEncryptionControls();

themeSelect.addEventListener("change", (e) => {
  applyTheme(e.target.value);
});

pdfPaperSelect.addEventListener("change", (e) => {
  setPdfPaperSize(e.target.value);
});

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

function normalizePath(path) {
  const parts = [];

  path
    .replace(/\\/g, "/")
    .split("/")
    .forEach((part) => {
      if (!part || part === ".") return;
      if (part === "..") {
        parts.pop();
        return;
      }
      parts.push(part);
    });

  return parts.join("/");
}

function dirname(path) {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(0, index) : "";
}

function resolveRelativePath(fromPath, targetPath) {
  const cleanTarget = targetPath.split("#")[0].split("?")[0];
  const decodedTarget = decodeURIComponent(cleanTarget);
  const basePath = dirname(fromPath);

  return normalizePath(basePath ? `${basePath}/${decodedTarget}` : decodedTarget);
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
  emptyState.hidden = false;
  errorState.hidden = true;
  reader.hidden = true;
  editorShell.hidden = true;
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
  exportBtn.disabled = true;
  returnToReadBtn.hidden = true;
  downloadBtn.disabled = true;
  editBtn.disabled = true;
  refreshFileBtn.disabled = true;
  updateSaveControls();
  saveBtn.disabled = true;
  saveAsBtn.disabled = true;
  updateEncryptionControls();
}

function showReader(html) {
  clearObjectUrls();
  document.body.classList.remove("editor-active");
  reader.innerHTML = html;
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
  updateSaveControls();
}

function showEditor(markdownText) {
  clearObjectUrls();
  clearTableOfContents();
  document.body.classList.add("editor-active");
  markdownInput.value = markdownText;
  reader.hidden = true;
  editorShell.hidden = false;
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

function slugifyHeading(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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

function sanitizeHtml(html) {
  if (!window.DOMPurify) {
    throw new Error("The sanitizer did not load.");
  }

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel", "data-source-line", "tabindex", "aria-label", "aria-hidden"],
  });
}

async function hydrateLocalImages(context) {
  if (!context?.path || !folderFiles.size) return;

  const images = [...reader.querySelectorAll("img[src]")];

  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute("src");

      if (!src || externalUrlPattern.test(src)) return;

      const imagePath = resolveRelativePath(context.path, src);
      const handle = folderFiles.get(imagePath);

      if (!handle || !imageFilePattern.test(imagePath)) return;

      try {
        const file = await handle.getFile();
        const objectUrl = URL.createObjectURL(file);
        objectUrls.push(objectUrl);
        image.src = objectUrl;
      } catch (error) {
        console.warn(`Could not load local image: ${imagePath}`, error);
      }
    }),
  );
}

async function hydratePreviewLocalImages(root, context) {
  if (!context?.path || !folderFiles.size) return;

  const images = [...root.querySelectorAll("img[src]")];

  await Promise.all(
    images.map(async (image) => {
      const src = image.getAttribute("src");

      if (!src || externalUrlPattern.test(src)) return;

      const imagePath = resolveRelativePath(context.path, src);
      const handle = folderFiles.get(imagePath);

      if (!handle || !imageFilePattern.test(imagePath)) return;

      try {
        const file = await handle.getFile();
        const objectUrl = URL.createObjectURL(file);
        objectUrls.push(objectUrl);
        image.src = objectUrl;
      } catch (error) {
        console.warn(`Could not load local image: ${imagePath}`, error);
      }
    }),
  );
}

function wireLocalMarkdownLinks(context, root = reader) {
  if (!context?.path || !markdownFiles.length) return;

  [...root.querySelectorAll("a[href]")].forEach((link) => {
    const href = link.getAttribute("href");

    if (!href || externalUrlPattern.test(href)) return;

    const targetPath = resolveRelativePath(context.path, href);
    const targetExists = markdownFiles.some((entry) => entry.path === targetPath);

    if (!targetExists) return;

    link.addEventListener("click", (event) => {
      event.preventDefault();
      openFolderMarkdown(targetPath);
    });
  });
}

async function renderDocument(markdownText, context = null) {
  currentMarkdownText = markdownText;
  currentRenderContext = context;
  setStatus("Loading renderer...");
  await waitForMarkdownRenderer();

  setStatus("Rendering...");
  const rawHtml = window.renderMarkdown(markdownText);
  const safeHtml = sanitizeHtml(rawHtml);
  showReader(safeHtml);
  await hydrateLocalImages(context);
  wireLocalMarkdownLinks(context);
  wireImagePreview();
  wireMarkdownComments();
  setStatus("Rendered");
}

async function renderEditorPreview() {
  const markdownText = markdownInput.value;
  currentMarkdownText = markdownText;
  updateFileSize(markdownText);
  setStatus("Rendering preview...");
  await waitForMarkdownRenderer();

  const rawHtml = window.renderMarkdown(markdownText);
  const safeHtml = sanitizeHtml(rawHtml);
  clearObjectUrls();
  editorPreview.innerHTML = safeHtml || "<p></p>";
  await hydratePreviewLocalImages(editorPreview, currentRenderContext);
  wireLocalMarkdownLinks(currentRenderContext, editorPreview);
  wireImagePreview(editorPreview);
  wireMarkdownComments(editorPreview);
  syncPreviewToCursor();
  setStatus("Editing");
}

function scheduleEditorPreview() {
  window.clearTimeout(editorPreviewTimer);
  editorPreviewTimer = window.setTimeout(() => {
    renderEditorPreview().catch((error) => {
      console.error(error);
      showError(error.message || "Could not render the preview.");
      setStatus("Error");
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
  window.scrollTo({ top: snapshot.scrollY, behavior: "auto" });
}

async function createDocument() {
  captureReadingSnapshot();
  currentFile = null;
  currentFileHandle = null;
  currentMode = "create";
  currentRenderContext = null;
  currentDownloadName = "untitled.md";
  currentMarkdownText = "# Untitled\n\n";
  setEncryptedDocumentState();
  fileNameEl.textContent = "Untitled";
  refreshFileBtn.disabled = true;
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
    resetSaveConfirmation();
    setStatus("Encryption on. Save or download to write encrypted content.");
    return;
  }

  const markdownText = getCurrentMarkdownForWrite();
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
  return editorShell.hidden ? currentMarkdownText : markdownInput.value;
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
  }
}

async function saveCurrentMarkdownToOriginal() {
  const fileHandle = getCurrentWritableHandle();
  const markdownText = getCurrentMarkdownForWrite();

  if (!fileHandle?.createWritable || currentMode === "empty") {
    setStatus("Original save unavailable");
    return;
  }

  setStatus("Saving...");
  const storageText = await getCurrentStorageTextForWrite();
  await writeMarkdownToHandle(fileHandle, storageText);

  const file = fileHandle.getFile ? await fileHandle.getFile() : null;
  syncSavedDocumentState(markdownText, file);
  resetSaveConfirmation();
  updateSaveControls();
  setStatus("Saved to original file");
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
}

function clearFolderMode() {
  currentDirectoryHandle = null;
  currentFolderPath = "";
  folderFiles = new Map();
  markdownFiles = [];
  folderNav.innerHTML = "";
  folderSection.hidden = true;
  refreshFolderBtn.disabled = true;
}

function setSingleFileMode(file, fileHandle = null) {
  clearFolderMode();
  currentFile = file;
  currentFileHandle = fileHandle;
  currentMode = "file";
  currentDownloadName = file.name;
  setEncryptedDocumentState();
}

async function openMarkdownFile(file, fileHandle = null) {
  if (!file) return;

  if (!markdownFilePattern.test(file.name)) {
    showError("Choose a markdown or plain text file.");
    setStatus("Unsupported file");
    return;
  }

  setSingleFileMode(file, fileHandle);
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);
  setStatus("Reading...");

  try {
    const text = await file.text();
    const markdownText = await readMarkdownDocumentText(text);
    await renderDocument(markdownText);
  } catch (error) {
    console.error(error);
    showError(error.message || "Something went wrong while reading the file.");
    setStatus("Error");
  } finally {
    fileInput.value = "";
  }
}

async function openFile() {
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
    await openMarkdownFile(file, fileHandle);
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

async function scanDirectory(directoryHandle, basePath = "") {
  for await (const [name, handle] of directoryHandle.entries()) {
    const path = basePath ? `${basePath}/${name}` : name;

    if (handle.kind === "directory") {
      await scanDirectory(handle, path);
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

async function openFolderMarkdown(path) {
  const entry = markdownFiles.find((file) => file.path === path);
  if (!entry) return;

  currentFile = null;
  currentFileHandle = null;
  currentFolderPath = path;
  currentMode = "folder";
  currentDownloadName = entry.name;
  setEncryptedDocumentState();
  setActiveFolderItem(path);
  setStatus("Reading...");

  try {
    const file = await entry.handle.getFile();
    const text = await file.text();
    const markdownText = await readMarkdownDocumentText(text);
    fileNameEl.textContent = entry.path;
    fileSizeEl.textContent = formatBytes(file.size);
    await renderDocument(markdownText, { path: entry.path });
  } catch (error) {
    console.error(error);
    showError(error.message || "Something went wrong while reading the file.");
    setStatus("Error");
  }
}

async function openFolder() {
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

    if (!markdownFiles.length) {
      currentFolderPath = "";
      refreshFileBtn.disabled = true;
      showError("This folder does not contain markdown files.");
      setStatus("No markdown files");
      return;
    }

    await openFolderMarkdown(markdownFiles[0].path);
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
  if (currentMode === "folder" && currentFolderPath) {
    await openFolderMarkdown(currentFolderPath);
    return;
  }

  if (currentMode !== "file") return;

  setStatus("Refreshing file...");

  try {
    const file = currentFileHandle ? await currentFileHandle.getFile() : currentFile;
    await openMarkdownFile(file, currentFileHandle);
  } catch (error) {
    console.error(error);
    showError(error.message || "Could not refresh this file.");
    setStatus("Error");
  }
}

async function refreshCurrentFolder() {
  if (!currentDirectoryHandle) return;

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
    await openFolderMarkdown(nextPath);
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
  resetSaveConfirmation();
  downloadCurrentMarkdown();
});

encryptionBtn.addEventListener("click", () => {
  resetSaveConfirmation();
  handleEncryptionAction().catch((error) => {
    console.error(error);
    setStatus(error.message || "Could not use encryption");
  });
});

googleSignInBtn.addEventListener("click", () => {
  signInForEncryption().catch((error) => {
    console.error(error);
    setStatus(error.message || "Could not sign in");
    updateEncryptionControls();
  });
});

saveBtn.addEventListener("click", () => {
  if (saveBtn.disabled) return;

  if (!saveConfirmPending) {
    saveConfirmPending = true;
    saveBtn.textContent = "Overwrite original";
    saveBtn.classList.add("is-confirming");
    saveBtn.setAttribute("aria-label", "Overwrite the original file");
    saveBtn.title = "Click again to overwrite the original file";
    setStatus("Click Overwrite original to save");
    return;
  }

  saveCurrentMarkdownToOriginal().catch((error) => {
    resetSaveConfirmation();

    if (error.name === "AbortError") {
      setStatus("Save cancelled");
      return;
    }

    console.error(error);
    setStatus(error.message || "Could not save this file");
  });
});

saveAsBtn.addEventListener("click", () => {
  resetSaveConfirmation();
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
  resetSaveConfirmation();
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

listMarkerBtn.addEventListener("click", () => {
  setListMarkersEnabled(!document.body.classList.contains("list-markers-enabled"));
});

fileInput.addEventListener("change", (e) => {
  openMarkdownFile(e.target.files?.[0]);
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
  if (event.key === "Escape") {
    if (!imagePreview.hidden) {
      closeImagePreview();
      return;
    }

    closeCheatsheet();
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
  openMarkdownFile(event.dataTransfer?.files?.[0]);
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

  if (!editorShell.hidden) {
    window.clearTimeout(editorPreviewTimer);

    try {
      await renderEditorPreview();
    } catch (error) {
      console.error(error);
      showError(error.message || "Could not prepare the PDF preview.");
      setStatus("Error");
      return;
    }
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

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("./sw.js", {
        scope: "./",
      });
      await registration.update();
    } catch (err) {
      console.warn("Service worker registration failed:", err);
    }
  });
}
