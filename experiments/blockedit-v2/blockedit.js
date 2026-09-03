/* Block editing — working copy (v2).
 *
 * Same interaction as the frozen POC: the block the cursor is in is shown as
 * raw Markdown, every other block is rendered. What changed is the rendering
 * pipeline, so that things which span blocks work.
 *
 * The document model is unchanged and still the whole safety story: a strict
 * partition of the source lines into alternating separators and blocks,
 *
 *   seps[0] blocks[0] seps[1] blocks[1] ... blocks[n-1] seps[n]
 *
 * so serialising is byte-identical to the input by construction.
 *
 * Three things are new:
 *
 * 1. DEFINITION BLOCKS. markdown-it swallows link references ("[x]: url") and
 *    footnote definitions ("[^a]: note") into `env` during the block parse:
 *    they produce no token and no line map. In the POC those lines fell into
 *    separators, where they were preserved but invisible and uneditable. Any
 *    run of non-blank lines that no token claimed is now a block of its own.
 *
 * 2. ONE PARSE, TOKEN-SLICE RENDER. The whole document is parsed once into a
 *    shared `env`, the top-level tokens are grouped, and each group is rendered
 *    on its own with `md.renderer.render(slice, options, env)`. Reference links
 *    resolve across blocks and footnotes are numbered document-wide, because
 *    there is only ever one parse. Verified: the concatenation of the slices is
 *    identical to a whole-document render.
 *
 * 3. THE FOOTNOTE TAIL. Its tokens have no line map at all — it is synthesised
 *    from `env`, it owns no source lines, and it is therefore not a block and
 *    never editable. It renders after the last block as a derived region.
 */

import { createBlockModel } from "../../lib/blockModel.js";

