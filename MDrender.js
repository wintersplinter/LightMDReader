(function () {
  const scripts = [
    "https://cdn.jsdelivr.net/npm/markdown-it@14.1.0/dist/markdown-it.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-footnote@4.0.0/dist/markdown-it-footnote.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-deflist@3.0.0/dist/markdown-it-deflist.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-sub@2.0.0/dist/markdown-it-sub.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-sup@2.0.0/dist/markdown-it-sup.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-mark@4.0.0/dist/markdown-it-mark.min.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-attrs@4.3.1/markdown-it-attrs.browser.js",
    "https://cdn.jsdelivr.net/npm/markdown-it-task-lists@2.1.1/dist/markdown-it-task-lists.min.js",
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);

      if (existing?.dataset.loaded === "true") {
        resolve();
        return;
      }

      const script = existing || document.createElement("script");

      script.src = src;
      script.async = false;

      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      });

      script.addEventListener("error", () => {
        reject(new Error(`Could not load ${src}`));
      });

      if (!existing) {
        document.head.appendChild(script);
      }
    });
  }

  function openLinksOutsidePreview(tokens, index, options, env, self) {
    const token = tokens[index];
    const hrefIndex = token.attrIndex("href");

    if (hrefIndex >= 0 && /^https?:\/\//i.test(token.attrs[hrefIndex][1])) {
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
    }

    return self.renderToken(tokens, index, options);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function renderCustomComments(markdownText) {
    return String(markdownText || "")
      .replace(/\(\(::([\s\S]*?)::\)\)/g, "")
      .replace(/\(\(:([\s\S]*?):\)\)/g, (_, comment) => {
        const cleanComment = comment.trim();

        if (!cleanComment) return "";

        const tooltip = escapeHtml(cleanComment);
        const label = escapeHtml(cleanComment.replace(/\s+/g, " "));

        return `<span class="md-comment" tabindex="0" aria-label="${label}"><span class="md-comment-dot" aria-hidden="true"></span><span class="md-comment-tooltip" aria-hidden="true">${tooltip}</span></span>`;
      });
  }

  function configureRenderer() {
    if (!window.markdownit) {
      throw new Error("markdown-it is unavailable.");
    }

    const md = window
      .markdownit({
        breaks: false,
        html: true,
        linkify: true,
        typographer: true,
      })
      .use(window.markdownitFootnote)
      .use(window.markdownitDeflist)
      .use(window.markdownitSub)
      .use(window.markdownitSup)
      .use(window.markdownitMark)
      .use(window.markdownItAttrs)
      .use(window.markdownitTaskLists, {
        enabled: false,
        label: true,
        labelAfter: true,
      });

    md.core.ruler.push("source_line_attrs", (state) => {
      state.tokens.forEach((token) => {
        if (token.nesting === -1 || !token.map) return;

        token.attrSet("data-source-line", String(token.map[0] + 1));
      });
    });

    md.renderer.rules.link_open = openLinksOutsidePreview;

    window.renderMarkdown = function renderMarkdown(markdownText) {
      return md.render(renderCustomComments(markdownText));
    };

    window.markdownReady = true;
    window.dispatchEvent(new Event("markdown-ready"));
  }

  const ready = scripts
    .reduce((chain, src) => chain.then(() => loadScript(src)), Promise.resolve())
    .then(configureRenderer)
    .catch((error) => {
      window.markdownReady = false;
      window.dispatchEvent(new CustomEvent("markdown-error", { detail: { error } }));
      throw error;
    });

  window.LightMDRenderer = { ready };
})();
