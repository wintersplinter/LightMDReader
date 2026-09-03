/**
 * Rendering for block editing.
 *
 * The whole document is parsed ONCE into a shared markdown-it environment, the
 * top-level tokens are grouped, and each block is rendered from its own slice
 * of that single token stream. One parse is what makes reference-style links
 * resolve across blocks and footnotes number in document order: rendering each
 * block's source separately would leave every definition out of scope.
 *
 * Three kinds of thing come out of this, and the difference matters:
 *
 *   - an ordinary block, which has a token group and renders to HTML
 *   - a definition block, which has source lines but no tokens at all, because
 *     markdown-it moved it into the environment ("[x]: url", "[^a]: note").
 *     There is nothing to render, so its own source is returned instead
 *   - the footnote tail, which has no source lines at all. It is synthesised
 *     from the environment, belongs to no block, and can never be edited
 *
 * Nothing here touches the DOM or sanitises anything. It returns strings; the
 * caller sanitises them and builds nodes, so this file can be unit tested and
 * so the app's own inert-fragment and image-hydration path stays in charge of
 * what actually reaches the page.
 */

/**
 * A block whose rendered output would show nothing — a definition, a hidden
 * comment — is reported as source instead, so it stays visible and reachable.
 */
function rendersToNothing(html) {
  if (!html) return true;
  if (/<(img|hr|input|br|video|audio|iframe|svg|table|figure|picture|object)\b/i.test(html)) {
    return false;
  }
  return html.replace(/<[^>]*>/g, "").trim() === "";
}

/**
 * @param {object} md A configured markdown-it instance.
 * @param {object} model The block model from lib/blockModel.js, bound to the
 *   same parser.
 */
export function createBlockRenderer(md, model) {
  /**
   * @param {{blocks: string[][], seps: string[][]}} doc
   * @returns {{blocks: Array, tail: string, labels: string[]}}
   *   Each block is either { kind: "html", html, hidden } or
   *   { kind: "source", source, hidden }.
   */
  function renderBlocks(doc) {
    const source = model.serializeDoc(doc);
    const env = {};
    let tokens;

    try {
      tokens = md.parse(source, env);
    } catch (error) {
      // A parse failure must still show the document. Every block falls back
      // to its own source, which is always safe to display and to edit.
      return {
        blocks: doc.blocks.map((_, index) => ({
          kind: "source",
          source: model.blockText(doc, index),
          hidden: false,
        })),
        tail: "",
        labels: [],
        error,
      };
    }

    // Group the token stream into top-level runs.
    const groups = [];
    let current = null;
    let depth = 0;

    tokens.forEach((token) => {
      if (!current) current = { map: token.map, tokens: [] };
      current.tokens.push(token);
      depth += token.nesting;
      if (depth === 0) {
        groups.push(current);
        current = null;
      }
    });
    if (current) groups.push(current);

    const offsets = model.blockOffsets(doc);
    const perBlock = offsets.map(() => []);
    const tailTokens = [];
    const unmapped = [];

    groups.forEach((group) => {
      if (!group.map) {
        tailTokens.push(...group.tokens);
        return;
      }

      const line = group.map[0];
      const index = offsets.findIndex(([start, end]) => line >= start && line < end);

      // A group belonging to no block would mean the partition and the parse
      // disagree, which must not happen. Report it rather than dropping it.
      if (index === -1) {
        unmapped.push(line);
        return;
      }

      perBlock[index].push(...group.tokens);
    });

    const hiddenLines = new Set(env.hiddenComments || []);
    const holdsHiddenComment = (index) => {
      for (let line = offsets[index][0]; line < offsets[index][1]; line += 1) {
        if (hiddenLines.has(line)) return true;
      }
      return false;
    };

    const blocks = perBlock.map((slice, index) => {
      const hidden = holdsHiddenComment(index);
      const html = slice.length ? md.renderer.render(slice, md.options, env) : "";

      if (rendersToNothing(html)) {
        return { kind: "source", source: model.blockText(doc, index), hidden };
      }

      return { kind: "html", html, hidden };
    });

    // Footnote labels in rendered order, so an entry in the tail can be traced
    // back to the definition block that produced it.
    let labels = [];
    const footnotes = env.footnotes || {};

    if (Array.isArray(footnotes.list)) {
      labels = footnotes.list.map((item) => item && item.label);
    }
    if (!labels.length && footnotes.refs) {
      Object.keys(footnotes.refs).forEach((key) => {
        labels[footnotes.refs[key]] = key.replace(/^:/, "");
      });
    }

    return {
      blocks,
      tail: tailTokens.length ? md.renderer.render(tailTokens, md.options, env) : "",
      labels,
      unmapped,
    };
  }

  /** Which block holds the definition of a footnote label, or -1. */
  function definitionBlockFor(doc, label) {
    const escaped = String(label).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`^\\s*\\[\\^${escaped}\\]:`);

    for (let index = 0; index < doc.blocks.length; index += 1) {
      if (pattern.test(model.blockText(doc, index))) return index;
    }

    return -1;
  }

  return { renderBlocks, definitionBlockFor };
}