(function () {
  "use strict";

  // ---------------------------------------------------------------- renderer

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* The app's custom comment syntax.
     It runs as a core rule placed AFTER the block parse and BEFORE the inline
     parse, rewriting the inline content of each block. The original app did the
     same substitution on the whole source before parsing; that is no longer
     safe, because a multi-line comment collapsing to a one-line span shifts
     every line map after it, and the block splitter now depends on those maps.
     Doing it here cannot move a block boundary: the boundaries already exist.

     (An inline ruler rule would be the textbook place, but markdown-it's `text`
     rule swallows runs of non-terminator characters, and "(" is not one of
     them, so an inline rule on "((:" is never reached.) */
  function commentToHtml(text) {
    return String(text)
      .replace(/\(\(::([\s\S]*?)::\)\)/g, "")
      .replace(/\(\(:([\s\S]*?):\)\)/g, function (_, comment) {
        var clean = comment.trim();
        if (!clean) return "";
        var tooltip = escapeHtml(clean);
        var label = escapeHtml(clean.replace(/\s+/g, " "));
        return (
          '<span class="md-comment" tabindex="0" aria-label="' + label + '">' +
          '<span class="md-comment-dot" aria-hidden="true"></span>' +
          '<span class="md-comment-tooltip" aria-hidden="true">' + tooltip + "</span>" +
          "</span>"
        );
      });
  }

  var HIDDEN_COMMENT = /\(\(::[\s\S]*?::\)\)/;

  function customCommentPlugin(md) {
    md.core.ruler.before("inline", "md_comment", function (state) {
      state.tokens.forEach(function (token) {
        if (token.type !== "inline") return;
        if (token.content.indexOf("((:") === -1) return;

        /* A hidden comment leaves no trace in the rendered output, so record
           where it was for the margin marker. Only inline content is scanned,
           which is what we want: a hidden comment inside a fenced code block is
           literal text and is neither stripped nor marked. */
        if (token.map && HIDDEN_COMMENT.test(token.content)) {
          if (!state.env.hiddenComments) state.env.hiddenComments = [];
          state.env.hiddenComments.push(token.map[0]);
        }

        token.content = commentToHtml(token.content);
      });
    });
  }

  var md = window
    .markdownit({ breaks: false, html: true, linkify: true, typographer: true })
    .use(window.markdownitFootnote)
    .use(window.markdownItAttrs)
    .use(window.markdownitMark)
    .use(customCommentPlugin);

  function sanitize(html) {
    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true },
      ADD_ATTR: ["target", "rel", "data-source-line", "tabindex", "aria-label", "aria-hidden"],
    });
  }

  /* A block whose rendered output shows nothing — a definition, a hidden
     comment — is displayed as dimmed raw source instead, because there is
     nothing else to show and it still has to be reachable. */
  function rendersToNothing(html) {
    if (!html) return true;
    if (/<(img|hr|input|br|video|audio|iframe|svg|table|figure)\b/i.test(html)) return false;
    return html.replace(/<[^>]*>/g, "").trim() === "";
  }

  // -------------------------------------------------------------- the model

  /* parseDoc / serializeDoc / spliceBlocks / insertBlocks live in
     ../../lib/blockModel.js and are unit tested in tests/unit/blockModel.test.js.
     This page is one caller of them, not the place they are defined. */
  var model = createBlockModel(md);

  function parseDoc(src) {
    return model.parseDoc(src);
  }

  function serializeDoc(doc) {
    return model.serializeDoc(doc);
  }

  // ------------------------------------------------------------------- state

  var state = {
    blocks: [],
    seps: [[]],
    baseline: "",
    editing: null,
    commits: 0,
    lastRender: null,
  };

  var els = {
    doc: document.getElementById("doc"),
    log: document.getElementById("log"),
    source: document.getElementById("source"),
    sourceSection: document.getElementById("source-section"),
    statBlocks: document.getElementById("stat-blocks"),
    statDefs: document.getElementById("stat-defs"),
    statDirty: document.getElementById("stat-dirty"),
    statCommits: document.getElementById("stat-commits"),
    statRender: document.getElementById("stat-render"),
  };

  /* `state` carries the { blocks, seps } shape the model works on, so it is
     passed straight through. */
  function source() {
    return model.serializeDoc(state);
  }

  function blockText(i) {
    return model.blockText(state, i);
  }

  function blockOffsets() {
    return model.blockOffsets(state);
  }

  // ------------------------------------------------------- document renderer

  /* One parse of the whole document, then one render per block from its own
     slice of the token stream. */
  function renderDocument() {
    var started = performance.now();
    var src = source();
    var env = {};
    var tokens;

    try {
      tokens = md.parse(src, env);
    } catch (error) {
      tokens = [];
    }

    /* Group the token stream into top-level runs. */
    var groups = [];
    var current = null;
    var depth = 0;
    tokens.forEach(function (token) {
      if (!current) current = { map: token.map, tokens: [] };
      current.tokens.push(token);
      depth += token.nesting;
      if (depth === 0) {
        groups.push(current);
        current = null;
      }
    });
    if (current) groups.push(current);

    var offsets = blockOffsets();
    var perBlock = offsets.map(function () { return []; });
    var tailTokens = [];

    groups.forEach(function (group) {
      if (!group.map) {
        tailTokens.push.apply(tailTokens, group.tokens);
        return;
      }
      var line = group.map[0];
      for (var i = 0; i < offsets.length; i++) {
        if (line >= offsets[i][0] && line < offsets[i][1]) {
          perBlock[i].push.apply(perBlock[i], group.tokens);
          return;
        }
      }
      /* A group that matches no block would mean the partition and the parse
         disagree. That must not happen; surface it rather than hide it. */
      log("! unmapped token group at line " + line, "warn");
    });

    var hiddenLines = new Set(env.hiddenComments || []);

    function holdsHiddenComment(i) {
      for (var line = offsets[i][0]; line < offsets[i][1]; line++) {
        if (hiddenLines.has(line)) return true;
      }
      return false;
    }

    var html = perBlock.map(function (slice, i) {
      var hidden = holdsHiddenComment(i);
      var rendered = slice.length ? md.renderer.render(slice, md.options, env) : "";
      if (rendersToNothing(rendered)) {
        return {
          raw: true,
          hidden: hidden,
          html: '<pre class="raw-source">' + escapeHtml(blockText(i)) + "</pre>",
        };
      }
      return { raw: false, hidden: hidden, html: sanitize(rendered) };
    });

    var tailHtml = tailTokens.length
      ? sanitize(md.renderer.render(tailTokens, md.options, env))
      : "";

    /* Footnote labels in rendered order, so a footnote in the tail can be
       traced back to the definition block that produced it. */
    var labels = [];
    var footnotes = env.footnotes || {};
    if (Array.isArray(footnotes.list)) {
      labels = footnotes.list.map(function (item) { return item && item.label; });
    }
    if (!labels.length && footnotes.refs) {
      Object.keys(footnotes.refs).forEach(function (key) {
        labels[footnotes.refs[key]] = key.replace(/^:/, "");
      });
    }

    return {
      blocks: html,
      tail: tailHtml,
      labels: labels,
      ms: performance.now() - started,
    };
  }

  /* Which block holds the definition of a footnote label. */
  function definitionBlockFor(label) {
    var pattern = new RegExp("^\\s*\\[\\^" + label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\]:");
    for (var i = 0; i < state.blocks.length; i++) {
      if (pattern.test(blockText(i))) return i;
    }
    return -1;
  }

  // -------------------------------------------------------------- edit model

  function spliceBlocks(from, count, text) {
    return model.spliceBlocks(state, from, count, text);
  }

  function insertBlocks(at, text) {
    return model.insertBlocks(state, at, text);
  }

  // ------------------------------------------------------------------ render

  function autosize(ta) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  /* A template keeps the tree inert: nothing loads until it is attached. */
  function nodesFromHtml(html) {
    var template = document.createElement("template");
    template.innerHTML = html;
    return Array.prototype.filter.call(template.content.childNodes, function (node) {
      return node.nodeType === 1 || (node.nodeType === 3 && node.textContent.trim() !== "");
    });
  }

  /* Flat DOM: a block becomes a RUN of ordinary top-level elements, not one
     wrapper. The app's stylesheets are full of `h1 + p` and
     `.markdown-body > *:first-child`, and a wrapper would break every one of
     them — the rendered document has to keep exactly the shape the reader has.
     Elements are tagged with data-block instead. */
  function makeBlockNodes(i, entry) {
    var nodes = nodesFromHtml(entry.html);
    if (!nodes.length) nodes = nodesFromHtml("<p></p>");

    nodes.forEach(function (node, position) {
      if (node.nodeType !== 1) return;
      node.setAttribute("data-block", String(i));
      if (entry.raw) node.classList.add("block-raw");
      /* The ring goes on the first element of the block only, and never on a
         block that already shows its own source. */
      if (entry.hidden && !entry.raw && position === 0) {
        node.classList.add("has-hidden-comment");
      }
    });

    return nodes;
  }

  function makeEditorElement() {
    var wrap = document.createElement("div");
    wrap.className = "block-editor";
    wrap.dataset.editingBlock = String(state.editing.isNew ? state.editing.at : state.editing.index);
    if (state.editing.isNew) wrap.dataset.new = "true";

    var ta = document.createElement("textarea");
    ta.spellcheck = false;
    ta.value = state.editing.value;
    ta.setAttribute("aria-label", "Markdown source of the current block");

    ta.addEventListener("input", function () {
      state.editing.value = ta.value;
      autosize(ta);
      updateSourcePane(ta.value);
    });
    ta.addEventListener("keydown", onEditorKeydown);

    wrap.appendChild(ta);
    return wrap;
  }

  function makeTailElement(rendered) {
    var wrap = document.createElement("div");
    wrap.className = "footnote-tail";
    var note = document.createElement("p");
    note.className = "tail-note";
    note.textContent = "Generated from the footnote definitions above — not editable here.";
    wrap.appendChild(note);
    var body = document.createElement("div");
    body.className = "markdown-body";
    body.innerHTML = rendered.tail;
    wrap.appendChild(body);

    body.querySelectorAll("li.footnote-item").forEach(function (li, order) {
      var label = rendered.labels[order];
      if (label == null) return;
      li.dataset.label = label;
      li.classList.add("is-traceable");
      li.title = "Go to the definition of [^" + label + "]";
    });

    return wrap;
  }

  /* Descriptors let unchanged blocks keep their DOM node, so scroll position
     and loaded images survive a commit. Invalidation is derived from the
     rendered HTML, never predicted from what was edited. */
  function renderDoc() {
    var rendered = renderDocument();
    state.lastRender = rendered;

    var groups = [];
    var n = state.blocks.length;
    var editing = state.editing;

    for (var i = 0; i < n + 1; i++) {
      if (editing && editing.isNew && editing.at === i) {
        groups.push({ kind: "editor", key: "editor:new:" + i });
      }
      if (i < n) {
        if (editing && !editing.isNew && editing.index === i) {
          groups.push({ kind: "editor", key: "editor:" + i });
        } else {
          var entry = rendered.blocks[i];
          groups.push({
            kind: "block",
            index: i,
            entry: entry,
            key: "block:" + i + ":" + (entry.raw ? "r" : "-") + (entry.hidden ? "h" : "-") + ":" + entry.html,
          });
        }
      }
    }
    if (rendered.tail) groups.push({ kind: "tail", key: "tail:" + rendered.tail });

    var container = els.doc;

    /* What is on screen now, grouped by the key each node was built with. */
    var existing = [];
    var run = null;
    Array.prototype.forEach.call(container.childNodes, function (node) {
      if (!run || run.key !== node._groupKey) {
        run = { key: node._groupKey, nodes: [] };
        existing.push(run);
      }
      run.nodes.push(node);
    });

    var builtEditor = false;
    var desired = [];

    groups.forEach(function (group, position) {
      var have = existing[position];
      if (have && have.key === group.key) {
        desired.push.apply(desired, have.nodes);
        return;
      }

      var nodes;
      if (group.kind === "editor") {
        nodes = [makeEditorElement()];
        builtEditor = true;
      } else if (group.kind === "tail") {
        nodes = [makeTailElement(rendered)];
      } else {
        nodes = makeBlockNodes(group.index, group.entry);
      }
      nodes.forEach(function (node) { node._groupKey = group.key; });
      desired.push.apply(desired, nodes);
    });

    /* One keyed pass. A node that was reused is moved, never rebuilt, so an
       unchanged block keeps its scroll position and its loaded images. */
    var at = 0;
    desired.forEach(function (node) {
      var current = container.childNodes[at];
      if (current !== node) container.insertBefore(node, current || null);
      at++;
    });
    while (container.childNodes.length > desired.length) {
      container.removeChild(container.lastChild);
    }

    if (builtEditor) {
      var ta = container.querySelector("textarea");
      if (ta) {
        autosize(ta);
        ta.focus();
        var caret = state.editing.caret;
        if (caret === "end" || caret == null) caret = ta.value.length;
        ta.setSelectionRange(caret, caret);
        ta.scrollIntoView({ block: "nearest" });
      }
    }

    updateStats(rendered);
    updateSourcePane();
  }

  function updateStats(rendered) {
    var definitions = rendered.blocks.filter(function (b) { return b.raw; }).length;
    els.statBlocks.textContent = String(state.blocks.length);
    els.statDefs.textContent = String(definitions);
    els.statCommits.textContent = String(state.commits);
    els.statRender.textContent = rendered.ms.toFixed(1) + " ms";
    var dirty = source() !== state.baseline;
    els.statDirty.textContent = dirty ? "edited" : "unchanged";
    els.statDirty.classList.toggle("is-dirty", dirty);
  }

  function updateSourcePane(pendingValue) {
    if (els.sourceSection.hidden) return;
    var text = source();
    if (pendingValue != null && state.editing && !state.editing.isNew) {
      var preview = { blocks: state.blocks.slice(), seps: state.seps.slice() };
      preview.blocks[state.editing.index] = pendingValue.split("\n");
      text = serializeDoc(preview);
    }
    els.source.textContent = text;
  }

  function log(message, kind) {
    var empty = els.log.querySelector(".log-empty");
    if (empty) empty.remove();
    var li = document.createElement("li");
    li.className = kind ? "log-" + kind : "";
    li.textContent = message;
    els.log.insertBefore(li, els.log.firstChild);
  }

  // ------------------------------------------------------------- transitions

  function stopEditing(options) {
    var commit = !options || options.commit !== false;
    var editing = state.editing;
    state.editing = null;
    if (!editing) return { shiftFrom: 0, delta: 0 };

    var value = editing.value;

    if (!commit) {
      log("cancelled, nothing written");
      return { shiftFrom: 0, delta: 0 };
    }

    if (editing.isNew) {
      if (!value.trim()) return { shiftFrom: 0, delta: 0 };
      var inserted = insertBlocks(editing.at, value);
      state.commits++;
      log("+ inserted " + inserted + " block(s) at " + editing.at, "ok");
      return { shiftFrom: editing.at, delta: inserted };
    }

    if (value === blockText(editing.index)) return { shiftFrom: 0, delta: 0 };

    var produced = spliceBlocks(editing.index, 1, value);
    state.commits++;
    if (produced === 1) log("~ block " + editing.index + " edited", "ok");
    else if (produced === 0) log("- block " + editing.index + " removed", "warn");
    else log("* block " + editing.index + " split into " + produced, "warn");

    return { shiftFrom: editing.index + 1, delta: produced - 1 };
  }

  function startEditing(index, caret) {
    if (index < 0 || index >= state.blocks.length) return;
    state.editing = { index: index, value: blockText(index), caret: caret };
    renderDoc();
  }

  function startNewBlock(at) {
    state.editing = { at: at, isNew: true, value: "", caret: 0 };
    renderDoc();
  }

  function moveTo(index, caret) {
    var shift = stopEditing();
    var target = index;
    if (shift.delta && index >= shift.shiftFrom) target += shift.delta;
    target = Math.max(0, Math.min(state.blocks.length - 1, target));
    if (state.blocks.length === 0) {
      renderDoc();
      return;
    }
    startEditing(target, caret);
  }

  // --------------------------------------------------------------- keyboard

  function onEditorKeydown(event) {
    var ta = event.currentTarget;
    var editing = state.editing;
    if (!editing) return;
    editing.value = ta.value;

    var atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
    var atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;
    var index = editing.isNew ? editing.at : editing.index;

    if (event.key === "Escape") {
      event.preventDefault();
      stopEditing({ commit: false });
      renderDoc();
      return;
    }

    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      var shift = stopEditing();
      var at = editing.isNew ? editing.at + shift.delta : index + 1 + (shift.delta || 0);
      startNewBlock(Math.max(0, Math.min(state.blocks.length, at)));
      return;
    }

    if (event.key === "ArrowUp" && atStart && !editing.isNew) {
      if (index === 0) return;
      event.preventDefault();
      moveTo(index - 1, "end");
      return;
    }

    if (event.key === "ArrowDown" && atEnd && !editing.isNew) {
      if (index >= state.blocks.length - 1) return;
      event.preventDefault();
      moveTo(index + 1, 0);
      return;
    }

    if (event.key === "Backspace" && atStart && !editing.isNew && index > 0) {
      event.preventDefault();
      var prevText = blockText(index - 1);
      var merged = prevText + "\n" + ta.value;
      var produced = spliceBlocks(index - 1, 2, merged);
      state.commits++;
      log("< merged block " + index + " into " + (index - 1), "warn");
      state.editing = null;
      if (produced > 0) startEditing(index - 1, prevText.length);
      else renderDoc();
      return;
    }

    if (event.key === "Delete" && atEnd && !editing.isNew && index < state.blocks.length - 1) {
      event.preventDefault();
      var here = ta.value;
      spliceBlocks(index, 2, here + "\n" + blockText(index + 1));
      state.commits++;
      log("> merged block " + (index + 1) + " into " + index, "warn");
      state.editing = null;
      startEditing(index, here.length);
      return;
    }
  }

  // ---------------------------------------------------------------- pointing

  els.doc.addEventListener("click", function (event) {
    if (event.target.closest("textarea")) return;

    /* A footnote in the generated tail traces back to its definition block. */
    var item = event.target.closest("li.footnote-item[data-label]");
    if (item) {
      event.preventDefault();
      var target = definitionBlockFor(item.dataset.label);
      if (target < 0) {
        log("no definition block for [^" + item.dataset.label + "]", "warn");
        return;
      }
      var shift = stopEditing();
      if (shift.delta && target >= shift.shiftFrom) target += shift.delta;
      startEditing(Math.max(0, Math.min(state.blocks.length - 1, target)), "end");
      return;
    }

    if (event.target.closest("a[href]")) return;
    if (event.target.closest(".footnote-tail")) return;
    if (event.target.closest(".block-editor")) return;

    var blockEl = event.target.closest("[data-block]");
    if (!blockEl) return;

    var index = Number(blockEl.getAttribute("data-block"));
    var moved = stopEditing();
    if (moved.delta && index >= moved.shiftFrom) index += moved.delta;
    startEditing(Math.max(0, Math.min(state.blocks.length - 1, index)), "end");
  });

  /* A block no longer has a box of its own, so the hover cue is applied to
     every element of the run at once. */
  var hoveredIndex = null;
  var hoveredNodes = [];

  function setHoveredBlock(index) {
    if (index === hoveredIndex) return;
    hoveredNodes.forEach(function (node) { node.classList.remove("is-hovered"); });
    hoveredIndex = index;
    hoveredNodes = index == null
      ? []
      : Array.prototype.slice.call(els.doc.querySelectorAll('[data-block="' + index + '"]'));
    hoveredNodes.forEach(function (node) { node.classList.add("is-hovered"); });
  }

  els.doc.addEventListener("mousemove", function (event) {
    var el = event.target.closest("[data-block]");
    setHoveredBlock(el ? el.getAttribute("data-block") : null);
  });

  els.doc.addEventListener("mouseleave", function () { setHoveredBlock(null); });

  document.addEventListener("pointerdown", function (event) {
    if (!state.editing) return;
    if (event.target.closest(".block-editor")) return;
    if (event.target.closest("[data-block]")) return;
    if (event.target.closest("li.footnote-item[data-label]")) return;
    stopEditing();
    renderDoc();
  });

  // ------------------------------------------------------------------ chrome

  document.getElementById("btn-source").addEventListener("click", function (event) {
    els.sourceSection.hidden = !els.sourceSection.hidden;
    event.currentTarget.textContent = els.sourceSection.hidden ? "Show source" : "Hide source";
    updateSourcePane();
  });

  document.getElementById("btn-reset").addEventListener("click", function () {
    load(window.SAMPLE_MARKDOWN);
    els.log.innerHTML = '<li class="log-empty">Nothing committed yet.</li>';
  });

  document.getElementById("btn-selftest").addEventListener("click", runSelfTest);

  // --------------------------------------------------------------- self test

  function runSelfTest() {
    stopEditing();
    var results = [];
    var startSource = source();
    var startBlocks = state.blocks.length;
    var startCommits = state.commits;

    results.push(["parse/serialize round-trip", serializeDoc(parseDoc(startSource)) === startSource]);

    var tricky = [
      "a\n\nb",
      "```\n\nfence with a blank line\n\n```\n",
      "- one\n\n- loose\n\n- list\n",
      "# h\n\n\n\nlots of blank lines\n\n\n",
      "no trailing newline",
      "",
      "\n\n\n",
      "> quote\n> more\n\npara\n",
      "| a | b |\n| - | - |\n| 1 | 2 |\n",
      "para[^a]\n\n[^a]: note\n",
      "[ref]: https://example.com\n[two]: https://example.org\n\npara [x][ref]\n",
      "text\n<div>\nhtml\n</div>\n\nafter\n",
      "((::hidden::))\n\nvisible\n",
    ];
    results.push(["tricky sources round-trip", tricky.every(function (t) {
      return serializeDoc(parseDoc(t)) === t;
    })]);

    /* Definition lines must be reachable, not stranded in a separator. */
    var defDoc = parseDoc("para[^a]\n\n[site]: https://example.com\n\n[^a]: the note\n");
    results.push(["definition lines become blocks", defDoc.blocks.length === 3]);

    for (var i = 0; i < state.blocks.length; i++) {
      startEditing(i, "end");
      stopEditing();
    }
    results.push(["visiting every block writes nothing",
      source() === startSource && state.blocks.length === startBlocks]);
    results.push(["no commits logged while visiting", state.commits === startCommits]);

    if (state.blocks.length) {
      startEditing(0, "end");
      state.editing.value = state.editing.value + " EDITED";
      stopEditing({ commit: false });
      results.push(["escape discards the edit", source() === startSource]);
    }

    /* The token-slice render must equal a plain whole-document render. */
    var rendered = renderDocument();
    var rebuilt = rendered.blocks.map(function (b) { return b.raw ? "" : b.html; }).join("") + rendered.tail;
    var whole = sanitize(md.render(source(), {}));
    var normalise = function (s) { return s.replace(/\s+/g, " ").trim(); };
    results.push(["slice render equals whole-document render", normalise(rebuilt) === normalise(whole)]);

    /* A footnote in the tail must trace back to a real definition block. */
    var traced = rendered.labels.length === 0 ||
      rendered.labels.every(function (label) { return definitionBlockFor(label) >= 0; });
    results.push(["every footnote traces to its definition block", traced]);

    /* The custom comment syntax must render, and must not move a boundary. */
    var commentSrc = "para one\n\ntext ((:a comment\nspanning two lines:)) after\n\npara three\n";
    var commentDoc = parseDoc(commentSrc);
    results.push(["multi-line comment does not shift block boundaries",
      commentDoc.blocks.length === 3 && serializeDoc(commentDoc) === commentSrc]);
    results.push(["comment renders as a marker, not as literal text",
      md.render("text ((:hello:)) after", {}).indexOf("md-comment-dot") !== -1]);
    results.push(["hidden comment renders as nothing",
      md.render("((::secret::))", {}).replace(/<[^>]*>/g, "").trim() === ""]);

    /* The margin marker: a hidden comment must be findable even when it leaves
       no trace in the rendered output. */
    var markerProbe = function (src) {
      var env = {};
      md.parse(src, env);
      return (env.hiddenComments || []).length;
    };
    results.push(["inline hidden comment is flagged",
      markerProbe("a line ((::note::)) and more\n") === 1]);
    results.push(["plain block is not flagged",
      markerProbe("a line with no comment\n") === 0]);
    results.push(["visible comment is not flagged",
      markerProbe("a line ((:visible:)) here\n") === 0]);
    results.push(["hidden comment inside a fence is not flagged",
      markerProbe("```\n((::not a comment here::))\n```\n") === 0]);

    renderDoc();

    var failed = results.filter(function (r) { return !r[1]; });
    results.forEach(function (r) {
      log((r[1] ? "PASS  " : "FAIL  ") + r[0], r[1] ? "ok" : "warn");
    });
    log("self-test: " + (results.length - failed.length) + "/" + results.length + " passed",
        failed.length ? "warn" : "ok");
  }

  // ------------------------------------------------------------------- boot

  function load(src) {
    var doc = parseDoc(src);
    state.blocks = doc.blocks;
    state.seps = doc.seps;
    state.baseline = src;
    state.editing = null;
    state.commits = 0;
    els.doc.textContent = "";
    renderDoc();
  }

  load(window.SAMPLE_MARKDOWN);

  window.BlockEdit = {
    state: state,
    source: source,
    parseDoc: parseDoc,
    serializeDoc: serializeDoc,
    renderDocument: renderDocument,
    definitionBlockFor: definitionBlockFor,
    startEditing: startEditing,
    stopEditing: stopEditing,
    runSelfTest: runSelfTest,
  };
})();
