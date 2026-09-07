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

  /* =========================================================================
   * Inline source positions
   *
   * markdown-it records a source line range per BLOCK (`token.map`) and
   * nothing at all for inline tokens, so out of the box there is no way to
   * ask "which character of the source produced this word". Every request for
   * it upstream has been closed without the feature, so it is added here from
   * outside rather than by forking: three hooks, no vendored changes.
   *
   * What each hook is for, and why removing any one of them fails silently:
   *
   *   1. tokenize    — a copy of markdown-it's own inline loop, which already
   *                    computes the position a rule starts at but keeps it in
   *                    a local. This records it on the state instead.
   *   2. push /      — stamp that position onto every token as it is created.
   *      pushPending   Text is special: it accumulates in `state.pending`
   *                    across several rules and only becomes a token when
   *                    flushed, so it carries the position the run STARTED at.
   *   3. the two     — `fragments_join` (inline) and `text_join` (core) both
   *      join rules    merge a text token into the NEXT one and drop the
   *                    earlier. The survivor would keep the later position, so
   *                    both carry the earlier one across. Without this, one
   *                    escape or entity anywhere in a paragraph silently
   *                    shifts every position after it.
   *
   * Positions land in `token.srcPos`, relative to the string the INLINE
   * parser saw — which is the block's content, not the document. The
   * `absolute_positions` rule below is what turns those into document
   * offsets; nothing else should read `srcPos` directly.
   * ====================================================================== */
  function withInlinePositions(md) {
    const State = md.inline.State;

    md.inline.tokenize = function (state) {
      const rules = this.ruler.getRules("");
      const len = rules.length;
      const end = state.posMax;
      const maxNesting = state.md.options.maxNesting;

      while (state.pos < end) {
        const prevPos = state.pos;

        state._rulePos = prevPos;
        // Anything appended to an empty pending buffer starts here.
        if (!state.pending) state._pendingPos = prevPos;

        let ok = false;

        if (state.level < maxNesting) {
          for (let i = 0; i < len; i += 1) {
            ok = rules[i](state, false);

            if (ok) {
              if (prevPos >= state.pos) throw new Error("inline rule didn't increment state.pos");
              break;
            }
          }
        }

        if (ok) {
          if (state.pos >= end) break;
          continue;
        }

        state.pending += state.src[state.pos++];
      }

      if (state.pending) state.pushPending();
    };

    const pushPending = State.prototype.pushPending;
    State.prototype.pushPending = function () {
      const token = pushPending.call(this);

      token.srcPos = this._pendingPos;
      return token;
    };

    const push = State.prototype.push;
    State.prototype.push = function (type, tag, nesting) {
      const token = push.call(this, type, tag, nesting);

      token.srcPos = this._rulePos;
      return token;
    };

    function joinCarryingPositions(tokens) {
      const max = tokens.length;
      let curr;
      let last;
      let level = 0;

      for (curr = last = 0; curr < max; curr += 1) {
        if (tokens[curr].nesting < 0) level -= 1;
        tokens[curr].level = level;
        if (tokens[curr].nesting > 0) level += 1;

        if (tokens[curr].type === "text" && curr + 1 < max && tokens[curr + 1].type === "text") {
          tokens[curr + 1].content = tokens[curr].content + tokens[curr + 1].content;

          // The merged run starts where the EARLIER fragment started.
          if (tokens[curr].srcPos !== undefined) tokens[curr + 1].srcPos = tokens[curr].srcPos;
        } else {
          if (curr !== last) tokens[last] = tokens[curr];
          last += 1;
        }
      }

      if (curr !== last) tokens.length = last;
    }

    md.inline.ruler2.at("fragments_join", (state) => joinCarryingPositions(state.tokens));

    md.core.ruler.at("text_join", (state) => {
      state.tokens.forEach((blockToken) => {
        if (blockToken.type !== "inline") return;

        blockToken.children.forEach((token) => {
          if (token.type === "text_special") token.type = "text";
        });

        joinCarryingPositions(blockToken.children);
      });
    });

    return md;
  }

  /**
   * Turn each inline token's block-relative position into a document offset.
   *
   * The inline parser is handed the block's content, which is the document's
   * lines with their indentation and list or quote markers already stripped,
   * so a position from it means nothing on its own. Each content line is
   * located inside the document line it came from and the difference is the
   * shift for every position on that line.
   *
   * A line that cannot be located is left without a position rather than
   * guessed at — `((:comment:))` rewrites a block's content before the inline
   * parser sees it, so those lines legitimately have no counterpart in the
   * source, and a caret placed from a guess would be worse than none.
   *
   * Only text and code_inline are stamped: they are the only tokens whose
   * characters reach the reader as text to click on.
   */
  function absolutePositions(md) {
    md.core.ruler.push("absolute_positions", (state) => {
      const source = state.src;
      const lineStart = [0];

      for (let index = 0; index < source.length; index += 1) {
        if (source[index] === "\n") lineStart.push(index + 1);
      }

      state.tokens.forEach((token) => {
        if (token.type !== "inline" || !token.map || !token.children) return;

        const contentLines = token.content.split("\n");
        const lineBase = [];
        const lineOffset = [];
        let accumulated = 0;

        contentLines.forEach((contentLine, index) => {
          lineOffset.push(accumulated);
          accumulated += contentLine.length + 1;

          const start = lineStart[token.map[0] + index];

          if (start === undefined) {
            lineBase.push(-1);
            return;
          }

          const documentLine = source.slice(start, (lineStart[token.map[0] + index + 1] ?? source.length + 1) - 1);
          const shift = documentLine.indexOf(contentLine);

          lineBase.push(shift === -1 ? -1 : start + shift);
        });

        token.children.forEach((child) => {
          if (child.srcPos === undefined) return;
          if (child.type !== "text" && child.type !== "code_inline") return;

          let line = 0;

          while (line + 1 < lineOffset.length && lineOffset[line + 1] <= child.srcPos) line += 1;
          if (lineBase[line] === -1) return;

          child.docPos = lineBase[line] + (child.srcPos - lineOffset[line]);
        });
      });
    });

    return md;
  }

  /**
   * Emit the positions into the markup, but only when asked.
   *
   * `renderMarkdown(text, { emitPositions: true })` wraps every clickable run
   * of text in a span carrying its document offset. The reader and the
   * preview never pass that flag, so what the app displays is byte-identical
   * to before — which matters, because block editing compares rendered HTML
   * to decide what changed, and an extra attribute there would look like an
   * edit to every block at once.
   */
  function positionSpans(md) {
    const renderText = md.renderer.rules.text;
    const renderCodeInline = md.renderer.rules.code_inline;

    md.renderer.rules.text = function (tokens, index, options, env, self) {
      const html = renderText(tokens, index, options, env, self);

      if (!env || !env.emitPositions || tokens[index].docPos === undefined) return html;

      return `<span data-doc-pos="${tokens[index].docPos}">${html}</span>`;
    };

    md.renderer.rules.code_inline = function (tokens, index, options, env, self) {
      const html = renderCodeInline(tokens, index, options, env, self);

      if (!env || !env.emitPositions || tokens[index].docPos === undefined) return html;

      return `<span data-doc-pos="${tokens[index].docPos}">${html}</span>`;
    };

    return md;
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
      .use(customComments)
      .use(withInlinePositions)
      .use(absolutePositions)
      .use(positionSpans);

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
