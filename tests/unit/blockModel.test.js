import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { createBlockModel } from "../../lib/blockModel.js";

/**
 * The parser under test is the vendored build the app actually ships, not
 * whatever npm happens to resolve, so these tests fail if a vendor bump
 * changes line-mapping behaviour.
 */
function loadVendoredMarkdownIt() {
  const context = { console };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);

  const vendored = [
    "markdown-it.min.js",
    "markdown-it-footnote.min.js",
    "markdown-it-deflist.min.js",
    "markdown-it-sub.min.js",
    "markdown-it-sup.min.js",
    "markdown-it-mark.min.js",
    "markdown-it-attrs.browser.js",
    "markdown-it-task-lists.min.js",
  ];

  vendored.forEach((name) => {
    const path = fileURLToPath(new URL(`../../vendor/${name}`, import.meta.url));
    vm.runInContext(readFileSync(path, "utf8"), context, { filename: name });
  });

  return context
    .markdownit({ breaks: false, html: true, linkify: true, typographer: true })
    .use(context.markdownitFootnote)
    .use(context.markdownitDeflist)
    .use(context.markdownitSub)
    .use(context.markdownitSup)
    .use(context.markdownitMark)
    .use(context.markdownItAttrs)
    .use(context.markdownitTaskLists, { enabled: false, label: true, labelAfter: true });
}

const model = createBlockModel(loadVendoredMarkdownIt());
const { parseDoc, serializeDoc, blockText, blockOffsets, spliceBlocks, insertBlocks } = model;

/** seps and blocks must always interleave, or the partition is broken. */
function expectPartitionIntact(doc) {
  expect(doc.seps.length).toBe(doc.blocks.length + 1);
  doc.blocks.forEach((block) => {
    expect(block.length).toBeGreaterThan(0);
    expect(block.join("\n").trim()).not.toBe("");
  });
}

const CORPUS = [
  "",
  "\n",
  "\n\n\n",
  "no trailing newline",
  "one\n",
  "a\n\nb",
  "a\n\nb\n",
  "# heading\n\nparagraph\n",
  "# h\n\n\n\nlots of blank lines\n\n\n",
  "- one\n- two\n- three\n",
  "- one\n\n- loose\n\n- list\n",
  "1. a\n2. b\n\n   indented continuation\n",
  "```\n\nfence with a blank line\n\n```\n",
  "```python\ndef f():\n\n    return 1\n```\n",
  "> quote\n> more\n\npara\n",
  "| a | b |\n| - | - |\n| 1 | 2 |\n",
  "---\n\nafter a rule\n",
  "text\n<div>\nan html block\n</div>\n\nafter\n",
  "Setext\n======\n\nbody\n",
  "para with a footnote[^a]\n\n[^a]: the note\n",
  "[^a]: note\n    with a continuation line\n\npara[^a]\n",
  "[ref]: https://example.com\n[two]: https://example.org\n\npara [x][ref]\n",
  "para\n\n[ref]: https://example.com \"Title\"\n",
  "((::a hidden comment::))\n\nvisible\n",
  "text ((:a visible comment:)) more\n",
  "﻿leading BOM-ish character\n",
  "trailing spaces   \n\nnext\n",
  "\ttab indented code\n\npara\n",
];

describe("parseDoc / serializeDoc", () => {
  it("round-trips every source byte for byte", () => {
    CORPUS.forEach((src) => {
      expect(serializeDoc(parseDoc(src))).toBe(src);
    });
  });

  it("keeps the partition intact for every source", () => {
    CORPUS.forEach((src) => expectPartitionIntact(parseDoc(src)));
  });

  it("assigns every line to exactly one slot", () => {
    CORPUS.forEach((src) => {
      const doc = parseDoc(src);
      const total = doc.seps.reduce((sum, sep) => sum + sep.length, 0)
        + doc.blocks.reduce((sum, block) => sum + block.length, 0);
      expect(total).toBe(src.split("\n").length);
    });
  });

  it("treats a whole container as one block", () => {
    expect(parseDoc("- a\n    - nested\n- b\n").blocks).toHaveLength(1);
    expect(parseDoc("```\n\nblank inside\n\n```\n").blocks).toHaveLength(1);
    expect(parseDoc("| a | b |\n| - | - |\n| 1 | 2 |\n").blocks).toHaveLength(1);
    expect(parseDoc("> one\n> two\n").blocks).toHaveLength(1);
  });

  it("does not split a fenced block on its blank lines", () => {
    const doc = parseDoc("```\nfirst\n\nsecond\n```\n");
    expect(doc.blocks).toHaveLength(1);
    expect(blockText(doc, 0)).toContain("\n\nsecond");
  });
});

