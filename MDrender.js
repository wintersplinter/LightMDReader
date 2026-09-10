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

  /* =========================================================================
   * Math
   *
   * `$x$` inline and `$$x$$` as its own block, rendered by Temml into MathML,
   * which every current browser lays out itself. That is the whole reason for
   * choosing Temml over KaTeX: 164 KB and one font file against 268 KB and 60,
   * because the browser already knows how to set an integral sign.
   *
   * The delimiters are the risk, not the maths. A document that mentions a
   * price is far commoner than one that does inline algebra, so the inline
   * rule refuses anything that looks like money or arithmetic on plain
   * numbers: no whitespace directly inside the delimiters, no digit
   * immediately after the closing one, and no newline in between. `$5 and $7`
   * therefore stays text, and `$5$` is left alone as well.
   * ====================================================================== */
  function renderMath(latex, displayMode) {
    if (!window.temml) return null;

    try {
      return window.temml.renderToString(latex, {
        displayMode,
        throwOnError: false,
        // A malformed formula should show up as a marked-up formula, not stop
        // the document rendering.
        errorColor: "currentColor",
      });
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  function mathPlugin(md) {
    md.inline.ruler.before("escape", "math_inline", (state, silent) => {
      const start = state.pos;

      if (state.src.charCodeAt(start) !== 0x24) return false;      // $
      // `$$` inline is left to the block rule.
      if (state.src.charCodeAt(start + 1) === 0x24) return false;
      // An escaped \$ never opens maths.
      if (start > 0 && state.src.charCodeAt(start - 1) === 0x5c) return false;

      const after = state.src[start + 1];
      if (after === undefined || /\s/.test(after)) return false;

      let end = start + 1;

      while (end < state.posMax) {
        const code = state.src.charCodeAt(end);

        if (code === 0x0a) return false;                            // newline
        if (code === 0x24 && state.src.charCodeAt(end - 1) !== 0x5c) break;

        end += 1;
      }

      if (end >= state.posMax) return false;
      if (/\s/.test(state.src[end - 1])) return false;
      // "$12 and $15" — a digit right after the closer means this was money.
      if (/[0-9]/.test(state.src[end + 1] || "")) return false;

      const latex = state.src.slice(start + 1, end);

      if (!latex.trim()) return false;

      if (!silent) {
        const token = state.push("math_inline", "", 0);

        token.content = latex;
        token.markup = "$";
      }

      state.pos = end + 1;
      return true;
    });

    md.block.ruler.before("fence", "math_block", (state, startLine, endLine, silent) => {
      const begin = state.bMarks[startLine] + state.tShift[startLine];
      const max = state.eMarks[startLine];

      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      if (state.src.slice(begin, begin + 2) !== "$$") return false;

      const firstLine = state.src.slice(begin + 2, max);
      let lastLine = null;
      let line = startLine;
      let found = false;

      // `$$x$$` all on one line closes immediately.
      if (firstLine.trim().endsWith("$$")) {
        found = true;
        lastLine = firstLine.trim().slice(0, -2);
      }

      while (!found) {
        line += 1;
        if (line >= endLine) break;

        const nextBegin = state.bMarks[line] + state.tShift[line];
        const nextMax = state.eMarks[line];

        if (nextBegin < nextMax && state.sCount[line] < state.blkIndent) break;

        if (state.src.slice(nextBegin, nextMax).trim().endsWith("$$")) {
          const text = state.src.slice(nextBegin, nextMax).trim();

          lastLine = text.slice(0, -2);
          found = true;
        }
      }

      if (!found) return false;
      if (silent) return true;

      const middle = line > startLine
        ? state.getLines(startLine + 1, line, state.tShift[startLine], false)
        : "";
      const latex = `${line > startLine ? firstLine : ""}\n${middle}\n${lastLine || ""}`.trim();

      state.line = line + 1;

      const token = state.push("math_block", "", 0);

      token.block = true;
      token.content = latex;
      token.markup = "$$";
      // The line map is what block editing and the split editor's alignment
      // read, so display maths behaves like any other block.
      token.map = [startLine, state.line];

      return true;
    });

    md.renderer.rules.math_inline = (tokens, index) => {
      const html = renderMath(tokens[index].content, false);

      return html || `<code>${escapeHtml(`$${tokens[index].content}$`)}</code>`;
    };

    md.renderer.rules.math_block = (tokens, index) => {
      const html = renderMath(tokens[index].content, true);

      return html
        ? `<div class="md-math-block">${html}</div>\n`
        : `<pre><code>${escapeHtml(tokens[index].content)}</code></pre>\n`;
    };
  }

  /**
   * Marks the paragraph that opens a section as its standfirst.
   *
   * This replaces a `h1 + p` rule that each style used to carry. That rule was
   * a *proxy* for "the paragraph that opens this section", and it was wrong
   * whenever a document did not open the way the styles assumed: it matched an
   * image (markdown-it wraps a lone image in a paragraph), it matched a
   * paragraph holding only a visible comment, it was defeated by anything at
   * all sitting in between, and in block editing it broke a second way, because
   * a block that renders to nothing is shown as its own source and that <pre>
   * lands between the heading and the paragraph. Deciding here instead means
   * the answer is computed once, from the document, and travels with the
   * paragraph rather than depending on what happens to sit next to it.
   *
   * It runs as a core rule, so BOTH render paths get it from one place: block
   * editing parses the whole document with this same instance and renders
   * slices of that one token stream (lib/blockRender.js), so the class is
   * already on the token before any slicing happens.
   *
   * What counts, deliberately:
   *
   *   - Every top-level h1, not only the first. A section opens the same way
   *     wherever it sits, and this is also what the old `h1 + p` did.
   *   - An h1 inside a blockquote or a list item is not a section title, the
   *     same test buildTitlePages() makes for PDF title pages.
   *   - A paragraph holding only a comment is stepped over rather than marked
   *     or treated as a wall. It is not the lede, but nothing about it is
   *     visible in the document either, so it is not a reason for the section
   *     to have none.
   *   - Everything a reader can actually see ends the search: a list, a
   *     quotation, a code block, a rule, a table, an image, any heading. A
   *     section that opens with one of those has no standfirst, and should not
   *     — an image is content, and content is not a lede.
   *
   * That is the whole rule: only what is invisible in the rendered document is
   * stepped over. It also keeps the search in step with buildTitlePages() in
   * app.js, which has to carry the same things onto a PDF title page — a
   * standfirst the title page cannot reach is stranded on the next page, which
   * is the bug this whole change exists to fix.
   *
   * Hidden comments and link or footnote definitions need no handling: they
   * leave no tokens by the time this runs, which is why it is registered after
   * `custom_comments`.
   */
  const standfirstClass = "standfirst";

  /* The feature can be switched off. It is a flag here rather than a CSS
     toggle so that "off" means the class is never written: the markup stays
     honest, and the styles stay a plain `.standfirst` rule with no `:not()`
     wrapped round every one of them. Changing it needs a re-render, which is
     what app.js does. */
  let standfirstEnabled = true;

  /**
   * A paragraph holding nothing but a rendered comment.
   *
   * Tested on the inline token's content rather than its children, because a
   * comment is raw HTML by the time it gets here and its tooltip text is a
   * child of its own — "only a comment" is not visible from the child list.
   */
  function isCommentOnlyParagraph(inline) {
    const content = String((inline && inline.content) || "");

    if (content.indexOf('class="md-comment"') === -1) return false;

    return content.replace(/<span class="md-comment"[\s\S]*?<\/span><\/span>/g, "").trim() === "";
  }

  /**
   * A paragraph holding nothing but images.
   *
   * markdown-it wraps a lone image in a paragraph, so without this test an
   * image would be marked as the lede simply for being paragraph-shaped. It
   * ends the search rather than being stepped over: an image is content, and a
   * section that opens with one has no standfirst, exactly as one opening with
   * a list has none.
   *
   * A paragraph mixing an image with text is a real paragraph and is marked
   * normally — only an image on its own counts here.
   */
  function isImageOnlyParagraph(inline) {
    const children = (inline && inline.children) || [];
    const meaningful = children.filter(
      (child) => child.type !== "softbreak" && !(child.type === "text" && !child.content.trim()),
    );

    return meaningful.length > 0 && meaningful.every((child) => child.type === "image");
  }

  function standfirst(md) {
    md.core.ruler.push(standfirstClass, (state) => {
      if (!standfirstEnabled) return;

      const tokens = state.tokens;
      let depth = 0;

      for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];

        // The depth this token opens AT, before its own nesting is applied —
        // a heading_open is itself nesting +1, so reading depth after the fact
        // would make every heading look nested.
        const openedAt = depth;

        depth += token.nesting;
        if (depth < 0) depth = 0;

        if (openedAt !== 0 || token.type !== "heading_open" || token.tag !== "h1") continue;

        // Walk the top-level siblings that follow the heading.
        let cursor = index + 1;

        while (cursor < tokens.length && tokens[cursor].type !== "heading_close") cursor += 1;
        cursor += 1;

        while (cursor < tokens.length && tokens[cursor].type === "paragraph_open") {
          const inline = tokens[cursor + 1];

          // Invisible: step over it. paragraph_open, inline, paragraph_close.
          if (isCommentOnlyParagraph(inline)) {
            cursor += 3;
            continue;
          }

          // Visible content that happens to be paragraph-shaped: stop.
          if (isImageOnlyParagraph(inline)) break;

          tokens[cursor].attrJoin("class", standfirstClass);
          break;
        }
      }
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
      ["temml", window.temml],
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
      // After customComments, so an emptied comment paragraph is already gone
      // from the token stream rather than standing between a title and its lede.
      .use(standfirst)
      .use(mathPlugin)
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
  window.LightMDRenderer = {
    ready,
    md: instance,
    /** Off means the standfirst class is not written at all. Re-render after. */
    setStandfirstEnabled(enabled) {
      standfirstEnabled = enabled !== false;
    },
  };
})();
