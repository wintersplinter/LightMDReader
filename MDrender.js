function loadScript(src, callback) {
  const script = document.createElement("script");
  script.src = src;
  script.onload = callback;
  document.head.appendChild(script);
}

function loadScripts(scripts, callback) {
  if (scripts.length === 0) {
    callback();
    return;
  }

  const [first, ...rest] = scripts;
  loadScript(first, () => loadScripts(rest, callback));
}

loadScripts(
  [
    "https://cdn.jsdelivr.net/npm/markdown-it/dist/markdown-it.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-footnote/dist/markdown-it-footnote.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-deflist/dist/markdown-it-deflist.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-sub/dist/markdown-it-sub.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-sup/dist/markdown-it-sup.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-attrs/markdown-it-attrs.browser.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-task-lists/dist/markdown-it-task-lists.min.js",
  ],
  function () {
    const md = window
      .markdownit({
        html: true,
        linkify: true,
        typographer: true,
      })
      .use(window.markdownitFootnote)
      .use(window.markdownitDeflist)
      .use(window.markdownitSub)
      .use(window.markdownitSup)
      .use(window.markdownItAttrs)
      .use(window.markdownitTaskLists);

    function addCustomMarkdown(text) {
      return text.replace(/==([^=\n]+)==/g, "<mark>$1</mark>");
    }

    window.renderMarkdown = function (markdownText) {
      return md.render(addCustomMarkdown(markdownText));
    };

    window.markdownReady = true;
    window.dispatchEvent(new Event("markdown-ready"));

    const editor = document.getElementById("editor");
    const preview = document.getElementById("preview");

    if (editor && preview) {
      function update() {
        preview.innerHTML = window.renderMarkdown(editor.value);
      }

      editor.addEventListener("input", update);
      update();
    }
  },
);
