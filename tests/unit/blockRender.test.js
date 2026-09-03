import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { beforeAll, describe, expect, it } from "vitest";

import { createBlockModel } from "../../lib/blockModel.js";
import { createBlockRenderer } from "../../lib/blockRender.js";

/**
 * Loaded through MDrender.js rather than by configuring markdown-it here, so
 * these tests exercise the same parser, the same plugins and the same custom
 * comment rule the app runs.
 */
let md;
let model;
let renderer;

beforeAll(() => {
  const context = { console };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  context.Event = class { constructor(type) { this.type = type; } };
  context.CustomEvent = class { constructor(type, init) { this.type = type; Object.assign(this, init); } };
  context.dispatchEvent = () => {};
  vm.createContext(context);

  const load = (relative) => {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    vm.runInContext(readFileSync(path, "utf8"), context, { filename: relative });
  };

  [
    "markdown-it.min.js",
    "markdown-it-footnote.min.js",
    "markdown-it-deflist.min.js",
    "markdown-it-sub.min.js",
    "markdown-it-sup.min.js",
    "markdown-it-mark.min.js",
    "markdown-it-attrs.browser.js",
    "markdown-it-task-lists.min.js",
  ].forEach((name) => load(`../../vendor/${name}`));

  load("../../MDrender.js");

  md = context.LightMDRenderer.md;
  expect(md).toBeTruthy();
  model = createBlockModel(md);
  renderer = createBlockRenderer(md, model);
});

const render = (source) => renderer.renderBlocks(model.parseDoc(source));
const normalise = (html) => html.replace(/\s+/g, " ").trim();
const joined = (result) =>
  result.blocks.map((block) => (block.kind === "html" ? block.html : "")).join("") + result.tail;

const DOCUMENTS = [
  "# Title\n\nA paragraph.\n\nAnother.\n",
  "para [x][ref]\n\n[ref]: https://example.com\n",
  "para[^a]\n\n[^a]: the note\n",
  "one[^a] two[^b]\n\n[^b]: second\n\n[^a]: first\n",
  "- a\n    - nested\n- b\n\npara\n",
  "```js\nconst x = 1;\n\nconst y = 2;\n```\n\nafter\n",
  "| a | b |\n| - | - |\n| 1 | 2 |\n\nafter\n",
  "> quote\n> more\n\npara\n",
  "text\n<div>\nhtml block\n</div>\n\nafter\n",
  "# h\n\n---\n\n![img](a.png)\n",
  "text ((:visible:)) here\n\nnext ((::hidden::)) there\n",
  "para\n\n((::a whole hidden block::))\n\nafter\n",
  "",
];

describe("renderBlocks", () => {
  it("produces the same HTML as a plain whole-document render", () => {
    DOCUMENTS.forEach((source) => {
      const whole = md.render(source, {});
      expect(normalise(joined(render(source)))).toBe(normalise(whole));
    });
  });

  it("returns one entry per block", () => {
    DOCUMENTS.forEach((source) => {
      const doc = model.parseDoc(source);
      expect(renderer.renderBlocks(doc).blocks).toHaveLength(doc.blocks.length);
    });
  });

  it("never leaves a block unmapped", () => {
    DOCUMENTS.forEach((source) => {
      expect(render(source).unmapped).toEqual([]);
    });
  });

  it("returns a definition block as its own source, not as HTML", () => {
    const result = render("para [x][ref]\n\n[ref]: https://example.com\n");
    expect(result.blocks[0].kind).toBe("html");
    expect(result.blocks[1]).toEqual({
      kind: "source",
      source: "[ref]: https://example.com",
      hidden: false,
    });
  });

  it("returns a block that is only a hidden comment as source, and flags it", () => {
    const result = render("para\n\n((::a whole hidden block::))\n\nafter\n");
    expect(result.blocks[1].kind).toBe("source");
    expect(result.blocks[1].source).toBe("((::a whole hidden block::))");
  });

  it("flags a block carrying an inline hidden comment", () => {
    const result = render("plain paragraph\n\nsecond ((::note::)) paragraph\n");
    expect(result.blocks[0].hidden).toBe(false);
    expect(result.blocks[1].hidden).toBe(true);
  });

  it("does not flag a visible comment or a comment inside a fence", () => {
    expect(render("text ((:visible:)) here\n").blocks[0].hidden).toBe(false);
    expect(render("```\n((::not a comment here::))\n```\n").blocks[0].hidden).toBe(false);
  });

  it("resolves a reference link defined in another block", () => {
    const result = render("para [x][ref]\n\n[ref]: https://example.com\n");
    expect(result.blocks[0].html).toContain('href="https://example.com"');
  });

  it("numbers footnotes in document order, not authoring order", () => {
    const result = render("one[^a] two[^b]\n\n[^b]: second\n\n[^a]: first\n");
    expect(result.blocks[0].html).toContain("#fn1");
    expect(result.blocks[0].html).toContain("#fn2");
    expect(result.labels).toEqual(["a", "b"]);
  });

  it("puts the footnote list in the tail, owned by no block", () => {
    const result = render("para[^a]\n\n[^a]: the note\n");
    expect(result.tail).toContain("footnotes");
    result.blocks.forEach((block) => {
      if (block.kind === "html") expect(block.html).not.toContain("footnotes-list");
    });
  });

  it("keeps a multi-element block together", () => {
    const result = render("# t\n\n<div>one</div>\n<div>two</div>\n\nafter\n");
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[1].html).toContain("one");
    expect(result.blocks[1].html).toContain("two");
  });

  it("keeps an image block as HTML rather than treating it as empty", () => {
    const result = render("![alt](a.png)\n");
    expect(result.blocks[0].kind).toBe("html");
  });

  it("keeps a horizontal rule as HTML", () => {
    expect(render("---\n").blocks[0].kind).toBe("html");
  });
});

describe("definitionBlockFor", () => {
  it("finds the block holding a footnote definition", () => {
    const doc = model.parseDoc("para[^a]\n\n[^a]: the note\n");
    expect(renderer.definitionBlockFor(doc, "a")).toBe(1);
  });

  it("returns -1 when there is none", () => {
    const doc = model.parseDoc("para\n");
    expect(renderer.definitionBlockFor(doc, "a")).toBe(-1);
  });

  it("does not confuse similar labels", () => {
    const doc = model.parseDoc("x[^ab]\n\n[^a]: one\n\n[^ab]: two\n");
    expect(renderer.definitionBlockFor(doc, "a")).toBe(1);
    expect(renderer.definitionBlockFor(doc, "ab")).toBe(2);
  });
});
