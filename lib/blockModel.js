/**
 * The block model for block editing.
 *
 * A document is a strict partition of its own source lines into alternating
 * separators and blocks:
 *
 *   seps[0] blocks[0] seps[1] blocks[1] ... blocks[n-1] seps[n]
 *
 * Every line of the source appears exactly once, in order, so serialising is
 * byte-identical to the input by construction rather than by a normalisation
 * pass that happens to be lossless today. That property is the whole safety
 * story of block editing: the editor can never quietly rewrite a document it
 * was only asked to display.
 *
 * Blocks come from two places:
 *   - the line map of each top-level markdown-it token
 *   - any run of non-blank lines no token claimed
 *
 * The second rule is what makes link references ("[x]: url") and footnote
 * definitions ("[^a]: note") reachable. markdown-it swallows those into its
 * environment during the block parse: they produce no token and no line map,
 * so without this rule they would be preserved in the file but invisible and
 * uneditable. It is deliberately not a footnote special case — it catches
 * anything a parser plugin moves into the environment.
 *
 * Everything here is pure and free of DOM access so that it can be unit
 * tested directly. The parser is injected rather than imported, so this file
 * has no dependencies and the caller decides which markdown-it build and
 * which plugins are in play.
 */

/**
 * @param {object} md A configured markdown-it instance.
 * @returns {object} The block model bound to that parser.
 */
export function createBlockModel(md) {
  /**
   * Top-level block ranges as [startLine, endLine) pairs, sorted.
   *
   * Trailing blank lines are trimmed off a range so they belong to the
   * separator that follows, which keeps blank-line runs verbatim.
   */
  function blockRanges(src, lines) {
    let tokens;

    try {
      tokens = md.parse(src, {});
    } catch (error) {
      // A parse failure must not lose the document. Treating everything as
      // unclaimed still partitions every line, so the text survives and stays
      // editable as raw source.
      tokens = [];
    }

    const ranges = [];
    let cursor = 0;

    tokens.forEach((token) => {
      if (!token.map) return;

      const start = token.map[0];
      const rawEnd = token.map[1];

      // Nested tokens start inside a range their parent already covered, which
      // is what makes a whole list or a whole fence a single block.
      if (start < cursor) return;
      cursor = Math.max(cursor, rawEnd);

      let end = rawEnd;
      while (end > start && String(lines[end - 1] ?? "").trim() === "") end -= 1;
      if (end <= start) return;

      ranges.push([start, end]);
    });

    const claimed = new Set();
    ranges.forEach(([start, end]) => {
      for (let line = start; line < end; line += 1) claimed.add(line);
    });

    let runStart = null;
    for (let line = 0; line <= lines.length; line += 1) {
      const unclaimed = line < lines.length && !claimed.has(line) && lines[line].trim() !== "";

      if (unclaimed) {
        if (runStart === null) runStart = line;
      } else if (runStart !== null) {
        ranges.push([runStart, line]);
        runStart = null;
      }
    }

    ranges.sort((a, b) => a[0] - b[0]);
    return ranges;
  }

  /** Split a source string into the partition described at the top of this file. */
  function parseDoc(src) {
    const lines = String(src).split("\n");
    const ranges = blockRanges(String(src), lines);
    const blocks = [];
    const seps = [];
    let prev = 0;

    ranges.forEach(([start, end]) => {
      seps.push(lines.slice(prev, start));
      blocks.push(lines.slice(start, end));
      prev = end;
    });
    seps.push(lines.slice(prev));

    return { blocks, seps };
  }

  /** Rebuild the source. `serializeDoc(parseDoc(src)) === src` for every src. */
  function serializeDoc(doc) {
    const out = [];

    doc.seps.forEach((sep, index) => {
      out.push(...sep);
      if (index < doc.blocks.length) out.push(...doc.blocks[index]);
    });

    return out.join("\n");
  }

  /** The text of one block. */
  function blockText(doc, index) {
    return doc.blocks[index].join("\n");
  }

  /**
   * Line range of each block within the serialised document. Derived on
   * demand, never stored, so it cannot drift from the partition.
   */
  function blockOffsets(doc) {
    const offsets = [];
    let line = 0;

    for (let index = 0; index < doc.blocks.length; index += 1) {
      line += doc.seps[index].length;
      offsets.push([line, line + doc.blocks[index].length]);
      line += doc.blocks[index].length;
    }

    return offsets;
  }

  /**
   * Replace blocks[from .. from + count - 1] with whatever `text` parses into.
   * Mutates `doc`. Returns how many blocks the text produced: 0 means the
   * range was deleted, more than 1 means it split.
   */
  function spliceBlocks(doc, from, count, text) {
    const sub = parseDoc(text);
    const produced = sub.blocks.length;

    let newSeps;

    if (produced === 0) {
      // The range was deleted. The gap before it and the gap after it are now
      // one gap, not the sum of two, so keep the leading one and drop the
      // rest. Concatenating them instead would grow a blank line every time a
      // block is emptied, and the replacement text's own whitespace is not
      // content the user asked to keep.
      newSeps = [doc.seps[from].slice()];
    } else {
      const before = doc.seps[from].concat(sub.seps[0]);
      const after = sub.seps[produced].concat(doc.seps[from + count]);
      newSeps = [before, ...sub.seps.slice(1, produced), after];
    }

    doc.seps.splice(from, count + 1, ...newSeps);
    doc.blocks.splice(from, count, ...sub.blocks);

    return produced;
  }

  /**
   * Insert whatever `text` parses into at block index `at`, keeping a blank
   * line between it and its neighbours. Mutates `doc`. Returns how many blocks
   * were inserted; empty text inserts nothing.
   */
  function insertBlocks(doc, at, text) {
    const sub = parseDoc(text);
    const produced = sub.blocks.length;
    if (!produced) return 0;

    const existing = doc.seps[at];
    let before;
    let after;

    if (doc.blocks.length === 0) {
      before = [];
      after = existing;
    } else if (at < doc.blocks.length) {
      before = existing;
      after = [""];
    } else {
      before = [""];
      after = existing;
    }

    doc.seps.splice(at, 1, before, ...sub.seps.slice(1, produced), after);
    doc.blocks.splice(at, 0, ...sub.blocks);

    return produced;
  }

  return {
    blockRanges,
    parseDoc,
    serializeDoc,
    blockText,
    blockOffsets,
    spliceBlocks,
    insertBlocks,
  };
}
