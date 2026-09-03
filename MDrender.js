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

  const hiddenCommentPattern = /\(\(::[\s\S]*?::\)\)/;

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

  /**
   * The comment substitution used to run over the whole source before parsing.
   * It now runs as a core rule, after the block parse and before the inline
   * parse, rewriting each block's inline content instead.
   *
   * The reason is line maps. Block editing splits a document using the line map
   * of each top-level token, and a multi-line comment collapsing into a
   * one-line span shifts every map after it. Doing the substitution here cannot
   * move a block boundary, because the boundaries already exist by then.
   *
   * (An inline ruler rule would be the textbook place, but markdown-it's `text`
   * rule swallows runs of non-terminator characters and "(" is not one of them,
   * so a rule keyed on "((:" is never reached.)
   *
   * Two consequences, both deliberate:
   *   - Only inline content is rewritten, so a comment written inside a fenced
   *     or indented code block is now left alone. It is literal text there.
   *   - A paragraph holding nothing but a hidden comment is removed outright,
   *     which is what the old whole-source substitution did by making the line
   *     vanish before parsing. An empty paragraph would add a blank line of
   *     margin to the reader.
   */
  function customComments(md) {
    md.core.ruler.before("inline", "custom_comments", (state) => {
      const dropAt = [];

      state.tokens.forEach((token, index) => {
        if (token.type !== "inline") return;
        if (token.content.indexOf("((:") === -1) return;

        // A hidden comment leaves no trace in the output, so record where one
        // was. Block editing marks those blocks; nothing else reads this.
        if (token.map && hiddenCommentPattern.test(token.content)) {
          if (!state.env.hiddenComments) state.env.hiddenComments = [];
          state.env.hiddenComments.push(token.map[0]);
        }

        const rewritten = renderCustomComments(token.content);
        if (rewritten === token.content) return;
        token.content = rewritten;

        if (rewritten.trim() !== "") return;

        const open = state.tokens[index - 1];
        const close = state.tokens[index + 1];

        if (open && open.type === "paragraph_open" && close && close.type === "paragraph_close") {
          dropAt.push(index + 1, index, index - 1);
        }
      });

      dropAt.sort((a, b) => b - a).forEach((index) => state.tokens.splice(index, 1));
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
      })
      .use(customComments);

    md.core.ruler.push("source_line_attrs", (state) => {
      state.tokens.forEach((token) => {
        if (token.nesting === -1 || !token.map) return;

        token.attrSet("data-source-line", String(token.map[0] + 1));
      });
    });

    md.renderer.rules.link_open = openLinksOutsidePreview;

    window.renderMarkdown = function renderMarkdown(markdownText, env) {
      return md.render(String(markdownText || ""), env || {});
    };

    return md;
  }

  // The libraries are vendored in ./vendor and loaded by ordinary script tags
  // before this file, so configuration is synchronous. The promise and the
  // events are kept because the rest of the app waits on them.
  let ready;
  let instance = null;

  try {
    instance = configureRenderer();
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

  // `md` is exposed so block editing can parse once and render token slices
  // against the same instance. Nothing else should reach for it.
  window.LightMDRenderer = { ready, md: instance };
})();