describe("definition blocks", () => {
  it("makes link references reachable as their own block", () => {
    const doc = parseDoc("para [x][ref]\n\n[ref]: https://example.com\n");
    expect(doc.blocks).toHaveLength(2);
    expect(blockText(doc, 1)).toBe("[ref]: https://example.com");
  });

  it("makes footnote definitions reachable, continuation lines included", () => {
    const doc = parseDoc("para[^a]\n\n[^a]: the note\n    continued here\n");
    expect(doc.blocks).toHaveLength(2);
    expect(blockText(doc, 1)).toBe("[^a]: the note\n    continued here");
  });

  it("groups a run of adjacent definitions into one block", () => {
    const doc = parseDoc("[a]: https://a.example\n[b]: https://b.example\n\npara\n");
    expect(doc.blocks).toHaveLength(2);
    expect(blockText(doc, 0)).toBe("[a]: https://a.example\n[b]: https://b.example");
  });

  it("separates definitions that have a blank line between them", () => {
    const doc = parseDoc("[^a]: one\n\n[^b]: two\n");
    expect(doc.blocks).toHaveLength(2);
  });

  it("leaves no non-blank line stranded in a separator", () => {
    CORPUS.forEach((src) => {
      const doc = parseDoc(src);
      doc.seps.forEach((sep) => {
        sep.forEach((line) => expect(line.trim()).toBe(""));
      });
    });
  });
});

describe("blockOffsets", () => {
  it("points at the block's own lines in the serialised document", () => {
    CORPUS.forEach((src) => {
      const doc = parseDoc(src);
      const lines = serializeDoc(doc).split("\n");
      blockOffsets(doc).forEach(([start, end], index) => {
        expect(lines.slice(start, end).join("\n")).toBe(blockText(doc, index));
      });
    });
  });
});

describe("spliceBlocks", () => {
  it("writing a block back unchanged leaves the document identical", () => {
    CORPUS.forEach((src) => {
      const doc = parseDoc(src);
      for (let index = 0; index < doc.blocks.length; index += 1) {
        spliceBlocks(doc, index, 1, blockText(doc, index));
      }
      expect(serializeDoc(doc)).toBe(src);
      expectPartitionIntact(doc);
    });
  });

  it("splits a block when a blank line is added", () => {
    const doc = parseDoc("# t\n\nfirst second\n\nlast\n");
    const produced = spliceBlocks(doc, 1, 1, "first\n\nsecond");
    expect(produced).toBe(2);
    expect(doc.blocks).toHaveLength(4);
    expect(serializeDoc(doc)).toBe("# t\n\nfirst\n\nsecond\n\nlast\n");
    expectPartitionIntact(doc);
  });

  it("removes a block when it is emptied", () => {
    const doc = parseDoc("one\n\ntwo\n\nthree\n");
    expect(spliceBlocks(doc, 1, 1, "")).toBe(0);
    expect(doc.blocks).toHaveLength(2);
    expect(serializeDoc(doc)).toBe("one\n\nthree\n");
    expectPartitionIntact(doc);
  });

  it("merges two blocks into one", () => {
    const doc = parseDoc("one\n\ntwo\n\nthree\n");
    spliceBlocks(doc, 0, 2, `${blockText(doc, 0)}\n${blockText(doc, 1)}`);
    expect(doc.blocks).toHaveLength(2);
    expect(serializeDoc(doc)).toBe("one\ntwo\n\nthree\n");
    expectPartitionIntact(doc);
  });

  it("does not swallow a heading merged into a paragraph", () => {
    // An ATX heading interrupts a paragraph in CommonMark, so this merge
    // cannot reduce the block count. Surprising, but correct.
    const doc = parseDoc("para\n\n## heading\n");
    const produced = spliceBlocks(doc, 0, 2, "para\n## heading");
    expect(produced).toBe(2);
    expect(serializeDoc(doc)).toContain("## heading");
  });

  it("accepts a paste that produces several blocks", () => {
    const doc = parseDoc("before\n\nmiddle\n\nafter\n");
    expect(spliceBlocks(doc, 1, 1, "# a\n\n- x\n- y\n\n```\nz\n```")).toBe(3);
    expect(doc.blocks).toHaveLength(5);
    expectPartitionIntact(doc);
  });

  it("turns a paragraph into a definition block and back", () => {
    const doc = parseDoc("para\n\nplaceholder\n");
    spliceBlocks(doc, 1, 1, "[ref]: https://example.com");
    expect(serializeDoc(doc)).toBe("para\n\n[ref]: https://example.com\n");
    spliceBlocks(doc, 1, 1, "placeholder");
    expect(serializeDoc(doc)).toBe("para\n\nplaceholder\n");
    expectPartitionIntact(doc);
  });
});

