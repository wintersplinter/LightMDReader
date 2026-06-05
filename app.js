/* global DOMPurify */

const fileInput = document.getElementById("fileInput");
const openFileBtn = document.getElementById("openFileBtn");
const folderBtn = document.getElementById("folderBtn");
const refreshFileBtn = document.getElementById("refreshFileBtn");
const refreshFolderBtn = document.getElementById("refreshFolderBtn");
const exportBtn = document.getElementById("exportBtn");
const topbarLockBtn = document.getElementById("topbarLockBtn");
const dropZone = document.getElementById("dropZone");

const emptyState = document.getElementById("emptyState");
const errorState = document.getElementById("errorState");
const errorMessage = document.getElementById("errorMessage");
const reader = document.getElementById("reader");

const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const statusText = document.getElementById("statusText");
const tocSection = document.getElementById("tocSection");
const tocNav = document.getElementById("tocNav");
const folderSection = document.getElementById("folderSection");
const folderNav = document.getElementById("folderNav");
const themeSelect = document.getElementById("themeSelect");
const imagePreview = document.getElementById("imagePreview");
const imagePreviewStage = document.getElementById("imagePreviewStage");
const imagePreviewImg = document.getElementById("imagePreviewImg");
const imagePreviewClose = document.getElementById("imagePreviewClose");
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
const previewPointers = new Map();

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

function setTopbarLocked(isLocked) {
  document.body.classList.toggle("topbar-locked", isLocked);
  localStorage.setItem("lightmdreader-topbar-locked", isLocked ? "true" : "false");
  topbarLockBtn.innerHTML = isLocked ? "&#x1F512;&#xFE0E;" : "&#x1F513;&#xFE0E;";
  topbarLockBtn.setAttribute("aria-pressed", String(isLocked));
  topbarLockBtn.setAttribute("aria-label", isLocked ? "Unlock top menu" : "Lock top menu");
  topbarLockBtn.title = isLocked ? "Unlock top menu" : "Lock top menu";
}

setTopbarLocked(localStorage.getItem("lightmdreader-topbar-locked") === "true");

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
  emptyState.hidden = false;
  errorState.hidden = true;
  reader.hidden = true;
  exportBtn.disabled = true;
  refreshFileBtn.disabled = true;
}

function showError(message) {
  clearObjectUrls();
  clearTableOfContents();
  errorMessage.textContent = message;
  emptyState.hidden = true;
  errorState.hidden = false;
  reader.hidden = true;
  exportBtn.disabled = true;
}

function showReader(html) {
  clearObjectUrls();
  reader.innerHTML = html;
  buildTableOfContents();
  reader.hidden = false;
  emptyState.hidden = true;
  errorState.hidden = true;
  exportBtn.disabled = false;
  refreshFileBtn.disabled = currentMode === "empty";
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

function buildTableOfContents() {
  clearTableOfContents();

  const headings = [...reader.querySelectorAll("h1, h2, h3, h4, h5, h6")].filter(
    (heading) => heading.textContent.trim(),
  );

  if (!headings.length) return;

  const usedIds = new Map();

  headings.forEach((heading, index) => {
    const level = Number(heading.tagName.slice(1));
    const text = heading.textContent.trim();
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

function wireImagePreview() {
  [...reader.querySelectorAll("img[src]")].forEach((image) => {
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
  wireImagePreview();
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

topbarLockBtn.addEventListener("click", () => {
  setTopbarLocked(!document.body.classList.contains("topbar-locked"));
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
    closeImagePreview();
  }
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
