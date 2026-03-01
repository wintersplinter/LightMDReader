/* global marked, DOMPurify */

const fileInput = document.getElementById("fileInput");
const exportBtn = document.getElementById("exportBtn");

const emptyState = document.getElementById("emptyState");
const reader = document.getElementById("reader");

const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
}

function renderMarkdown(mdText) {
  // Marked -> HTML
  const rawHtml = marked.parse(mdText, {
    gfm: true,
    breaks: false,
  });

  // Sanitize HTML
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
  });

  reader.innerHTML = safeHtml;
  reader.hidden = false;
  emptyState.hidden = true;
  exportBtn.disabled = false;
}

fileInput.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatBytes(file.size);

  const text = await file.text();
  renderMarkdown(text);

  // Allow re-opening the same file again later
  fileInput.value = "";
});

exportBtn.addEventListener("click", () => {
  // Uses print CSS in styles.css
  window.print();
});

// PWA: register service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("./sw.js", { scope: "./" });
    } catch (err) {
      console.warn("Service worker registration failed:", err);
    }
  });
}
