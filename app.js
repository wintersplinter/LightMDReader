/* global DOMPurify */

const fileInput = document.getElementById("fileInput");
const openFileBtn = document.getElementById("openFileBtn");
const folderBtn = document.getElementById("folderBtn");
const refreshFileBtn = document.getElementById("refreshFileBtn");
const refreshFolderBtn = document.getElementById("refreshFolderBtn");
const exportBtn = document.getElementById("exportBtn");
const dropZone = document.getElementById("dropZone");

const emptyState = document.getElementById("emptyState");
const errorState = document.getElementById("errorState");
const errorMessage = document.getElementById("errorMessage");
const reader = document.getElementById("reader");

const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const statusText = document.getElementById("statusText");
const folderSection = document.getElementById("folderSection");
const folderNav = document.getElementById("folderNav");
const themeSelect = document.getElementById("themeSelect");
const availableThemes = new Set(["dark", "light", "brown"]);
const markdownFilePattern = /\.(md|markdown|txt)$/i;
const imageFilePattern = /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const externalUrlPattern = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

let folderFiles = new Map();
let markdownFiles = [];
let objectUrls = [];
let currentFile = null;
let currentFileHandle = null;
let currentDirectoryHandle = null;
let currentFolderPath = "";
let currentMode = "empty";

function setStatus(message) {
  statusText.textContent = message;
}

function applyTheme(theme) {
  const safeTheme = availableThemes.has(theme) ? theme : "dark";
  document.documentElement.setAttribute("data-theme", safeTheme);
  localStorage.setItem("lightmdreader-theme", safeTheme);
  themeSelect.value = safeTheme;
}

const savedTheme = localStorage.getItem("lightmdreader-theme") || "dark";
applyTheme(savedTheme);

themeSelect.addEventListener("change", (e) => {
  applyTheme(e.target.value);
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
  emptyState.hidden = false;
  errorState.hidden = true;
  reader.hidden = true;
  exportBtn.disabled = true;
  refreshFileBtn.disabled = true;
}

function showError(message) {
  clearObjectUrls();
  errorMessage.textContent = message;
  emptyState.hidden = true;
  errorState.hidden = false;
  reader.hidden = true;
  exportBtn.disabled = true;
}

function showReader(html) {
  clearObjectUrls();
  reader.innerHTML = html;
  reader.hidden = false;
  emptyState.hidden = true;
  errorState.hidden = true;
  exportBtn.disabled = false;
  refreshFileBtn.disabled = currentMode === "empty";
}

function sanitizeHtml(html) {
  if (!window.DOMPurify) {
    throw new Error("The sanitizer did not load.");
  }

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["target", "rel"],
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

function wireLocalMarkdownLinks(context) {
  if (!context?.path || !markdownFiles.length) return;

  [...reader.querySelectorAll("a[href]")].forEach((link) => {
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
  setStatus("Loading renderer...");
  await waitForMarkdownRenderer();

  setStatus("Rendering...");
  const rawHtml = window.renderMarkdown(markdownText);
  const safeHtml = sanitizeHtml(rawHtml);
  showReader(safeHtml);
  await hydrateLocalImages(context);
  wireLocalMarkdownLinks(context);
  setStatus("Rendered");
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
    await renderDocument(text);
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
  setActiveFolderItem(path);
  setStatus("Reading...");

  try {
    const file = await entry.handle.getFile();
    const text = await file.text();
    fileNameEl.textContent = entry.path;
    fileSizeEl.textContent = formatBytes(file.size);
    await renderDocument(text, { path: entry.path });
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

exportBtn.addEventListener("click", () => {
  if (reader.hidden) return;
  window.print();
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
