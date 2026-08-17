(function () {
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

  function missingLibraries() {
    return [
      ["markdown-it", window.markdownit],
      ["markdown-it-footnote", window.markdownitFootnote],
      ["markdown-it-deflist", window.markdownitDeflist],
      ["markdown-it-sub", window.markdownitSub],
      ["markdown-it-sup", window.markdownitSup],
      ["markdown-it-mark", window.markdownitMark],
      ["markdown-it-attrs", window.markdownItAttrs],
      ["markdown-it-task-lists", window.markdownitTaskLists],
    ]
      .filter(([, library]) => !library)
      .map(([name]) => name);
  }

  function configureRenderer() {
    const missing = missingLibraries();

    if (missing.length) {
      throw new Error(`Markdown libraries did not load: ${missing.join(", ")}.`);
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
  }

  // The libraries are vendored in ./vendor and loaded by ordinary script tags
  // before this file, so configuration is synchronous. The promise and the
  // events are kept because the rest of the app waits on them.
  let ready;

  try {
    configureRenderer();
    window.markdownReady = true;
    ready = Promise.resolve();
    window.dispatchEvent(new Event("markdown-ready"));
  } catch (error) {
    window.markdownReady = false;
    ready = Promise.reject(error);
    // Nothing is listening yet during initial parse; the rejected promise is
    // what callers actually observe. Keep it handled so it is not reported as
    // an unhandled rejection.
    ready.catch(() => {});
    window.dispatchEvent(new CustomEvent("markdown-error", { detail: { error } }));
  }

  window.LightMDRenderer = { ready };
})();
