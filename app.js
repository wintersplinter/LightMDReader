/* global DOMPurify */

const fileInput = document.getElementById("fileInput");
const openFileBtn = document.getElementById("openFileBtn");
const folderBtn = document.getElementById("folderBtn");
const createBtn = document.getElementById("createBtn");
const editBtn = document.getElementById("editBtn");
const downloadBtn = document.getElementById("downloadBtn");
const saveBtn = document.getElementById("saveBtn");
const saveAsBtn = document.getElementById("saveAsBtn");
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
const availableThemes = new Set(["dark", "light", "brown"]);
const availablePdfPaperSizes = new Set(["browser", "a4", "letter"]);
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
let currentMarkdownText = "";
let currentDownloadName = "document.md";
let currentRenderContext = null;
let editorPreviewTimer = null;
let editorScrollTimer = null;
let suppressPreviewCursorSyncUntil = 0;
let readingSnapshot = null;
let saveConfirmPending = false;
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
  const markdownText = editorShell.hidden ? currentMarkdownText : markdownInput.value;
  if (!markdownText && currentMode === "empty") return;

  const blob = new Blob([markdownText], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = getDownloadFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Downloaded");
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
  await writeMarkdownToHandle(fileHandle, markdownText);

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
  await writeMarkdownToHandle(fileHandle, markdownText);

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
  currentDownloadName = entry.name;
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

createBtn.addEventListener("click", () => {
  createDocument().catch((error) => {
    console.error(error);
    showError(error.message || "Could not create a new document.");
    setStatus("Error");
  });
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
