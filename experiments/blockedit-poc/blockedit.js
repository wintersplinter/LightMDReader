/* Block editing proof of concept.
 *
 * One idea, tested in isolation: the block the cursor is in is shown as raw
 * Markdown; every other block is shown rendered. Moving between blocks must
 * never change the document.
 *
 * The document model is a strict partition of the source lines into
 * alternating separators and blocks:
 *
 *   seps[0] blocks[0] seps[1] blocks[1] ... blocks[n-1] seps[n]
 *
 * Every line of the source appears exactly once, in order, so serialising is
 * byte-identical to the input by construction. That is the whole safety story.
 */

(function () {
  "use strict";

  // ---------------------------------------------------------------- renderer

  var md = window
    .markdownit({ breaks: false, html: true, linkify: true, typographer: true })
    .use(window.markdownItAttrs)
    .use(window.markdownitMark);

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  /* The one custom Markdown item carried over from the app. */
  function renderCustomComments(markdownText) {
    return String(markdownText || "")
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

  function renderMarkdown(text) {
    return DOMPurify.sanitize(md.render(renderCustomComments(text)));
  }

  // ------------------------------------------------------------ block splits

  /* Top-level block ranges, taken from markdown-it's own line map.
     Nested tokens are skipped because their parent already covered the lines,
     which is what makes a whole list or a whole fence a single block. */
  function blockRanges(src, lines) {
    var tokens;
    try {
      tokens = md.parse(src, {});
    } catch (error) {
      tokens = [];
    }

    var ranges = [];
    var cursor = 0;

    tokens.forEach(function (token) {
      if (!token.map) return;
      var start = token.map[0];
      var rawEnd = token.map[1];
      if (start < cursor) return;
      cursor = Math.max(cursor, rawEnd);

      /* Trailing blank lines belong to the separator, not to the block. */
      var end = rawEnd;
      while (end > start && String(lines[end - 1] || "").trim() === "") end--;
      if (end <= start) return;

      ranges.push([start, end]);
    });

    return ranges;
  }

  function parseDoc(src) {
    var lines = String(src).split("\n");
    var ranges = blockRanges(src, lines);
    var blocks = [];
    var seps = [];
    var prev = 0;

    ranges.forEach(function (range) {
      seps.push(lines.slice(prev, range[0]));
      blocks.push(lines.slice(range[0], range[1]));
      prev = range[1];
    });
    seps.push(lines.slice(prev));

    return { blocks: blocks, seps: seps };
  }

  function serializeDoc(doc) {
    var out = [];
    doc.seps.forEach(function (sep, i) {
      out.push.apply(out, sep);
      if (i < doc.blocks.length) out.push.apply(out, doc.blocks[i]);
    });
    return out.join("\n");
  }

  // ------------------------------------------------------------------- state

  var state = {
    blocks: [],
    seps: [[]],
    baseline: "",
    editing: null, // { index } for an existing block, { at, isNew: true } otherwise
    commits: 0,
  };

  var els = {
    doc: document.getElementById("doc"),
    log: document.getElementById("log"),
    source: document.getElementById("source"),
    sourceSection: document.getElementById("source-section"),
    statBlocks: document.getElementById("stat-blocks"),
    statDirty: document.getElementById("stat-dirty"),
    statCommits: document.getElementById("stat-commits"),
  };

  function source() {
    return serializeDoc(state);
  }

  function blockText(i) {
    return state.blocks[i].join("\n");
  }

  // -------------------------------------------------------------- edit model

  /* Replace blocks[from .. from+count-1] with whatever `text` parses into.
     Returns the number of blocks the text produced. */
  function spliceBlocks(from, count, text) {
    var sub = parseDoc(text);
    var k = sub.blocks.length;
    var before = state.seps[from].concat(sub.seps[0]);
    var after = sub.seps[k].concat(state.seps[from + count]);
    var newSeps = k === 0 ? [before.concat(after)] : [before].concat(sub.seps.slice(1, k), [after]);

    state.seps.splice.apply(state.seps, [from, count + 1].concat(newSeps));
    state.blocks.splice.apply(state.blocks, [from, count].concat(sub.blocks));
    return k;
  }

  /* Insert new blocks at index `at`, keeping a blank line on both sides. */
  function insertBlocks(at, text) {
    var sub = parseDoc(text);
    var k = sub.blocks.length;
    if (!k) return 0;

    var existing = state.seps[at];
    var before;
    var after;

    if (state.blocks.length === 0) {
      before = [];
      after = existing;
    } else if (at < state.blocks.length) {
      before = existing;
      after = [""];
    } else {
      before = [""];
      after = existing;
    }

    var newSeps = [before].concat(sub.seps.slice(1, k), [after]);
    state.seps.splice.apply(state.seps, [at, 1].concat(newSeps));
    state.blocks.splice.apply(state.blocks, [at, 0].concat(sub.blocks));
    return k;
  }

  // ------------------------------------------------------------------ render

  function makeBlockElement(i) {
    var el = document.createElement("div");
    el.className = "block";
    el.dataset.index = String(i);
    el.innerHTML = renderMarkdown(blockText(i));
    return el;
  }

  function autosize(ta) {
    ta.style.height = "auto";
    ta.style.height = ta.scrollHeight + "px";
  }

  function makeEditorElement() {
    var wrap = document.createElement("div");
    wrap.className = "block-editor";
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

  function renderDoc() {
    var frag = document.createDocumentFragment();
    var n = state.blocks.length;
    var editing = state.editing;

    for (var i = 0; i <= n; i++) {
      if (editing && editing.isNew && editing.at === i) frag.appendChild(makeEditorElement());
      if (i < n) {
        if (editing && !editing.isNew && editing.index === i) frag.appendChild(makeEditorElement());
        else frag.appendChild(makeBlockElement(i));
      }
    }

    els.doc.textContent = "";
    els.doc.appendChild(frag);

    var ta = els.doc.querySelector("textarea");
    if (ta) {
      autosize(ta);
      ta.focus();
      var caret = state.editing.caret;
      if (caret === "end" || caret == null) caret = ta.value.length;
      ta.setSelectionRange(caret, caret);
      ta.scrollIntoView({ block: "nearest" });
    }

    updateStats();
    updateSourcePane();
  }

  function updateStats() {
    els.statBlocks.textContent = String(state.blocks.length);
    els.statCommits.textContent = String(state.commits);
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

  /* Close the current editor.
     Returns { shiftFrom, delta } so a caller that holds a block index taken
     before the commit can correct it. */
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

    /* The guarantee: identical text is never written back. */
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

  // -------------------------------------------------------------- keyboard

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

    /* Backspace at the very start merges into the block above. */
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

    /* Delete at the very end pulls the next block up. */
    if (event.key === "Delete" && atEnd && !editing.isNew && index < state.blocks.length - 1) {
      event.preventDefault();
      var here = ta.value;
      var mergedDown = here + "\n" + blockText(index + 1);
      spliceBlocks(index, 2, mergedDown);
      state.commits++;
      log("> merged block " + (index + 1) + " into " + index, "warn");
      state.editing = null;
      startEditing(index, here.length);
      return;
    }
  }

  // ---------------------------------------------------------------- pointing

  els.doc.addEventListener("click", function (event) {
    if (event.target.closest("a[href]")) return;
    if (event.target.closest("textarea")) return;
    var blockEl = event.target.closest(".block");
    if (!blockEl) return;

    var index = Number(blockEl.dataset.index);
    var shift = stopEditing();
    if (shift.delta && index >= shift.shiftFrom) index += shift.delta;
    startEditing(Math.max(0, Math.min(state.blocks.length - 1, index)), "end");
  });

  document.addEventListener("pointerdown", function (event) {
    if (!state.editing) return;
    if (event.target.closest(".block-editor")) return;
    if (event.target.closest(".block")) return; // the click handler deals with it
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

    /* 1. parse/serialize is byte-identical. */
    results.push(["parse/serialize round-trip", serializeDoc(parseDoc(startSource)) === startSource]);

    /* 2. tricky sources survive the round-trip too. */
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
    ];
    var trickyOk = tricky.every(function (t) {
      return serializeDoc(parseDoc(t)) === t;
    });
    results.push(["tricky sources round-trip", trickyOk]);

    /* 3. visiting every block without typing changes nothing. */
    for (var i = 0; i < state.blocks.length; i++) {
      startEditing(i, "end");
      stopEditing();
    }
    var visitOk = source() === startSource && state.blocks.length === startBlocks;
    results.push(["visiting every block writes nothing", visitOk]);
    results.push(["no commits logged while visiting", state.commits === startCommits]);

    /* 4. an escaped edit is discarded. */
    if (state.blocks.length) {
      startEditing(0, "end");
      state.editing.value = state.editing.value + " EDITED";
      stopEditing({ commit: false });
      results.push(["escape discards the edit", source() === startSource]);
    }

    /* 5. every block renders on its own. */
    var renderOk = true;
    for (var j = 0; j < state.blocks.length; j++) {
      try {
        renderMarkdown(blockText(j));
      } catch (error) {
        renderOk = false;
      }
    }
    results.push(["every block renders in isolation", renderOk]);

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
    renderDoc();
  }

  load(window.SAMPLE_MARKDOWN);

  window.BlockEdit = {
    state: state,
    source: source,
    parseDoc: parseDoc,
    serializeDoc: serializeDoc,
    startEditing: startEditing,
    stopEditing: stopEditing,
    runSelfTest: runSelfTest,
  };
})();