describe("insertBlocks", () => {
  it("inserts at the start, keeping the document readable", () => {
    const doc = parseDoc("first\n\nsecond\n");
    expect(insertBlocks(doc, 0, "new")).toBe(1);
    expect(serializeDoc(doc)).toBe("new\n\nfirst\n\nsecond\n");
    expectPartitionIntact(doc);
  });

  it("inserts in the middle", () => {
    const doc = parseDoc("first\n\nsecond\n");
    insertBlocks(doc, 1, "new");
    expect(serializeDoc(doc)).toBe("first\n\nnew\n\nsecond\n");
    expectPartitionIntact(doc);
  });

  it("inserts at the end without losing the trailing newline", () => {
    const doc = parseDoc("first\n\nsecond\n");
    insertBlocks(doc, doc.blocks.length, "new");
    expect(serializeDoc(doc)).toBe("first\n\nsecond\n\nnew\n");
    expectPartitionIntact(doc);
  });

  it("inserts into an empty document", () => {
    const doc = parseDoc("");
    insertBlocks(doc, 0, "only");
    // The empty document's single empty line becomes the trailing newline
    // rather than a leading blank line, so the result is a well-formed file.
    expect(serializeDoc(doc)).toBe("only\n");
    expectPartitionIntact(doc);
  });

  it("does not grow a blank line each time a block is emptied", () => {
    const doc = parseDoc("one\n\ntwo\n\nthree\n\nfour\n");
    spliceBlocks(doc, 1, 1, "");
    spliceBlocks(doc, 1, 1, "");
    expect(serializeDoc(doc)).toBe("one\n\nfour\n");
    expectPartitionIntact(doc);
  });

  it("keeps the author's spacing when a block between wide gaps is removed", () => {
    const doc = parseDoc("one\n\n\ntwo\n\nthree\n");
    spliceBlocks(doc, 1, 1, "");
    expect(serializeDoc(doc)).toBe("one\n\n\nthree\n");
  });

  it("empties the document when its only block is removed", () => {
    const doc = parseDoc("one\n");
    spliceBlocks(doc, 0, 1, "");
    expect(doc.blocks).toHaveLength(0);
    expect(serializeDoc(doc)).toBe("");
  });

  it("inserts nothing for blank text", () => {
    const doc = parseDoc("first\n");
    expect(insertBlocks(doc, 1, "   \n\n  ")).toBe(0);
    expect(serializeDoc(doc)).toBe("first\n");
  });

  it("carries a moved footnote definition with it", () => {
    const doc = parseDoc("para[^a]\n\n[^a]: the note\n\ntail\n");
    const definition = blockText(doc, 1);
    spliceBlocks(doc, 1, 1, "");
    expect(serializeDoc(doc)).not.toContain("[^a]:");
    insertBlocks(doc, doc.blocks.length, definition);
    expect(serializeDoc(doc)).toBe("para[^a]\n\ntail\n\n[^a]: the note\n");
    expectPartitionIntact(doc);
  });
});

describe("fuzz", () => {
  /** Deterministic PRNG so a failure is reproducible. */
  function makeRandom(seed) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  const FRAGMENTS = [
    "para",
    "# heading",
    "- a\n- b",
    "```\nx\n\ny\n```",
    "> quote",
    "[ref]: https://example.com",
    "[^a]: a note",
    "text[^a] and [x][ref]",
    "((::hidden::))",
    "| a | b |\n| - | - |\n| 1 | 2 |",
    "",
    "one\n\ntwo",
  ];

  it("survives 500 random edits with the partition and the round-trip intact", () => {
    const random = makeRandom(20260902);
    const doc = parseDoc("# start\n\nfirst paragraph\n\n[^a]: a note\n");

    for (let step = 0; step < 500; step += 1) {
      const count = doc.blocks.length;
      const fragment = FRAGMENTS[Math.floor(random() * FRAGMENTS.length)];

      if (count === 0 || random() < 0.35) {
        insertBlocks(doc, Math.floor(random() * (count + 1)), fragment);
      } else if (random() < 0.5) {
        spliceBlocks(doc, Math.floor(random() * count), 1, fragment);
      } else {
        const from = Math.floor(random() * count);
        const span = Math.min(count - from, 1 + Math.floor(random() * 2));
        spliceBlocks(doc, from, span, fragment);
      }

      expectPartitionIntact(doc);

      // Reparsing the serialised document must reproduce the same partition,
      // or the model has drifted from what the parser actually sees.
      const text = serializeDoc(doc);
      expect(serializeDoc(parseDoc(text))).toBe(text);
    }
  });
});
