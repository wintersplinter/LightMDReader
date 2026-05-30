/* global DOMPurify */

const fileInput = document.getElementById("fileInput");
const exportBtn = document.getElementById("exportBtn");
const dropZone = document.getElementById("dropZone");

const emptyState = document.getElementById("emptyState");
const errorState = document.getElementById("errorState");
const errorMessage = document.getElementById("errorMessage");
const reader = document.getElementById("reader");

const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const statusText = document.getElementById("statusText");
const themeSelect = document.getElementById("themeSelect");
const availableThemes = new Set(["dark", "light", "brown"]);

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
  emptyState.hidden = false;
  errorState.hidden = true;
  reader.hidden = true;
  exportBtn.disabled = true;
}

function showError(message) {
  errorMessage.textContent = message;
  emptyState.hidden = true;
  errorState.hidden = false;
  reader.hidden = true;
  exportBtn.disabled = true;
}

function showReader(html) {
  reader.innerHTML = html;
  reader.hidden = false;
  emptyState.hidden = true;
  errorState.hidden = true;
  exportBtn.disabled = false;
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

async function renderDocument(markdownText) {
  setStatus("Loading renderer...");
  await waitForMarkdownRenderer();

  setStatus("Rendering...");
  const rawHtml = window.renderMarkdown(markdownText);
  const safeHtml = sanitizeHtml(rawHtml);
  showReader(safeHtml);
  setStatus("Rendered");
}

async function openMarkdownFile(file) {
  if (!file) return;

  if (!/\.(md|markdown|txt)$/i.test(file.name)) {
    showError("Choose a markdown or plain text file.");
    setStatus("Unsupported file");
    return;
  }

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

fileInput.addEventListener("change", (e) => {
  openMarkdownFile(e.target.files?.[0]);
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
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (err) {
      console.warn("Service worker registration failed:", err);
    }
  });
}
